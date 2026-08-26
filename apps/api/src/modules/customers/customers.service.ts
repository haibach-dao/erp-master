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
  UpdateCustomerDto,
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
      placeOfBirth: dto.placeOfBirth ?? null,
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
      /* Cần cả giới tính VÀ ngày sinh để đặt được nhãn cụ thể: "bố đẻ" hay "mẹ đẻ" suy từ
       * giới tính; "anh trai" hay "em trai" còn cần so tuổi. */
      include: {
        target: {
          select: { id: true, fullName: true, gender: true, dateOfBirth: true },
        },
      },
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
            /* Còn sống hay đã mất. Suy từ sự tồn tại của hồ sơ người mất chứ không từ
             * một cờ riêng — cờ riêng là thứ lệch được với hồ sơ an táng. */
            deceased: { select: { id: true, dateOfDeath: true, deathCertFileId: true } },
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
            /* Cần cả giới tính VÀ ngày sinh để đặt được nhãn cụ thể: "bố đẻ" hay "mẹ đẻ" suy từ
             * giới tính; "anh trai" hay "em trai" còn cần so tuổi. */
            include: {
              target: {
                select: { id: true, fullName: true, gender: true, dateOfBirth: true },
              },
            },
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

  /* ---- Sửa hồ sơ khách hàng ----
   *
   * Nhận cả trường của Customer lẫn của Person trong MỘT lời gọi: với người dùng đó là
   * một hồ sơ, và bắt họ lưu hai lần ở hai chỗ là chỗ dữ liệu lệch nhau khi lần lưu thứ
   * hai thất bại.
   *
   * CCCD sửa được nhưng phải sinh lại CẢ BA cột (hash để chống trùng, masked để hiện,
   * cipher để lưu) — sửa một cột là ba câu trả lời khác nhau về cùng một số.
   */
  async updateCustomer(customerId: string, dto: UpdateCustomerDto, actor: string | null) {
    const before = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: true },
    });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    const customerData: Prisma.CustomerUpdateInput = {};
    if (dto.type !== undefined) customerData.type = dto.type;
    if (dto.orgName !== undefined) customerData.orgName = dto.orgName === '' ? null : dto.orgName;
    if (dto.phone !== undefined) customerData.phone = dto.phone === '' ? null : dto.phone;
    if (dto.email !== undefined) customerData.email = dto.email === '' ? null : dto.email;

    const dp = dto.person;
    const personData: Prisma.PersonUpdateInput = {};
    if (dp !== undefined) {
      if (before.personId === null) {
        throw new BadRequestException(
          'Khách hàng tổ chức không có hồ sơ nhân thân để sửa — đổi loại khách hàng trước',
        );
      }
      /* Chỉ gọi bên trong nhánh đã kiểm `!== undefined`, nên tham số là `string` chắc
       * chắn. Nhận `string | undefined` ở đây thì kiểu trả về cũng mang `undefined`, và
       * `exactOptionalPropertyTypes` sẽ từ chối gán vào ô không nhận undefined. */
      const text = (v: string): string | null => (v === '' ? null : v);
      const date = (v: string): Date | null => (v === '' ? null : new Date(v));

      if (dp.fullName !== undefined) personData.fullName = dp.fullName;
      if (dp.gender !== undefined) personData.gender = text(dp.gender);
      if (dp.dateOfBirth !== undefined) personData.dateOfBirth = date(dp.dateOfBirth);
      if (dp.nationalIdIssuedOn !== undefined)
        personData.nationalIdIssuedOn = date(dp.nationalIdIssuedOn);
      if (dp.nationalIdIssuedPlace !== undefined)
        personData.nationalIdIssuedPlace = text(dp.nationalIdIssuedPlace);
      if (dp.phone !== undefined) personData.phone = text(dp.phone);
      if (dp.email !== undefined) personData.email = text(dp.email);
      if (dp.permanentAddress !== undefined)
        personData.permanentAddress = text(dp.permanentAddress);
      if (dp.contactAddress !== undefined) personData.contactAddress = text(dp.contactAddress);
      if (dp.placeOfBirth !== undefined) personData.placeOfBirth = text(dp.placeOfBirth);
      if (dp.ethnicity !== undefined) personData.ethnicity = text(dp.ethnicity);
      if (dp.religion !== undefined) personData.religion = text(dp.religion);
      if (dp.nationalId !== undefined) {
        const nid = dp.nationalId;
        personData.nationalIdHash = nid === '' ? null : this.pii.hash(nid);
        personData.nationalIdMasked = nid === '' ? null : this.pii.mask(nid);
        personData.nationalIdCipher = nid === '' ? null : this.pii.encrypt(nid);
      }
    }

    const personId = before.personId;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (personId !== null && Object.keys(personData).length > 0) {
        await tx.person.update({ where: { id: personId }, data: personData });
      }
      return Object.keys(customerData).length > 0
        ? tx.customer.update({ where: { id: customerId }, data: customerData })
        : before;
    });

    /* Audit ghi TÊN TRƯỜNG đã đổi, KHÔNG ghi giá trị của trường nhạy cảm. Nhật ký đọc
     * được bằng một mã quyền KHÁC với mã mở khoá CCCD — chép giá trị vào đó là mở một cửa
     * sau vòng qua lớp che. */
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.UPDATED',
      entityType: 'customer',
      entityId: customerId,
      afterData: {
        changedCustomerFields: Object.keys(customerData),
        changedPersonFields: Object.keys(personData),
      },
    });
    return updated;
  }

  /* ---- Xoá hẳn hồ sơ khách hàng ----
   *
   * Chỉ xoá được khi CHƯA phát sinh nghiệp vụ nào. Sáu bảng dưới đây trỏ tới khách hàng
   * bằng id LỎNG — không có khoá ngoại, chỉ `grave_holds` là có — nên CSDL sẽ vui vẻ để
   * lại con trỏ treo nếu không tự kiểm. Đó là lý do hàm này đếm tay từng chỗ thay vì
   * trông vào ràng buộc.
   *
   * Trả về danh sách CHẶN chứ không phải một câu "không xoá được": người dùng cần biết
   * phải dọn cái gì trước, không phải biết là mình vừa thất bại.
   */
  async deleteCustomer(customerId: string, actor: string | null) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: { select: { id: true, fullName: true } } },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    const personId = customer.person?.id ?? null;

    const [rights, holds, ownerBurials, cards, subscriptions, parties] = await Promise.all([
      this.prisma.graveUsageRight.count({ where: { holderCustomerId: customerId } }),
      this.prisma.graveHold.count({ where: { customerId } }),
      this.prisma.burialRecord.count({ where: { ownerCustomerId: customerId } }),
      this.prisma.cardPrintLog.count({ where: { customerId } }),
      this.prisma.serviceSubscription.count({ where: { customerId } }),
      this.prisma.contractParty.count({ where: { customerId } }),
    ]);

    /* Người này đã được an táng thì hồ sơ an táng trỏ vào hồ sơ người mất của họ — xoá đi
     * là để lại một hồ sơ an táng không biết chôn ai. */
    const deceased =
      personId === null
        ? null
        : await this.prisma.deceasedPerson.findUnique({
            where: { personId },
            select: { id: true },
          });
    const burialsAsDeceased =
      deceased === null
        ? 0
        : await this.prisma.burialRecord.count({ where: { deceasedPersonId: deceased.id } });

    const blockers: string[] = [];
    if (rights > 0) blockers.push(`đang đứng tên ${rights} phần mộ`);
    if (holds > 0) blockers.push(`${holds} phiếu giữ chỗ`);
    if (ownerBurials > 0) blockers.push(`là chủ mộ trong ${ownerBurials} hồ sơ an táng`);
    if (burialsAsDeceased > 0) blockers.push(`đã được an táng (${burialsAsDeceased} hồ sơ)`);
    if (cards > 0) blockers.push(`${cards} lần cấp thẻ mộ`);
    if (subscriptions > 0) blockers.push(`${subscriptions} dịch vụ đã đăng ký`);
    if (parties > 0) blockers.push(`là bên trong ${parties} hợp đồng`);

    if (blockers.length > 0) {
      throw new ConflictException(
        `Không xoá được — khách hàng ${blockers.join(', ')}. Dọn các mục này trước, hoặc giữ hồ sơ lại.`,
      );
    }

    /* Đếm quan hệ để BÁO, không để chặn: quan hệ nhân thân nằm ở cả hồ sơ người kia, nên
     * xoá người này tất yếu rút họ khỏi cây gia đình của người kia. Nói ra con số thay vì
     * lặng lẽ xoá. */
    const relationships =
      personId === null
        ? 0
        : await this.prisma.familyRelationship.count({
            where: { OR: [{ sourcePersonId: personId }, { targetPersonId: personId }] },
          });

    await this.prisma.$transaction(async (tx) => {
      if (personId !== null) {
        await tx.familyRelationship.deleteMany({
          where: { OR: [{ sourcePersonId: personId }, { targetPersonId: personId }] },
        });
        await tx.personPhone.deleteMany({ where: { personId } });
        await tx.personAddress.deleteMany({ where: { personId } });
        await tx.personEducation.deleteMany({ where: { personId } });
        await tx.personBankAccount.deleteMany({ where: { personId } });
        if (deceased !== null) {
          await tx.deceasedPerson.delete({ where: { id: deceased.id } });
        }
      }
      await tx.customer.delete({ where: { id: customerId } });
      /* Xoá luôn Person: một hồ sơ nhân thân không gắn khách hàng nào chính là cái lệch
       * vừa phải đi vá bằng migration hôm nay. Đừng tạo thêm cái mới. */
      if (personId !== null) {
        await tx.person.delete({ where: { id: personId } });
      }
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.DELETED',
      entityType: 'customer',
      entityId: customerId,
      beforeData: {
        customerCode: customer.customerCode,
        fullName: customer.person?.fullName ?? customer.orgName,
        deletedRelationships: relationships,
        deletedDeceasedRecord: deceased !== null,
      },
    });
    return { deleted: true, deletedRelationships: relationships };
  }

  /* Customer 360 search by code / name / phone / email / org name.
   *
   * Trả kèm ba thứ bảng tổng hợp cần mà bản ghi Customer không tự có: nơi sinh, phần mộ
   * đang đứng tên, và người này còn sống hay đã mất. Gộp ở đây thay vì để giao diện gọi
   * thêm — 50 dòng mà mỗi dòng một lời gọi là 50 lượt cho một lần mở trang.
   */
  async search(q: string, deceasedOnly = false) {
    const customers = await this.prisma.customer.findMany({
      where: {
        /* Lọc "đã mất" ở SERVER, không để giao diện tự lọc sau khi nhận về: truy vấn cắt
         * ở 50 dòng, nên lọc phía client sẽ bỏ sót người đã mất nếu danh sách có nhiều
         * khách còn sống đứng trước. */
        ...(deceasedOnly ? { person: { deceased: { isNot: null } } } : {}),
        OR: [
          { customerCode: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          { orgName: { contains: q, mode: 'insensitive' } },
          { person: { fullName: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        person: {
          select: {
            id: true,
            fullName: true,
            gender: true,
            nationalIdMasked: true,
            dateOfBirth: true,
            placeOfBirth: true,
            /* Sống hay đã mất suy từ SỰ TỒN TẠI của hồ sơ người mất, không phải từ một
             * cờ boolean riêng. Một cờ riêng là thứ có thể lệch với hồ sơ an táng; ở đây
             * hai câu trả lời không thể mâu thuẫn vì chúng là cùng một sự thật. */
            deceased: { select: { dateOfDeath: true } },
          },
        },
      },
      take: 50,
    });
    if (customers.length === 0) {
      return [];
    }

    // Một lượt cho cả trang, không phải mỗi khách một lượt.
    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: { in: customers.map((c) => c.id) }, status: 'Active' },
      select: { holderCustomerId: true, gravePlotId: true },
    });
    const plots =
      rights.length === 0
        ? []
        : await this.prisma.gravePlot.findMany({
            where: { id: { in: rights.map((r) => r.gravePlotId) } },
            select: { id: true, plotCode: true },
          });
    const codeById = new Map(plots.map((pl) => [pl.id, pl.plotCode]));

    const byCustomer = new Map<string, string[]>();
    for (const r of rights) {
      const list = byCustomer.get(r.holderCustomerId) ?? [];
      const code = codeById.get(r.gravePlotId);
      if (code !== undefined) list.push(code);
      byCustomer.set(r.holderCustomerId, list);
    }

    return customers.map((c) => ({
      ...c,
      gravePlotCodes: (byCustomer.get(c.id) ?? []).sort(),
      isDeceased: c.person?.deceased != null,
    }));
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
