import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isScope } from './scope.enum';
import type { Caller } from './caller';
import { ScopeService } from './scope.service';

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
    private readonly scope: ScopeService,
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

  /* SỬA NỘI DUNG MỘT VAI thì phải ở mức GROUP — không phải "bó theo công ty".
   *
   * `Role` KHÔNG có `companyId`: vai là TOÀN CỤC. Nên thêm/bớt một mã quyền của vai
   * `QL_NGHIA_TRANG` là đổi thứ mà MỌI người giữ vai đó làm được, ở MỌI công ty. Hỏi "công
   * ty nào" ở đây là hỏi sai câu: không có công ty nào để hỏi.
   *
   * Câu đúng là: người đang sửa có với tới toàn tập đoàn không. Một admin bó ở công ty A
   * mà sửa được nội dung vai thì họ vừa đổi quyền của người ở công ty B — bằng một đường
   * không hề nhắc tới công ty B.
   *
   * LƯU Ý về quyết định đã chốt: chủ doanh nghiệp đã quyết ADMIN LEO THANG ĐƯỢC (gán ADMIN
   * cho người khác, sửa nội dung vai trên giao diện), đánh đổi lấy audit đầy đủ. Phép kiểm
   * này KHÔNG bàn lại điều đó: ADMIN ở mức GROUP đi qua đây y như trước. Nó chỉ chặn người
   * KHÔNG ở mức GROUP — trường hợp mà quyết định kia không nói tới.
   */
  private async assertGroupWide(caller: Caller, what: string): Promise<void> {
    if (caller.permission === null) {
      throw new ForbiddenException(
        'Không xác định được mã quyền đang thi hành — không kiểm được phạm vi',
      );
    }
    const level = await this.scope.levelFor(caller.userId, caller.permission);
    if (level !== 'GROUP') {
      throw new ForbiddenException(
        `Ngoài phạm vi được gán: ${what} tác động tới MỌI công ty, nên cần phạm vi toàn ` +
          'tập đoàn (GROUP). Vai là dữ liệu toàn cục, không thuộc công ty nào.',
      );
    }
  }

  async grant(roleCode: string, permissionCode: string, scope: string, caller: Caller) {
    await this.assertGroupWide(caller, 'thêm mã quyền cho một vai');
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
      actorId: caller.userId,
      action: 'AUTHZ.PERMISSION_GRANTED',
      entityType: 'role_permission',
      entityId: row.id,
      ...(existing === null ? {} : { beforeData: { scope: existing.scope } }),
      afterData: { role: roleCode, permission: permissionCode, scope },
      changedFields: existing === null ? ['permission'] : ['scope'],
    });
    return row;
  }

  async revoke(roleCode: string, permissionCode: string, caller: Caller) {
    await this.assertGroupWide(caller, 'bớt mã quyền của một vai');
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
      actorId: caller.userId,
      action: 'AUTHZ.PERMISSION_REVOKED',
      entityType: 'role_permission',
      entityId: existing.id,
      beforeData: { role: roleCode, permission: permissionCode, scope: existing.scope },
      changedFields: ['permission'],
    });
    return { revoked: permissionCode };
  }

  /* Dòng gán vai, tra được theo HAI CHIỀU: người này giữ vai gì, và vai này đang ở tay ai.
   *
   * Danh sách này là BẢN ĐỒ quyền: nó cho biết ai với tới đâu, tức đúng thứ người muốn leo
   * thang cần đọc trước. Nên nó bó theo công ty người gọi thấy được.
   *
   * Dòng `companyId = null` là vai gán TOÀN TẬP ĐOÀN. Nó không thuộc công ty nào nên không
   * lọt qua phép lọc theo công ty được — chỉ người mức GROUP (`visible === null`) thấy. Trả
   * nó cho người bó ở một công ty là kể rằng người kia giữ một vai vượt trên họ.
   *
   * Chiều NGƯỢC (theo vai) thêm 28/08/2026. Trước đó chỉ tra được xuôi, nên câu "ai đang
   * cầm mã S3 này" phải trả lời bằng cách gõ từng userId một — nghĩa là trên thực tế
   * không trả lời được. Câu đó là câu cần hỏi mỗi lần rà quyền.
   *
   * BẮT BUỘC có ít nhất một trong hai. Không có gì thì đây thành "liệt kê toàn bộ bản đồ
   * quyền của mọi người" — trả lời một câu chưa ai hỏi, bằng đúng thứ dữ liệu nhạy nhất.
   */
  async listAssignments(filter: { userId?: string; roleCode?: string }, caller: Caller) {
    const userId = filter.userId ?? '';
    const roleCode = filter.roleCode ?? '';
    if (userId === '' && roleCode === '') {
      throw new BadRequestException('Phải lọc theo người dùng hoặc theo vai');
    }
    const visible = await this.scope.visibleCompanyIdsFor(caller.userId, caller.permission);
    const rows = await this.prisma.roleAssignment.findMany({
      where: {
        ...(userId === '' ? {} : { userId }),
        ...(roleCode === '' ? {} : { role: { code: roleCode } }),
        ...(visible === null ? {} : { companyId: { in: visible } }),
      },
      include: { role: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    /* Email người giữ vai, lấy bằng truy vấn RIÊNG.
     *
     * `RoleAssignment.userId` không có quan hệ Prisma sang `User`: hai bảng nằm ở hai
     * schema khác nhau (`authz` và `iam`), tách nhau có chủ đích. Nên không `include`
     * được, phải tra thêm một lượt.
     *
     * Chỉ đọc email khi tra theo VAI: chiều xuôi người dùng đã biết mình đang xem ai.
     */
    const emails =
      roleCode === '' ? new Map<string, string>() : await this.emailsFor(rows.map((r) => r.userId));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      ...(roleCode === '' ? {} : { userEmail: emails.get(r.userId) ?? null }),
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

  private async emailsFor(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u.email]));
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
    caller: Caller,
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
    /* Phạm vi của chính người đang CẤP vai.
     *
     * `companyId = null` nghĩa là gán vai cho MỌI công ty, và `assertCompanyFor` chỉ cho
     * mức GROUP đi qua với `null` — đúng ngữ nghĩa cần ở đây, không phải trùng lặp với
     * `assertCompanyBindingUsable`: hàm đó hỏi "VAI này bỏ trống công ty có dùng được
     * không", hàm này hỏi "NGƯỜI ĐANG CẤP có với tới đó không". Hai câu khác nhau, và
     * thiếu câu thứ hai là admin công ty A phát được vai ở công ty B. */
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
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
              grantedBy: caller.userId,
              grantReason: input.reason,
            },
          })
        : await this.prisma.roleAssignment.update({
            where: { id: existing.id },
            data: { validTo, grantedBy: caller.userId, grantReason: input.reason },
          });
    await this.audit.record({
      companyId,
      actorType: 'USER',
      actorId: caller.userId,
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
  async revokeRole(assignmentId: string, caller: Caller) {
    const row = await this.prisma.roleAssignment.findUnique({
      where: { id: assignmentId },
      include: { role: { select: { code: true } } },
    });
    if (row === null) {
      throw new NotFoundException('Không tìm thấy dòng gán vai');
    }
    /* Thu hồi cũng phải bó, không chỉ cấp. Bỏ sót chiều này là admin công ty A tước được
     * vai của người ở công ty B — phá hoại thì cũng chỉ cần một chiều là đủ. */
    await this.scope.assertCompanyFor(caller.userId, caller.permission, row.companyId);
    const updated = await this.prisma.roleAssignment.update({
      where: { id: assignmentId },
      data: { validTo: new Date() },
    });
    await this.audit.record({
      companyId: row.companyId,
      actorType: 'USER',
      actorId: caller.userId,
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
