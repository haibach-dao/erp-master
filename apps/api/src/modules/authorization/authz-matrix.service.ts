import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isScope } from './scope.enum';

/* Editing the permission matrix itself, from the admin screen.
 *
 * The business owner decided this is an administrator's job at runtime rather than a
 * migration reviewed in Git, and accepted the consequence: an administrator may widen
 * their own role, so the role holding these codes is effectively a permanent superuser.
 *
 * The trade made in exchange is that NOTHING here is silent. Every write emits an audit
 * event naming who did it, to which role or person, which code, and what the value was
 * before. With union across roles and an administrator who may escalate, that trail is
 * the only surviving account of how anyone came to hold what they hold — so it is
 * written as an invariant of these methods, not as a nice-to-have.
 */
@Injectable()
export class AuthzMatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every role with the codes it grants — the matrix as it actually is in the database. */
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { code: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      grants: r.rolePermissions
        .map((rp) => ({
          code: rp.permission.code,
          scope: rp.scope,
          sensitivity: rp.permission.sensitivity,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));
  }

  /** The closed catalog, so the screen offers codes rather than a free-text box. */
  listPermissions() {
    return this.prisma.permission.findMany({
      select: { code: true, description: true, sensitivity: true, wildcardExempt: true },
      orderBy: { code: 'asc' },
    });
  }

  async grant(roleCode: string, permissionCode: string, scope: string, actor: string | null) {
    if (!isScope(scope)) {
      throw new BadRequestException(`Phạm vi không hợp lệ: ${scope}`);
    }
    const { role, permission } = await this.resolve(roleCode, permissionCode);
    const existing = await this.prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    const row = await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { scope },
      create: { id: ulid(), roleId: role.id, permissionId: permission.id, scope },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.PERMISSION_GRANTED',
      entityType: 'role_permission',
      entityId: row.id,
      ...(existing === null ? {} : { beforeData: { scope: existing.scope } }),
      afterData: { role: roleCode, permission: permissionCode, scope },
      changedFields: existing === null ? ['permission'] : ['scope'],
    });
    return row;
  }

  async revoke(roleCode: string, permissionCode: string, actor: string | null) {
    const { role, permission } = await this.resolve(roleCode, permissionCode);
    const existing = await this.prisma.rolePermission.findUnique({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    if (existing === null) {
      throw new NotFoundException('Vai không có mã quyền này');
    }
    await this.prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.PERMISSION_REVOKED',
      entityType: 'role_permission',
      entityId: existing.id,
      beforeData: { role: roleCode, permission: permissionCode, scope: existing.scope },
      changedFields: ['permission'],
    });
    return { revoked: permissionCode };
  }

  /** Roles a person holds, including the ones whose window has closed. */
  async listAssignments(userId: string) {
    const rows = await this.prisma.roleAssignment.findMany({
      where: { userId },
      include: { role: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      roleCode: r.role.code,
      roleName: r.role.name,
      companyId: r.companyId,
      scope: r.scope,
      validFrom: r.validFrom,
      validTo: r.validTo,
      grantedBy: r.grantedBy,
      grantReason: r.grantReason,
    }));
  }

  /* Give a person a role, optionally bounded to one company and with an expiry.
   *
   * `validTo` is the reason the emergency role can exist at all: a right that expires on
   * its own does not depend on anyone remembering to take it back. A reason is required
   * because "why does this person hold this" is the question the trail has to answer.
   */
  async assignRole(
    input: {
      userId: string;
      roleCode: string;
      companyId?: string | null;
      validTo?: string | null;
      reason: string;
    },
    actor: string | null,
  ) {
    const role = await this.prisma.role.findUnique({ where: { code: input.roleCode } });
    if (role === null) {
      throw new NotFoundException(`Không tìm thấy vai ${input.roleCode}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (user === null) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    if (input.reason.trim().length === 0) {
      throw new BadRequestException('Phải ghi lý do cấp vai');
    }
    const companyId = input.companyId ?? null;
    await this.assertCompanyBindingUsable(role.id, input.roleCode, companyId);
    const validTo =
      input.validTo === undefined || input.validTo === null ? null : new Date(input.validTo);

    // Not an upsert: the composite unique includes a NULLABLE companyId, and "no company"
    // is a real, distinct assignment rather than a missing key. Look it up, then write.
    const existing = await this.prisma.roleAssignment.findFirst({
      where: { userId: input.userId, roleId: role.id, companyId },
    });
    const row =
      existing === null
        ? await this.prisma.roleAssignment.create({
            data: {
              id: ulid(),
              userId: input.userId,
              roleId: role.id,
              companyId,
              validTo,
              grantedBy: actor,
              grantReason: input.reason,
            },
          })
        : await this.prisma.roleAssignment.update({
            where: { id: existing.id },
            data: { validTo, grantedBy: actor, grantReason: input.reason },
          });
    await this.audit.record({
      companyId,
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.ROLE_ASSIGNED',
      entityType: 'role_assignment',
      entityId: row.id,
      afterData: {
        userId: input.userId,
        role: input.roleCode,
        companyId,
        validTo,
        reason: input.reason,
      },
      reason: input.reason,
      changedFields: ['roleId'],
    });
    return row;
  }

  /* Take a role back by closing its window, never by deleting the row — same reason as
   * everywhere else here: the fact that someone once held it is part of the record.
   */
  async revokeRole(assignmentId: string, actor: string | null) {
    const row = await this.prisma.roleAssignment.findUnique({
      where: { id: assignmentId },
      include: { role: { select: { code: true } } },
    });
    if (row === null) {
      throw new NotFoundException('Không tìm thấy dòng gán vai');
    }
    const updated = await this.prisma.roleAssignment.update({
      where: { id: assignmentId },
      data: { validTo: new Date() },
    });
    await this.audit.record({
      companyId: row.companyId,
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.ROLE_REVOKED',
      entityType: 'role_assignment',
      entityId: assignmentId,
      beforeData: { validTo: row.validTo },
      afterData: { userId: row.userId, role: row.role.code, validTo: updated.validTo },
      changedFields: ['validTo'],
    });
    return updated;
  }

  /* Refuse an assignment that would silently grant nothing.
   *
   * `company_id = NULL` means "not bound to any company". For a GROUP-scoped role that is
   * correct — it reaches every record anyway. For any narrower role it is a trap: the
   * person appears in the admin screen holding a role, but every request is refused
   * because they are bound to no company, and nothing in the UI explains why.
   *
   * That state used to be creatable, and the only defence was a script somebody had to
   * remember to run before deploying. Making it unrepresentable is the actual fix; the
   * script stays for diagnosing rows created before this check existed.
   */
  private async assertCompanyBindingUsable(
    roleId: string,
    roleCode: string,
    companyId: string | null,
  ): Promise<void> {
    if (companyId !== null) {
      return;
    }
    const groupGrant = await this.prisma.rolePermission.findFirst({
      where: { roleId, scope: 'GROUP' },
      select: { id: true },
    });
    if (groupGrant === null) {
      throw new BadRequestException(
        `Vai ${roleCode} bị giới hạn theo công ty, nên phải chỉ rõ công ty. ` +
          'Bỏ trống công ty chỉ hợp lệ với vai có phạm vi toàn tập đoàn (GROUP) — ' +
          'nếu không, người được gán sẽ giữ vai mà không truy cập được bản ghi nào.',
      );
    }
  }

  private async resolve(roleCode: string, permissionCode: string) {
    const [role, permission] = await Promise.all([
      this.prisma.role.findUnique({ where: { code: roleCode } }),
      this.prisma.permission.findUnique({ where: { code: permissionCode } }),
    ]);
    if (role === null) {
      throw new NotFoundException(`Không tìm thấy vai ${roleCode}`);
    }
    // The catalog is closed: a code that is not in it cannot be granted, however it was
    // typed. Otherwise the screen becomes a way to invent permissions nobody reviewed.
    if (permission === null) {
      throw new NotFoundException(`Mã quyền không có trong danh mục: ${permissionCode}`);
    }
    return { role, permission };
  }
}
