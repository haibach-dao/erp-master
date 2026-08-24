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
import type { CreateCustomerDto, CreatePersonDto, CreateRelationshipDto } from './customers.dto';

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
}
