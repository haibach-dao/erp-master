import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Caller } from './caller';
import { ScopeService } from './scope.service';

/* Assigning who covers which cemetery — the hub axis, from the admin screen.
 *
 * Every write here changes who can see what, so every write emits an audit event. That
 * is not decoration: rights may be widened by an administrator and roles combine by
 * union, so the audit trail is the only record of how someone came to hold what they
 * hold. A silent grant is an ungoverned one.
 */
@Injectable()
export class AuthzAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** Cemeteries a given user covers, with the cemetery's own details for display. */
  async listForUser(userId: string) {
    const rows = await this.prisma.scopeAssignment.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    const cemeteries = await this.prisma.cemetery.findMany({
      where: { id: { in: rows.map((r) => r.cemeteryId) } },
      select: { id: true, code: true, name: true, companyId: true },
    });
    const byId = new Map(cemeteries.map((c) => [c.id, c]));
    return rows.map((r) => ({
      id: r.id,
      cemeteryId: r.cemeteryId,
      cemetery: byId.get(r.cemeteryId) ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo,
      grantedBy: r.grantedBy,
    }));
  }

  /* Grant coverage of one cemetery to one user.
   *
   * The cemetery must be inside a company the ACTOR may act on. Without that check an
   * administrator bounded to one company could hand out access to another company's
   * sites — widening someone else's reach past their own.
   */
  async assign(userId: string, cemeteryId: string, caller: Caller) {
    const cemetery = await this.prisma.cemetery.findUnique({ where: { id: cemeteryId } });
    if (cemetery === null) {
      throw new NotFoundException('Không tìm thấy nghĩa trang');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, cemetery.companyId);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (user === null) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    const row = await this.prisma.scopeAssignment.upsert({
      where: { userId_cemeteryId: { userId, cemeteryId } },
      update: { validTo: null, grantedBy: caller.userId },
      create: { id: ulid(), userId, cemeteryId, grantedBy: caller.userId },
    });
    await this.audit.record({
      companyId: cemetery.companyId,
      actorType: 'USER',
      actorId: caller.userId,
      action: 'AUTHZ.SCOPE_ASSIGNED',
      entityType: 'scope_assignment',
      entityId: row.id,
      afterData: { userId, cemeteryId, cemeteryCode: cemetery.code },
      changedFields: ['cemeteryId'],
    });
    return row;
  }

  /* Withdraw coverage by closing the validity window rather than deleting the row.
   *
   * Deleting would erase the fact that the person ever had it, and "who could see this
   * last month" is exactly the question an audit asks. Expiry also means the read path
   * needs no extra logic: it already ignores anything outside its window.
   */
  async revoke(userId: string, cemeteryId: string, caller: Caller) {
    const row = await this.prisma.scopeAssignment.findUnique({
      where: { userId_cemeteryId: { userId, cemeteryId } },
    });
    if (row === null) {
      throw new NotFoundException('Người dùng không được gán nghĩa trang này');
    }
    const cemetery = await this.prisma.cemetery.findUnique({ where: { id: cemeteryId } });
    if (cemetery === null) {
      throw new BadRequestException('Nghĩa trang không còn tồn tại');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, cemetery.companyId);

    const updated = await this.prisma.scopeAssignment.update({
      where: { userId_cemeteryId: { userId, cemeteryId } },
      data: { validTo: new Date() },
    });
    await this.audit.record({
      companyId: cemetery.companyId,
      actorType: 'USER',
      actorId: caller.userId,
      action: 'AUTHZ.SCOPE_REVOKED',
      entityType: 'scope_assignment',
      entityId: row.id,
      beforeData: { validTo: row.validTo },
      afterData: { userId, cemeteryId, validTo: updated.validTo },
      changedFields: ['validTo'],
    });
    return updated;
  }
}
