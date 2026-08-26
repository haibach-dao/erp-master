import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { PiiService } from '../../common/pii/pii.service';
import { AuditService } from '../audit/audit.service';
import type {
  AddPersonAddressDto,
  AddPersonBankAccountDto,
  AddPersonEducationDto,
  AddPersonPhoneDto,
  CreateCustomerDto,
  CreatePersonDto,
  CreateRelationshipDto,
} from './customers.dto';

interface DedupWarning {
  reason: string;
  matches: unknown[];
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
  ) {}

  private personData(dto: CreatePersonDto): Prisma.PersonCreateInput {
    const nid = dto.nationalId;
    return {
      id: ulid(),
      fullName: dto.fullName,
      gender: dto.gender ?? null,
      dateOfBirth: dto.dateOfBirth !== undefined ? new Date(dto.dateOfBirth) : null,
      nationalIdHash: nid !== undefined && nid.length > 0 ? this.pii.hash(nid) : null,
      nationalIdMasked: nid !== undefined && nid.length > 0 ? this.pii.mask(nid) : null,
      nationalIdCipher: nid !== undefined && nid.length > 0 ? this.pii.encrypt(nid) : null,
      nationalIdIssuedOn:
        dto.nationalIdIssuedOn !== undefined ? new Date(dto.nationalIdIssuedOn) : null,
      nationalIdIssuedPlace: dto.nationalIdIssuedPlace ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      permanentAddress: dto.permanentAddress ?? null,
      contactAddress: dto.contactAddress ?? null,
      ethnicity: dto.ethnicity ?? null,
      religion: dto.religion ?? null,
    };
  }

  // Warn on likely duplicates (CCCD hash exact, similar name, phone/email). Never auto-merge.
  async findDuplicates(input: {
    fullName?: string;
    nationalId?: string;
    phone?: string;
    email?: string;
  }): Promise<DedupWarning[]> {
    const warnings: DedupWarning[] = [];
    if (input.nationalId !== undefined && input.nationalId.length > 0) {
      const matches = await this.prisma.person.findMany({
        where: { nationalIdHash: this.pii.hash(input.nationalId) },
        select: { id: true, fullName: true, nationalIdMasked: true },
      });
      if (matches.length > 0) warnings.push({ reason: 'SAME_NATIONAL_ID', matches });
    }
    if (input.fullName !== undefined && input.fullName.length > 0) {
      const matches = await this.prisma.person.findMany({
        where: { fullName: { contains: input.fullName, mode: 'insensitive' } },
        select: { id: true, fullName: true },
        take: 5,
      });
      if (matches.length > 0) warnings.push({ reason: 'SIMILAR_NAME', matches });
    }
    const orClauses: Prisma.CustomerWhereInput[] = [];
    if (input.phone !== undefined && input.phone.length > 0) orClauses.push({ phone: input.phone });
    if (input.email !== undefined && input.email.length > 0) orClauses.push({ email: input.email });
    if (orClauses.length > 0) {
      const matches = await this.prisma.customer.findMany({
        where: { OR: orClauses },
        select: { id: true, customerCode: true, phone: true, email: true },
        take: 5,
      });
      if (matches.length > 0) warnings.push({ reason: 'SAME_PHONE_OR_EMAIL', matches });
    }
    return warnings;
  }

  async createPerson(dto: CreatePersonDto, actor: string | null) {
    const warnings = await this.findDuplicates({
      fullName: dto.fullName,
      ...(dto.nationalId !== undefined ? { nationalId: dto.nationalId } : {}),
    });
    const person = await this.prisma.person.create({ data: this.personData(dto) });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'PERSON.CREATED',
      entityType: 'person',
      entityId: person.id,
      afterData: { fullName: person.fullName, nationalId: dto.nationalId },
    });
    return { person, warnings };
  }

  async createCustomer(dto: CreateCustomerDto, actor: string | null) {
    let personId = dto.personId ?? null;
    let warnings: DedupWarning[] = [];

    if (dto.type === 'INDIVIDUAL' && personId === null) {
      if (dto.person === undefined) {
        throw new BadRequestException('INDIVIDUAL cần personId hoặc person');
      }
      const created = await this.createPerson(dto.person, actor);
      personId = created.person.id;
      warnings = created.warnings;
    }

    warnings = warnings.concat(
      await this.findDuplicates({
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
      }),
    );

    const customer = await this.prisma.customer.create({
      data: {
        id: ulid(),
        personId,
        customerCode: `KH-${ulid().slice(-8)}`,
        type: dto.type,
        orgName: dto.orgName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        companyId: dto.companyId ?? null,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.CREATED',
      entityType: 'customer',
      entityId: customer.id,
      afterData: { customerCode: customer.customerCode, type: customer.type },
    });
    return { customer, warnings };
  }

  // Create A->B and auto-create reciprocal B->A in one transaction; audit both (doc 04 §2.1).
  async createRelationship(dto: CreateRelationshipDto, actor: string | null) {
    if (dto.sourcePersonId === dto.targetPersonId) {
      throw new BadRequestException('Không thể tạo quan hệ với chính mình');
    }
    const rtype = await this.prisma.relationshipType.findUnique({
      where: { code: dto.relationshipType },
    });
    if (rtype === null) {
      throw new BadRequestException('relationshipType không hợp lệ');
    }
    const existing = await this.prisma.familyRelationship.findFirst({
      where: {
        sourcePersonId: dto.sourcePersonId,
        targetPersonId: dto.targetPersonId,
        relationshipType: rtype.code,
        status: { not: 'Ended' },
      },
    });
    if (existing !== null) {
      throw new ConflictException('Quan hệ đối ứng đã tồn tại trong khoảng hiệu lực');
    }

    const idA = ulid();
    const idB = ulid();
    const effectiveFrom = dto.effectiveFrom !== undefined ? new Date(dto.effectiveFrom) : null;
    const verificationSource = dto.verificationSource ?? null;

    const [rowA, rowB] = await this.prisma.$transaction([
      this.prisma.familyRelationship.create({
        data: {
          id: idA,
          sourcePersonId: dto.sourcePersonId,
          targetPersonId: dto.targetPersonId,
          relationshipType: rtype.code,
          reciprocalRelationshipId: idB,
          status: 'Confirmed',
          effectiveFrom,
          verificationSource,
        },
      }),
      this.prisma.familyRelationship.create({
        data: {
          id: idB,
          sourcePersonId: dto.targetPersonId,
          targetPersonId: dto.sourcePersonId,
          relationshipType: rtype.reciprocalCode,
          reciprocalRelationshipId: idA,
          status: 'Confirmed',
          effectiveFrom,
          verificationSource,
        },
      }),
    ]);

    for (const row of [rowA, rowB]) {
      await this.audit.record({
        actorType: 'USER',
        actorId: actor,
        action: 'FAMILY_RELATION.CREATED',
        entityType: 'family_relationship',
        entityId: row.id,
        afterData: {
          source: row.sourcePersonId,
          target: row.targetPersonId,
          type: row.relationshipType,
        },
      });
    }
    return { relationship: rowA, reciprocal: rowB };
  }

  // End A->B and its reciprocal in one transaction; audit both.
  async endRelationship(id: string, actor: string | null) {
    const rel = await this.prisma.familyRelationship.findUnique({ where: { id } });
    if (rel === null) {
      throw new NotFoundException('Không tìm thấy quan hệ');
    }
    const endedAt = new Date();
    const ids = [
      id,
      ...(rel.reciprocalRelationshipId !== null ? [rel.reciprocalRelationshipId] : []),
    ];
    await this.prisma.$transaction(
      ids.map((rid) =>
        this.prisma.familyRelationship.update({
          where: { id: rid },
          data: { status: 'Ended', effectiveTo: endedAt },
        }),
      ),
    );
    for (const rid of ids) {
      await this.audit.record({
        actorType: 'USER',
        actorId: actor,
        action: 'FAMILY_RELATION.ENDED',
        entityType: 'family_relationship',
        entityId: rid,
      });
    }
    return { endedIds: ids };
  }

  getPersonRelationships(personId: string) {
    return this.prisma.familyRelationship.findMany({
      where: { sourcePersonId: personId },
      include: { target: { select: { id: true, fullName: true, gender: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* Hồ sơ khách hàng 360 — một lần gọi cho cả màn hình chi tiết.
   *
   * Gộp ở API chứ không để giao diện gọi năm lần rồi tự ghép: năm lời gọi là năm trạng
   * thái tải khác nhau, và màn hình sẽ hiện ra từng mảnh một. Quan trọng hơn, mọi mảnh
   * đều đi qua CÙNG một lớp che — ghép ở client thì mỗi mảnh che theo một đường.
   *
   * Chỉ trả mục còn hiệu lực ở các bảng phụ; mục đã ngừng dùng thuộc màn hình lịch sử.
   */
  async getCustomerDetail(customerId: string) {
    const activeSub = { where: { status: 'active' }, orderBy: { createdAt: 'asc' } } as const;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        person: {
          include: {
            phones: activeSub,
            addresses: activeSub,
            education: activeSub,
            bankAccounts: activeSub,
          },
        },
      },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    /* Phần mộ đang đứng tên. Đi qua `GraveUsageRight` chứ không qua hợp đồng: quyền sử
     * dụng mới là thứ nói ai đang là chủ mộ HÔM NAY, hợp đồng chỉ là căn cứ sinh ra nó. */
    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: customerId, status: 'Active' },
      orderBy: { createdAt: 'asc' },
    });
    const plots =
      rights.length === 0
        ? []
        : await this.prisma.gravePlot.findMany({
            where: { id: { in: rights.map((r) => r.gravePlotId) } },
            include: { cemetery: { select: { name: true } }, graveType: true },
          });
    const plotById = new Map(plots.map((pl) => [pl.id, pl]));

    const relationships =
      customer.personId === null
        ? []
        : await this.prisma.familyRelationship.findMany({
            where: { sourcePersonId: customer.personId, status: { not: 'Ended' } },
            include: { target: { select: { id: true, fullName: true, gender: true } } },
            orderBy: { createdAt: 'desc' },
          });

    return {
      ...customer,
      gravePlots: rights.map((r) => {
        const plot = plotById.get(r.gravePlotId);
        return {
          gravePlotId: r.gravePlotId,
          plotCode: plot?.plotCode ?? null,
          cemeteryName: plot?.cemetery.name ?? null,
          zone: plot?.zone ?? null,
          block: plot?.block ?? null,
          row: plot?.row ?? null,
          status: plot?.status ?? null,
          capacity:
            plot === undefined ? null : (plot.capacityOverride ?? plot.graveType.defaultCapacity),
          effectiveFrom: r.effectiveFrom,
        };
      }),
      relationships,
    };
  }

  // Customer 360 search by code / name / phone / email / org name.
  search(q: string) {
    return this.prisma.customer.findMany({
      where: {
        OR: [
          { customerCode: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          { orgName: { contains: q, mode: 'insensitive' } },
          { person: { fullName: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        person: { select: { id: true, fullName: true, gender: true, nationalIdMasked: true } },
      },
      take: 50,
    });
  }

  // Decrypt CCCD — every full view is audited (G0-A6). Fine-grained permission is a follow-up.
  async revealNationalId(personId: string, actor: string | null) {
    const person = await this.prisma.person.findUnique({ where: { id: personId } });
    if (person === null || person.nationalIdCipher === null) {
      throw new NotFoundException('Không có dữ liệu CCCD');
    }
    const nationalId = this.pii.decrypt(person.nationalIdCipher);
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'PII.NATIONAL_ID_VIEWED',
      entityType: 'person',
      entityId: personId,
      result: 'SUCCESS',
    });
    return { personId, nationalId };
  }

  /* ---- Bảng phụ nhân thân ----
   *
   * Bốn nhóm dùng chung một khuôn: kiểm Person tồn tại, ghi dòng, phát audit. Audit là
   * BẮT BUỘC ở đây chứ không tuỳ chọn — đây là đường ghi dữ liệu cá nhân, và NĐ13 đòi
   * biết được ai đưa dữ liệu của một người vào hệ, lúc nào.
   */

  private async assertPerson(personId: string): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { id: true },
    });
    if (person === null) {
      throw new NotFoundException('Không tìm thấy nhân thân');
    }
  }

  /* Chỉ một mục được là "chính". Hạ cờ của các mục cũ TRONG CÙNG giao dịch — làm hai
   * bước rời nhau thì có khoảnh khắc hồ sơ có hai số chính, và màn hình nào đọc đúng lúc
   * đó sẽ hiện sai số liên lạc.
   */
  private async demoteOtherPrimaries(
    tx: Prisma.TransactionClient,
    table: 'personPhone' | 'personAddress' | 'personBankAccount',
    personId: string,
  ): Promise<void> {
    await (tx[table] as { updateMany: (a: unknown) => Promise<unknown> }).updateMany({
      where: { personId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  private auditSubRecord(
    actor: string | null,
    action: string,
    personId: string,
    entityId: string,
  ): Promise<unknown> {
    return this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action,
      entityType: 'person',
      entityId: personId,
      afterData: { recordId: entityId },
    });
  }

  async addPhone(personId: string, dto: AddPersonPhoneDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personPhone', personId);
      }
      return tx.personPhone.create({
        data: {
          id: ulid(),
          personId,
          phone: dto.phone,
          kind: dto.kind ?? null,
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes ?? null,
        },
      });
    });
    await this.auditSubRecord(actor, 'PERSON.PHONE_ADDED', personId, row.id);
    return row;
  }

  async addAddress(personId: string, dto: AddPersonAddressDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personAddress', personId);
      }
      return tx.personAddress.create({
        data: {
          id: ulid(),
          personId,
          address: dto.address,
          kind: dto.kind ?? null,
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes ?? null,
        },
      });
    });
    await this.auditSubRecord(actor, 'PERSON.ADDRESS_ADDED', personId, row.id);
    return row;
  }

  async addEducation(personId: string, dto: AddPersonEducationDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.personEducation.create({
      data: {
        id: ulid(),
        personId,
        school: dto.school ?? null,
        major: dto.major ?? null,
        degree: dto.degree ?? null,
        graduationYear: dto.graduationYear ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.auditSubRecord(actor, 'PERSON.EDUCATION_ADDED', personId, row.id);
    return row;
  }

  async addBankAccount(personId: string, dto: AddPersonBankAccountDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personBankAccount', personId);
      }
      return tx.personBankAccount.create({
        data: {
          id: ulid(),
          personId,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          accountHolder: dto.accountHolder ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
    /* KHÔNG ghi số tài khoản vào afterData. Nhật ký kiểm toán là append-only và đọc được
     * bằng một mã quyền KHÁC với mã mở khoá số tài khoản — chép giá trị vào đó là mở một
     * cửa sau vòng qua `view_financial`. Ghi id là đủ để lần lại. */
    await this.auditSubRecord(actor, 'PERSON.BANK_ACCOUNT_ADDED', personId, row.id);
    return row;
  }

  /* Ngừng dùng thay vì xoá: hồ sơ nhân thân đã từng đúng thì vẫn phải đọc lại được khi
   * đối chiếu giấy tờ cũ. Cùng lý do với việc thu hồi quyền bằng cách đóng hiệu lực.
   */
  async deactivateSubRecord(
    kind: 'phones' | 'addresses' | 'education' | 'bank-accounts',
    personId: string,
    recordId: string,
    actor: string | null,
  ) {
    const map = {
      phones: { table: 'personPhone', action: 'PERSON.PHONE_DEACTIVATED' },
      addresses: { table: 'personAddress', action: 'PERSON.ADDRESS_DEACTIVATED' },
      education: { table: 'personEducation', action: 'PERSON.EDUCATION_DEACTIVATED' },
      'bank-accounts': {
        table: 'personBankAccount',
        action: 'PERSON.BANK_ACCOUNT_DEACTIVATED',
      },
    } as const;
    const { table, action } = map[kind];
    const client = this.prisma[table] as unknown as {
      findFirst: (a: unknown) => Promise<{ id: string } | null>;
      update: (a: unknown) => Promise<unknown>;
    };
    /* Tìm theo CẶP (id, personId), không chỉ theo id. Tìm theo id rồi tin đường dẫn là để
     * người gọi ngừng dùng bản ghi của hồ sơ khác — IDOR kinh điển. */
    const existing = await client.findFirst({ where: { id: recordId, personId } });
    if (existing === null) {
      throw new NotFoundException('Không tìm thấy mục này trong hồ sơ nhân thân');
    }
    const updated = await client.update({
      where: { id: recordId },
      data: { status: 'inactive', ...(kind === 'education' ? {} : { isPrimary: false }) },
    });
    await this.auditSubRecord(actor, action, personId, recordId);
    return updated;
  }

  /* Hồ sơ nhân thân đầy đủ — một lần gọi thay vì năm. Chỉ trả mục còn hiệu lực; muốn xem
   * cả mục đã ngừng thì đó là màn hình lịch sử, không phải màn hình tác nghiệp.
   */
  async getPersonProfile(personId: string) {
    const active = { where: { status: 'active' }, orderBy: { createdAt: 'asc' } } as const;
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: {
        phones: active,
        addresses: active,
        education: active,
        bankAccounts: active,
      },
    });
    if (person === null) {
      throw new NotFoundException('Không tìm thấy nhân thân');
    }
    return person;
  }
}
