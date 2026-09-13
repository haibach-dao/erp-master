import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { grantInForce, grantInForceAt } from '../../common/lifecycle/active';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from './permissions.service';
import { permissionMatches } from './policy-evaluator';

/* Quản trị CHUỖI LUẬT TRUY CẬP — mô hình tường lửa.
 *
 * Thứ tự LÀ ý nghĩa của bảng này. Cùng hai luật đặt ngược thứ tự cho ra kết quả ngược
 * nhau, nên "đổi thứ tự" phải là một thao tác hạng nhất, không phải việc sửa tay con số
 * `priority` rồi hy vọng không trùng.
 *
 * Vì thế: `priority` do MÁY cấp (bậc 10, dày chỗ để chèn), người dùng chỉ nói "đưa luật
 * này lên trên luật kia". Người sửa số tay là người sẽ tạo ra hai luật cùng ưu tiên, và
 * khi đó thứ tự phụ thuộc `createdAt` — đúng, nhưng không ai đọc ra được từ màn hình.
 */
const PRIORITY_STEP = 10;

export interface CreateRuleInput {
  effect: 'ALLOW' | 'DENY';
  permissionCode: string;
  subjectUserId?: string | null;
  roleCode?: string | null;
  reason: string;
}

@Injectable()
export class AccessRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Toàn bộ chuỗi, ĐÚNG thứ tự được duyệt. Bao gồm cả luật đã hết hiệu lực. */
  async list() {
    const rows = await this.prisma.accessRule.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const now = new Date();
    /* Dạng VỊ TỪ của CÙNG luật mà `evaluateRules` lọc bằng `grantInForce` — cố ý dùng chung
     * một định nghĩa. Tự viết lại phép so ở đây là mở đường cho ngày biên `>` bên này lệch
     * `gt` bên kia, và khi đó màn hình quản trị dán nhãn "còn hiệu lực" lên đúng cái luật mà
     * chuỗi duyệt đã bỏ qua. */
    return rows.map((r) => ({ ...r, active: grantInForceAt(r, now) }));
  }

  /* Thêm luật vào CUỐI chuỗi.
   *
   * Cuối, không phải đầu: một luật mới chèn lên đầu sẽ lặng lẽ vượt qua mọi luật đang có,
   * và đó là cách vô tình mở toang cả hệ bằng một dòng. Muốn nó lên trên thì đẩy lên —
   * một thao tác riêng, nhìn thấy được.
   */
  async create(input: CreateRuleInput, actor: string | null) {
    if (input.reason.trim().length === 0) {
      throw new BadRequestException('Phải ghi lý do cho luật');
    }
    // Danh mục ĐÓNG kể cả ở đây. Mẫu có `*` thì phải khớp ít nhất một mã thật, nếu không
    // ta vừa thêm một luật không bao giờ áp cho cái gì — và nó nằm đó trông như đang bảo vệ.
    await this.assertPatternMatchesCatalog(input.permissionCode);

    const last = await this.prisma.accessRule.findFirst({ orderBy: { priority: 'desc' } });
    const priority = (last?.priority ?? 0) + PRIORITY_STEP;

    const row = await this.prisma.accessRule.create({
      data: {
        id: ulid(),
        priority,
        effect: input.effect,
        permissionCode: input.permissionCode,
        subjectUserId: input.subjectUserId ?? null,
        roleCode: input.roleCode ?? null,
        reason: input.reason,
        createdBy: actor,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.RULE_CREATED',
      entityType: 'access_rule',
      entityId: row.id,
      reason: input.reason,
      afterData: {
        priority,
        effect: input.effect,
        permissionCode: input.permissionCode,
        subjectUserId: row.subjectUserId,
        roleCode: row.roleCode,
      },
      changedFields: ['effect', 'permissionCode', 'priority'],
    });
    return row;
  }

  /* Đổi thứ tự bằng cách đổi chỗ với luật liền kề.
   *
   * Đổi chỗ hai luật liền kề chứ không "đặt priority = N": thao tác này luôn hợp lệ, luôn
   * đảo đúng một cặp, và không bao giờ tạo ra hai luật cùng ưu tiên.
   */
  async move(id: string, direction: 'up' | 'down', actor: string | null) {
    const all = await this.prisma.accessRule.findMany({
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const index = all.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new NotFoundException('Không tìm thấy luật');
    }
    const swapWith = direction === 'up' ? all[index - 1] : all[index + 1];
    const current = all[index];
    if (swapWith === undefined || current === undefined) {
      throw new BadRequestException(
        direction === 'up' ? 'Luật đã ở đầu chuỗi' : 'Luật đã ở cuối chuỗi',
      );
    }

    await this.prisma.$transaction([
      this.prisma.accessRule.update({
        where: { id: current.id },
        data: { priority: swapWith.priority },
      }),
      this.prisma.accessRule.update({
        where: { id: swapWith.id },
        data: { priority: current.priority },
      }),
    ]);

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.RULE_REORDERED',
      entityType: 'access_rule',
      entityId: current.id,
      reason: `Đổi chỗ với luật ${swapWith.id}`,
      beforeData: { priority: current.priority },
      afterData: { priority: swapWith.priority, swappedWith: swapWith.id },
      changedFields: ['priority'],
    });
    return { moved: current.id, swappedWith: swapWith.id };
  }

  /* Thu hồi = đóng hiệu lực, không xoá dòng — như mọi chỗ khác trong `authz`.
   * "Tháng trước luật nào đang chặn cái này" là đúng câu kiểm toán sẽ hỏi.
   */
  async revoke(id: string, actor: string | null) {
    const row = await this.prisma.accessRule.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException('Không tìm thấy luật');
    }
    const updated = await this.prisma.accessRule.update({
      where: { id },
      data: { validTo: new Date() },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'AUTHZ.RULE_REVOKED',
      entityType: 'access_rule',
      entityId: id,
      beforeData: { validTo: row.validTo, effect: row.effect, permissionCode: row.permissionCode },
      afterData: { validTo: updated.validTo },
      changedFields: ['validTo'],
    });
    return updated;
  }

  /* "Thử luật": với người này và mã này, luật NÀO quyết định, và quyết ra sao.
   *
   * Một danh sách luật có thứ tự mà không thử được là một danh sách không ai dám sửa. Đây
   * là `iptables -C` của hệ: nó trả về đúng luật khớp đầu tiên, hoặc nói rõ là không luật
   * nào khớp và ma trận vai mới là chỗ quyết.
   */
  async explain(userId: string, code: string) {
    /* MỐC LẤY TRƯỚC, RỒI MỚI CHẠY MÁY THẬT — và chính mốc ấy được truyền vào.
     *
     * Trước đây `now` lấy SAU `evaluateRules`, tức cách nhau nguyên một vòng gọi CSDL, trong
     * khi chú thích ngay dưới lại hứa "PHẢI khớp từng chữ". Một luật hết hạn đúng trong khoảng
     * đó thì máy thật đã xét nó là còn, còn màn thử luật lại đọc ra là hết — và màn thử luật
     * nói khác máy thật thì tệ hơn hẳn không có màn thử luật, vì người ta tin nó. */
    const now = new Date();
    const ruling = await this.permissions.evaluateRules(userId, code, now);
    const rules = await this.prisma.accessRule.findMany({
      /* PHẢI khớp từng chữ với `PermissionsService.evaluateRules` — đây là màn "thử luật", và
       * một máy thử trả lời khác máy thật thì tệ hơn không có máy thử.
       *
       * `AND: [grantInForce(now)]` chứ không trải ra: mệnh đề `subjectUserId` ngay trên đã
       * chiếm khoá `OR`, mà `grantInForce` cũng mang một khoá `OR`. Trải ra là khoá sau đè
       * khoá trước và mất im lặng một nửa điều kiện. */
      where: {
        OR: [{ subjectUserId: userId }, { subjectUserId: null }],
        AND: [grantInForce(now)],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    const access = await this.permissions.getEffectiveAccess(userId, now);
    const matched =
      rules.find(
        (r) =>
          (r.roleCode === null || access.roles.includes(r.roleCode)) &&
          permissionMatches(r.permissionCode, code),
      ) ?? null;

    return {
      ruling,
      matchedRule: matched,
      /* NO_MATCH thì ma trận vai quyết. Nói ra cả điều đó, vì "không luật nào khớp" và
       * "bị chặn" là hai câu trả lời khác nhau mà người dùng rất dễ đọc lẫn. */
      fallsBackToRoleMatrix: ruling === 'NO_MATCH',
      scopeLevel: await this.permissions.scopeLevelFor(userId, code, now),
    };
  }

  private async assertPatternMatchesCatalog(pattern: string): Promise<void> {
    if (pattern.split('.').length !== 3) {
      throw new BadRequestException('Mẫu mã quyền phải đúng 3 đoạn (module.resource.action)');
    }
    const codes = await this.prisma.permission.findMany({ select: { code: true } });
    const hit = codes.some((c) => permissionMatches(pattern, c.code));
    if (!hit) {
      throw new BadRequestException(
        `Mẫu "${pattern}" không khớp mã nào trong danh mục — luật này sẽ không bao giờ áp cho gì`,
      );
    }
  }
}
