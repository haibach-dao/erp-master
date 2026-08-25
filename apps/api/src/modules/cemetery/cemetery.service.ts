import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../authorization/scope.service';
import type {
  ChangeStatusDto,
  CreateCemeteryDto,
  CreateCompanyDto,
  CreateGravePlotDto,
  CreateGraveTypeDto,
} from './cemetery.dto';

@Injectable()
export class CemeteryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  listRelationshipTypes() {
    return this.prisma.relationshipType.findMany({ orderBy: { code: 'asc' } });
  }

  createCompany(dto: CreateCompanyDto) {
    return this.wrapUnique(
      () => this.prisma.company.create({ data: { id: ulid(), code: dto.code, name: dto.name } }),
      'company code already exists',
    );
  }

  // The company picker is built from this list, so it must already be the caller's
  // scope: returning every company invites them to pick one they cannot use.
  async listCompanies(actor: string | null) {
    const allowed = await this.scope.visibleCompanyIds(actor);
    return this.prisma.company.findMany({
      ...(allowed === null ? {} : { where: { id: { in: allowed } } }),
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCemetery(dto: CreateCemeteryDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
    return this.wrapUnique(
      () =>
        this.prisma.cemetery.create({
          data: { id: ulid(), companyId: dto.companyId, code: dto.code, name: dto.name },
        }),
      'cemetery code already exists in this company',
    );
  }

  async listCemeteries(companyId: string, actor: string | null) {
    await this.scope.assertCompany(actor, companyId);
    const sites = await this.scope.listSiteFilter(actor);
    return this.prisma.cemetery.findMany({
      where: { companyId, ...(sites === null ? {} : { id: { in: sites } }) },
      orderBy: { code: 'asc' },
    });
  }

  async createGraveType(dto: CreateGraveTypeDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
    return this.wrapUnique(
      () =>
        this.prisma.graveType.create({
          data: {
            id: ulid(),
            companyId: dto.companyId,
            code: dto.code,
            name: dto.name,
            defaultCapacity: dto.defaultCapacity ?? 1,
            referencePrice: dto.referencePrice ?? null,
          },
        }),
      'grave type code already exists in this company',
    );
  }

  async listGraveTypes(companyId: string, actor: string | null) {
    await this.scope.assertCompany(actor, companyId);
    return this.prisma.graveType.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
  }

  async createGravePlot(dto: CreateGravePlotDto, actor: string | null) {
    await this.scope.assertCompany(actor, dto.companyId);
    await this.scope.assertSite(actor, dto.cemeteryId);
    return this.wrapUnique(
      () =>
        this.prisma.gravePlot.create({
          data: {
            id: ulid(),
            companyId: dto.companyId,
            cemeteryId: dto.cemeteryId,
            graveTypeId: dto.graveTypeId,
            plotCode: dto.plotCode,
            zone: dto.zone ?? null,
            subzone: dto.subzone ?? null,
            block: dto.block ?? null,
            row: dto.row ?? null,
            capacityOverride: dto.capacityOverride ?? null,
          },
        }),
      'plotCode already exists in this company',
    );
  }

  async listGravePlots(
    companyId: string,
    actor: string | null,
    status?: string,
    cemeteryId?: string,
  ) {
    await this.scope.assertCompany(actor, companyId);
    const where: Prisma.GravePlotWhereInput = { companyId };
    if (status !== undefined) where.status = status;
    if (cemeteryId !== undefined) {
      // Asking for one cemetery: it has to be one the caller covers.
      await this.scope.assertSite(actor, cemeteryId);
      where.cemeteryId = cemeteryId;
    } else {
      // Asking for the whole company: narrow a site-bound caller to their own cemeteries
      // rather than answering with the company's entire inventory.
      const sites = await this.scope.listSiteFilter(actor);
      if (sites !== null) {
        where.cemeteryId = { in: sites };
      }
    }
    const plots = await this.prisma.gravePlot.findMany({
      where,
      orderBy: { plotCode: 'asc' },
      include: { graveType: { select: { defaultCapacity: true } } },
    });
    // Effective capacity = per-plot override or the grave type default (G0-A1).
    return plots.map((p) => ({
      ...p,
      effectiveCapacity: p.capacityOverride ?? p.graveType.defaultCapacity,
    }));
  }

  // Change status inside a transaction and append to the status history.
  async changeGravePlotStatus(id: string, dto: ChangeStatusDto, changedBy: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const plot = await tx.gravePlot.findUnique({ where: { id } });
      if (plot === null) {
        throw new NotFoundException('Grave plot not found');
      }
      if (plot.status === dto.toStatus) {
        return plot;
      }
      const updated = await tx.gravePlot.update({
        where: { id },
        data: { status: dto.toStatus, version: plot.version + 1 },
      });
      await tx.gravePlotStatusHistory.create({
        data: {
          id: ulid(),
          gravePlotId: id,
          fromStatus: plot.status,
          toStatus: dto.toStatus,
          reason: dto.reason ?? null,
          changedBy,
        },
      });
      return updated;
    });
  }

  getStatusHistory(gravePlotId: string) {
    return this.prisma.gravePlotStatusHistory.findMany({
      where: { gravePlotId },
      orderBy: { changedAt: 'desc' },
    });
  }

  private async wrapUnique<T>(fn: () => Promise<T>, message: string): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(message);
      }
      throw err;
    }
  }
}
