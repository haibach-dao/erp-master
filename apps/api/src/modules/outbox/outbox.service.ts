import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';

export interface EnqueueOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  channel: string; // EMAIL | INAPP | WEBHOOK
  payload: Prisma.InputJsonValue;
  dedupKey?: string;
  maxAttempts?: number;
}

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  // Enqueue a side effect. Pass the caller's transaction client so the outbox row commits
  // atomically with the business change; a worker (T09) dispatches it at-least-once.
  async enqueue(input: EnqueueOutboxInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.outboxEvent.create({
      data: {
        id: ulid(),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        channel: input.channel,
        payload: input.payload,
        ...(input.dedupKey !== undefined ? { dedupKey: input.dedupKey } : {}),
        ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
      },
    });
  }
}
