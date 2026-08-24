import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { computeEventHash } from './integrity.util';
import { maskSensitive } from './masking.util';

export interface RecordAuditInput {
  companyId?: string | null;
  actorType: string; // USER | SYSTEM | SERVICE | IMPERSONATION
  actorId?: string | null;
  action: string; // e.g. CONTRACT.PRICE_CHANGED
  entityType: string;
  entityId: string;
  result?: string; // SUCCESS | DENIED | FAILURE
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  changedFields?: string[];
  correlationId?: string | null;
  ipAddress?: string | null;
  source?: string; // WEB | API | JOB | IMPORT | INTEGRATION
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Append one audit event, chaining its integrity hash to the previous event in the
  // same (company, UTC-day) partition. Sensitive fields are masked before storage.
  async record(input: RecordAuditInput) {
    const occurredAt = new Date();
    const partition = utcDateOnly(occurredAt);
    const companyId = input.companyId ?? null;
    const result = input.result ?? 'SUCCESS';
    const source = input.source ?? 'API';
    const changedFields = input.changedFields ?? [];
    const maskedBefore =
      input.beforeData === undefined ? undefined : maskSensitive(input.beforeData);
    const maskedAfter = input.afterData === undefined ? undefined : maskSensitive(input.afterData);

    return this.prisma.$transaction(async (tx) => {
      const prev = await tx.auditEvent.findFirst({
        where: { companyId, chainPartitionDateUtc: partition },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { eventHash: true },
      });
      const previousEventHash = prev?.eventHash ?? null;

      const eventHash = computeEventHash({
        previousEventHash,
        occurredAt: occurredAt.toISOString(),
        companyId,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        result,
        changedFields,
        afterData: maskedAfter ?? null,
      });

      return tx.auditEvent.create({
        data: {
          id: ulid(),
          occurredAt,
          chainPartitionDateUtc: partition,
          companyId,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          result,
          reason: input.reason ?? null,
          changedFields,
          correlationId: input.correlationId ?? null,
          ipAddress: input.ipAddress ?? null,
          source,
          previousEventHash,
          eventHash,
          hashAlgorithmVersion: 1,
          ...(maskedBefore !== undefined
            ? { beforeData: maskedBefore as Prisma.InputJsonValue }
            : {}),
          ...(maskedAfter !== undefined ? { afterData: maskedAfter as Prisma.InputJsonValue } : {}),
        },
      });
    });
  }
}
