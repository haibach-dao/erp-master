import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateCatalogDto, RenewDto, SubscribeDto } from './services.dto';

const DEFAULT_REMINDER_DAYS = [90, 60, 30, 7];

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  createCatalog(dto: CreateCatalogDto) {
    return this.prisma.serviceCatalog
      .create({
        data: {
          id: ulid(),
          companyId: dto.companyId,
          code: dto.code,
          name: dto.name,
          price: dto.price,
          durationMonths: dto.durationMonths,
          reminderDays: dto.reminderDays ?? DEFAULT_REMINDER_DAYS,
        },
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Mã dịch vụ đã tồn tại trong công ty');
        }
        throw err;
      });
  }

  listCatalog(companyId: string) {
    return this.prisma.serviceCatalog.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
  }

  // Subscribe = pay in full now (A5). Creates the subscription and one revenue transaction.
  async subscribe(dto: SubscribeDto, actor: string | null) {
    const catalog = await this.prisma.serviceCatalog.findUnique({
      where: { id: dto.serviceCatalogId },
    });
    if (catalog === null || !catalog.active) {
      throw new NotFoundException('Không tìm thấy gói dịch vụ hoặc gói đã ngừng');
    }
    const from = new Date(dto.effectiveFrom);
    const to = addMonths(from, catalog.durationMonths);
    const agreedPrice = dto.agreedPrice ?? catalog.price;

    const result = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.serviceSubscription.create({
        data: {
          id: ulid(),
          companyId: dto.companyId,
          gravePlotId: dto.gravePlotId,
          contractId: dto.contractId ?? null,
          serviceCatalogId: catalog.id,
          customerId: dto.customerId,
          agreedPrice,
          effectiveFrom: from,
          effectiveTo: to,
          status: 'Active',
        },
      });
      const transaction = await tx.serviceTransaction.create({
        data: {
          id: ulid(),
          subscriptionId: subscription.id,
          companyId: dto.companyId,
          serviceCatalogId: catalog.id,
          customerId: dto.customerId,
          amount: agreedPrice,
          periodFrom: from,
          periodTo: to,
        },
      });
      return { subscription, transaction };
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'SERVICE.SUBSCRIBED',
      entityType: 'service_subscription',
      entityId: result.subscription.id,
      afterData: { catalog: catalog.code, amount: agreedPrice.toString() },
    });
    return result;
  }

  // Renewal creates a new period (never edits the old one); old → Renewed.
  async renew(subscriptionId: string, dto: RenewDto, actor: string | null) {
    const prev = await this.prisma.serviceSubscription.findUnique({
      where: { id: subscriptionId },
      include: { catalog: true },
    });
    if (prev === null) {
      throw new NotFoundException('Không tìm thấy đăng ký dịch vụ');
    }
    if (prev.status === 'Cancelled') {
      throw new ConflictException('Đăng ký đã hủy, không gia hạn được');
    }
    const from = dto.effectiveFrom !== undefined ? new Date(dto.effectiveFrom) : prev.effectiveTo;
    const to = addMonths(from, prev.catalog.durationMonths);
    const agreedPrice = prev.catalog.price;

    const result = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.serviceSubscription.create({
        data: {
          id: ulid(),
          companyId: prev.companyId,
          gravePlotId: prev.gravePlotId,
          contractId: prev.contractId,
          serviceCatalogId: prev.serviceCatalogId,
          customerId: prev.customerId,
          agreedPrice,
          effectiveFrom: from,
          effectiveTo: to,
          status: 'Active',
          previousSubscriptionId: prev.id,
        },
      });
      const transaction = await tx.serviceTransaction.create({
        data: {
          id: ulid(),
          subscriptionId: subscription.id,
          companyId: prev.companyId,
          serviceCatalogId: prev.serviceCatalogId,
          customerId: prev.customerId,
          amount: agreedPrice,
          periodFrom: from,
          periodTo: to,
        },
      });
      await tx.serviceSubscription.update({ where: { id: prev.id }, data: { status: 'Renewed' } });
      return { subscription, transaction };
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'SERVICE.RENEWED',
      entityType: 'service_subscription',
      entityId: result.subscription.id,
      afterData: { previousSubscriptionId: prev.id },
    });
    return result;
  }

  async cancel(subscriptionId: string, actor: string | null) {
    const sub = await this.prisma.serviceSubscription.findUnique({ where: { id: subscriptionId } });
    if (sub === null) {
      throw new NotFoundException('Không tìm thấy đăng ký');
    }
    const updated = await this.prisma.serviceSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'Cancelled' },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'SERVICE.CANCELLED',
      entityType: 'service_subscription',
      entityId: subscriptionId,
    });
    return updated;
  }

  listSubscriptions(gravePlotId?: string, status?: string) {
    return this.prisma.serviceSubscription.findMany({
      where: {
        ...(gravePlotId !== undefined ? { gravePlotId } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Revenue = sum of collected transactions (A5: everything is paid-in-full).
  async revenue(companyId: string, from?: string, to?: string) {
    const paidAt: Prisma.DateTimeFilter = {};
    if (from !== undefined) paidAt.gte = new Date(from);
    if (to !== undefined) paidAt.lte = new Date(to);
    const where: Prisma.ServiceTransactionWhereInput = { companyId };
    if (from !== undefined || to !== undefined) where.paidAt = paidAt;

    const agg = await this.prisma.serviceTransaction.aggregate({
      where,
      _sum: { amount: true },
      _count: true,
    });
    const byService = await this.prisma.serviceTransaction.groupBy({
      by: ['serviceCatalogId'],
      where,
      _sum: { amount: true },
      _count: true,
    });
    return {
      totalCollected: (agg._sum.amount ?? new Prisma.Decimal(0)).toString(),
      transactions: agg._count,
      byService: byService.map((b) => ({
        serviceCatalogId: b.serviceCatalogId,
        collected: (b._sum.amount ?? new Prisma.Decimal(0)).toString(),
        count: b._count,
      })),
    };
  }
}
