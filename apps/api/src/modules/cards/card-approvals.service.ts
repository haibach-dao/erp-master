import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
import type { FeeQuote } from './card-fees.service';
import type { CardFeeWaiveReason } from './cards.constants';

/** Vai duy nhất ký được thẻ mộ. Trùng với `CardSignersService`; một chuỗi, hai chỗ đọc. */
const SIGNER_ROLE = 'QL_NGHIA_TRANG';

/** Hồ sơ đã duyệt sống bao lâu. CHÍNH SÁCH, anh Bách chốt 05/09/2026 — đổi được. */
const APPROVAL_TTL_HOURS = 72;

/** Trạng thái lát 1 CÀI. Ràng buộc CSDL cho phép đủ 8 tên của blueprint; đây là 5 tên có mã chạy. */
export const APPROVAL_STATES = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;

export interface ApprovalSubject {
  companyId: string;
  cemeteryId: string;
  customerId: string;
  plotIds: readonly string[];
  quote: FeeQuote;
  waived: boolean;
  waiveReason: CardFeeWaiveReason | null;
}

/* VÂN TAY NỘI DUNG của một hồ sơ trình duyệt.
 *
 * Đây là thứ THẬT SỰ giữ cho tiền đúng; đồng hồ 72 giờ chỉ giữ hộp thư sạch. Người ký gật một
 * CON SỐ trên một BỘ MỘ cụ thể, nên lúc cấp thẻ phải chứng minh được hai thứ đó chưa đổi.
 *
 * BỐN thành phần, và mỗi cái đều đã suýt bị bỏ sót:
 *
 * 1. `lines` phải SẮP XẾP theo `gravePlotId`. `quote()` dựng lines bằng `card.plots.map` và
 *    KHÔNG sắp lại (card-fees.service.ts:171), nên cùng một bộ mộ vào theo thứ tự khác sẽ ra
 *    hai vân tay khác nhau — và hồ sơ vừa duyệt xong tự nhiên "đã đổi nội dung".
 *
 * 2. Phải gồm `feeKind` của TỪNG DÒNG, không chỉ danh sách mộ. Bậc giá đọc trạng thái bảng phí
 *    (card-fees.service.ts:161-169): giữa lúc gửi duyệt và lúc cấp thẻ, nếu một lần cấp KHÁC đã
 *    thu FIRST_ISSUE cho cùng cặp (khách, mộ), thì tính lại ra REPRINT × số cốt thay vì 200k
 *    phẳng. Bộ mộ y nguyên, số tiền đổi hẳn.
 *
 * 3. Phải gồm `scheduleId`. Biểu phí chọn theo `effectiveFrom <= hôm nay` LỚN NHẤT và bảng
 *    append-only không cấm ban hành một dòng lùi ngày, nên bảng giá có thể đổi dưới chân hồ sơ.
 *
 * 4. Phải gồm CỜ MIỄN PHÍ — và đây là cái dễ mất nhất, vì `FeeQuote` KHÔNG chứa nó. Cờ miễn
 *    sinh ở `resolveWaive`, một hàm khác hẳn. Băm chỉ từ `quote()` thì "có miễn" và "không
 *    miễn" ra CÙNG một vân tay: người ký gật một hồ sơ thu đủ tiền, người gửi cấp ra một tờ
 *    thẻ miễn phí, và không gì báo.
 *
 * `totalAmount` là tổng TRƯỚC khi xét miễn (card-fees.service.ts:31) — giữ nguyên nghĩa đó,
 * cờ miễn đứng riêng một trường.
 */
export function approvalFingerprint(subject: {
  quote: FeeQuote;
  waived: boolean;
  waiveReason: string | null;
}): string {
  const canonical = {
    scheduleId: subject.quote.scheduleId,
    totalAmount: subject.quote.totalAmount,
    waived: subject.waived,
    waiveReason: subject.waiveReason,
    lines: [...subject.quote.lines]
      .sort((a, b) => (a.gravePlotId < b.gravePlotId ? -1 : a.gravePlotId > b.gravePlotId ? 1 : 0))
      .map((l) => ({
        gravePlotId: l.gravePlotId,
        feeKind: l.feeKind,
        feeScheduleId: l.feeScheduleId,
        unitPrice: l.unitPrice,
        remainsCount: l.remainsCount,
        feeAmount: l.feeAmount,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/* CỬA PHÊ DUYỆT IN THẺ MỘ — lát 1, anh Bách chốt 05/09/2026.
 *
 * Service này KHÔNG phụ thuộc `CardsService`; chiều phụ thuộc đi MỘT hướng
 * (`CardsService` → `CardApprovalsService`). Đường `submit` cần dựng thẻ và tra biểu phí, mà
 * hai việc đó nằm ở `CardsService` — nên `submit` gọi từ BÊN KIA sang, truyền sẵn ảnh chụp
 * xuống đây. Đảo chiều là đẻ ra phụ thuộc vòng, và Nest sẽ đòi `forwardRef` — một dấu hiệu
 * thiết kế sai chứ không phải một tiện ích.
 */
@Injectable()
export class CardApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* Cửa có bật cho công ty này không.
   *
   * KHÔNG có dòng nào = KHÔNG bắt buộc. Cố ý mặc định TẮT: lát 1 dựng cửa, lát 2 mới có màn
   * hình gửi/duyệt. Ship một cửa chặn mà chưa ai gửi duyệt được chính là lỗi "tính năng không
   * ai dùng được" của lát 0 — lần này tránh bằng cấu trúc, không bằng lời hứa.
   */
  async isRequired(companyId: string): Promise<boolean> {
    const row = await this.prisma.cardApprovalSetting.findUnique({ where: { companyId } });
    return row?.required === true;
  }

  /* GỬI hồ sơ đi duyệt. Người gọi (CardsService) đã dựng thẻ, tra biểu phí và bó phạm vi. */
  async create(
    subject: ApprovalSubject,
    approverSignerId: string,
    caller: Caller,
  ): Promise<{ id: string; state: string }> {
    if (caller.userId === null) {
      throw new ForbiddenException('Không xác định được người gửi — chưa gửi duyệt được');
    }
    await this.assertInScope(caller, subject.companyId, subject.cemeteryId);

    /* Người ký phải CÒN đủ tư cách LÚC GỬI. Hồ sơ chụp NGƯỜI (anh Bách chốt điều 8), nên gửi
     * cho một người đã ngừng dùng là tạo ra một hồ sơ chết ngay từ lúc sinh — không ai duyệt
     * được, và người gửi không biết cho tới khi chờ mãi không thấy hồi âm. */
    const signer = await this.prisma.cardSigner.findUnique({ where: { id: approverSignerId } });
    if (signer === null || signer.userId === null) {
      throw new NotFoundException('Không tìm thấy người ký này');
    }
    if (signer.status !== 'Active') {
      throw new ConflictException(
        `Người ký "${signer.fullName}" đã ngừng dùng — chọn người ký khác rồi gửi lại.`,
      );
    }
    if (signer.cemeteryId !== subject.cemeteryId) {
      throw new ConflictException(
        `Người ký "${signer.fullName}" không phụ trách nghĩa trang của bộ mộ này.`,
      );
    }

    /* TƯ CÁCH THẬT, không chỉ cột `status`.
     *
     * `status = 'Active'` chỉ nói dòng danh mục chưa bị ngừng dùng. Nó KHÔNG nói người đó còn
     * giữ vai `QL_NGHIA_TRANG` và còn được phân công nghĩa trang này — hai thứ có `validTo` và
     * TỰ HẾT HẠN mà không lệnh UPDATE nào chạm vào dòng người ký. Đó chính là lý do
     * `CardSignersService.list` phải tính lại cờ `eligible` mỗi lần đọc.
     *
     * Thiếu phép kiểm này thì hồ sơ gửi cho một người đã rời ghế: họ mở hộp thư ra không thấy
     * gì (`listInbox` lọc theo phạm vi), hoặc thấy mà bấm Duyệt thì `PermissionGuard` từ chối
     * vì mã `cemetery.card.approve` của họ đã rụng. Hồ sơ nằm đó vĩnh viễn, và người gửi chỉ
     * biết là "chờ mãi không thấy hồi âm". */
    const now = new Date();
    const inForce = { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
    const [holdsRole, coversSite] = await Promise.all([
      this.prisma.roleAssignment.findFirst({
        where: { userId: signer.userId, role: { code: SIGNER_ROLE }, ...inForce },
        select: { id: true },
      }),
      this.prisma.scopeAssignment.findFirst({
        where: { userId: signer.userId, cemeteryId: subject.cemeteryId, ...inForce },
        select: { id: true },
      }),
    ]);
    if (holdsRole === null || coversSite === null) {
      throw new ConflictException(
        `Người ký "${signer.fullName}" không còn đủ tư cách duyệt cho nghĩa trang này (đã rời vai quản lý nghĩa trang hoặc bị gỡ phân công) — chọn người ký khác, hoặc cấp lại vai ở Tổ chức.`,
      );
    }
    if (signer.userId === caller.userId) {
      /* Chặn SỚM cho tử tế. Ràng buộc CSDL `card_issue_approvals_no_self_approve_check` chỉ nổ
       * lúc DUYỆT, nghĩa là người dùng gửi xong, chờ, rồi mới biết mình không duyệt được hồ sơ
       * của chính mình. Nói ngay từ lúc gửi thì họ đổi người ký được luôn. */
      throw new ConflictException(
        'Không gửi hồ sơ cho chính mình duyệt được — chọn một người ký khác.',
      );
    }

    /* Bắt hai giá trị ra hằng cục bộ: TypeScript KHÔNG giữ phép thu hẹp kiểu qua ranh giới một
     * closure, nên `signer.userId` và `caller.userId` bên trong callback lại là `string | null`
     * dù đã kiểm ở trên. */
    const approverUserId = signer.userId;
    const submittedBy = caller.userId;

    const created = await this.wrapDuplicate(
      () =>
        this.prisma.cardIssueApproval.create({
          data: {
            id: ulid(),
            companyId: subject.companyId,
            cemeteryId: subject.cemeteryId,
            customerId: subject.customerId,
            state: APPROVAL_STATES.SUBMITTED,
            plotIdsSnapshot: [...subject.plotIds],
            quoteSnapshot: subject.quote as unknown as Prisma.InputJsonValue,
            quoteTotal: new Prisma.Decimal(subject.quote.totalAmount),
            contentHash: approvalFingerprint(subject),
            waiveRequested: subject.waived,
            waiveReason: subject.waiveReason,
            approverUserId,
            approverSignerId: signer.id,
            submittedBy,
          },
        }),
      /* Câu cho ca "khách đã có hồ sơ đang chờ" phải KHÁC NHAU theo người đang đứng trước cửa.
       *
       * Bản đầu nói chung một câu: "chờ người ký quyết, hoặc huỷ hồ sơ cũ rồi gửi lại". Nửa sau
       * là một việc mà `cancel` CHỈ cho đúng người đã gửi làm — nên với bất kỳ ai khác, hệ đang
       * mách một việc họ chắc chắn thất bại: bấm vào là 403. Đúng lớp lỗi "câu chẩn đoán bắt
       * người dùng tự chẩn đoán" đã ghi ở `quoteOrBlocked` 03/09.
       *
       * Nên tra dòng đang mở rồi rẽ hai, và ca nào cũng nêu ĐÚNG MỘT việc người đó làm được. */
      () => this.openRequestHint(subject.customerId, submittedBy),
    );

    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      companyId: subject.companyId,
      action: 'CARD_APPROVAL.SUBMITTED',
      entityType: 'card_issue_approval',
      entityId: created.id,
      afterData: {
        customerId: subject.customerId,
        cemeteryId: subject.cemeteryId,
        approverUserId: signer.userId,
        quoteTotal: subject.quote.totalAmount,
        waiveRequested: subject.waived,
      },
    });
    return { id: created.id, state: created.state };
  }

  /* DUYỆT / TỪ CHỐI / TRẢ LẠI. Ba việc một đường vì chúng khác nhau đúng một chữ trạng thái, và
   * mọi phép kiểm phía trước thì giống hệt — tách ba hàm là ba bản của cùng một luật, và ba bản
   * thì có ngày lệch nhau. */
  async decide(
    id: string,
    next: 'APPROVED' | 'REJECTED' | 'RETURNED',
    note: string | undefined,
    caller: Caller,
  ) {
    if (caller.userId === null) {
      throw new ForbiddenException('Không xác định được người duyệt');
    }
    const before = await this.prisma.cardIssueApproval.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ trình duyệt này');
    }
    /* Bó phạm vi NGAY SAU phép tìm và TRƯỚC mọi phép kiểm trạng thái — cùng thứ tự đã dựng cho
     * `contracts.verify` 27/08. Kiểm trạng thái trước thì câu lỗi đã kể cho người ngoài phạm vi
     * biết hồ sơ này tồn tại và đang ở đâu. */
    await this.assertInScope(caller, before.companyId, before.cemeteryId);

    if (before.state !== APPROVAL_STATES.SUBMITTED) {
      throw new ConflictException(
        `Hồ sơ này không còn chờ duyệt (đang ở trạng thái ${before.state}) — không quyết lại được.`,
      );
    }
    /* Hồ sơ CHỤP NGƯỜI: chỉ đúng người được gửi mới quyết được. Ai khác có mã `approve` và phủ
     * đúng nghĩa trang vẫn không quyết thay được — đó là toàn bộ ý nghĩa của điều 8.
     *
     * CỐ Ý KHÔNG kiểm lại tư cách người ký ở đây, dù `create` kiểm rất chặt. Hai đường hỏi hai
     * câu khác nhau:
     *   · `create` hỏi "gửi cho người này có nghĩa lý gì không" — gửi cho người đã rời ghế là
     *     tạo ra một hồ sơ chết ngay từ lúc sinh, nên chặn.
     *   · `decide` hỏi "người đang đứng đây có được quyết hồ sơ NÀY không" — và nếu người ký bị
     *     ngừng dùng SAU khi hồ sơ đã gửi, để họ đóng nốt việc dở là ĐÚNG. Chặn ở đây biến mọi
     *     hồ sơ đang chờ của họ thành hồ sơ kẹt cứng: `cancel` chỉ cho người GỬI huỷ, nên nếu
     *     người gửi cũng đã nghỉ thì không ai gỡ được nữa.
     * Mã quyền vẫn gác: người đã mất `cemetery.card.approve` bị `PermissionGuard` chặn ở route,
     * trước khi tới đây. */
    if (before.approverUserId !== caller.userId) {
      throw new ForbiddenException(
        'Hồ sơ này gửi cho người ký khác — chỉ người được gửi mới quyết được. Người gửi phải gửi lại nếu muốn đổi người duyệt.',
      );
    }
    /* Ràng buộc CSDL cũng chặn, nhưng chặn ở đây để người dùng nhận một câu tiếng Việt thay vì
     * lỗi ràng buộc Postgres thô. */
    if (before.submittedBy === caller.userId) {
      throw new ForbiddenException('Không duyệt hồ sơ do chính mình gửi.');
    }

    const trimmed = note?.trim() ?? '';
    if (next !== 'APPROVED' && trimmed.length < 5) {
      throw new ConflictException(
        'Từ chối hoặc trả lại thì phải nêu lý do (ít nhất 5 ký tự) — người gửi cần biết phải sửa gì.',
      );
    }

    /* Compare-and-set: điều kiện `state: SUBMITTED` nằm TRONG `where`, không phải một câu `if`
     * ở trên. Hai người ký cùng bấm một lúc thì đúng một người thắng ở tầng CSDL. */
    const now = new Date();
    const result = await this.prisma.cardIssueApproval.updateMany({
      where: { id, state: APPROVAL_STATES.SUBMITTED },
      data: {
        state: next,
        decidedBy: caller.userId,
        decidedAt: now,
        decisionNote: trimmed === '' ? null : trimmed,
        expiresAt:
          next === 'APPROVED'
            ? new Date(now.getTime() + APPROVAL_TTL_HOURS * 60 * 60 * 1000)
            : null,
      },
    });
    if (result.count !== 1) {
      throw new ConflictException('Vừa có người khác quyết hồ sơ này cùng lúc — mời mở lại.');
    }

    const after = await this.prisma.cardIssueApproval.findUnique({ where: { id } });
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      companyId: before.companyId,
      action: `CARD_APPROVAL.${next}`,
      entityType: 'card_issue_approval',
      entityId: id,
      beforeData: { state: before.state },
      afterData: {
        state: next,
        decidedBy: caller.userId,
        decisionNote: trimmed === '' ? null : trimmed,
        customerId: before.customerId,
        quoteTotal: before.quoteTotal.toString(),
      },
    });
    return after;
  }

  /* NGƯỜI GỬI tự huỷ hồ sơ của mình.
   *
   * KHÔNG phải tiện ích. Hồ sơ chụp NGƯỜI, nên người ký bị ngừng dùng là mọi hồ sơ đang chờ của
   * họ thành hồ sơ CHẾT — không ai duyệt được. Mà unique bộ phận `card_issue_approvals_one_open`
   * chỉ cho MỘT hồ sơ `SUBMITTED` mỗi khách, nên hồ sơ chết đó sẽ CHẶN LUÔN lần gửi mới: ràng
   * buộc chống trùng biến thành ràng buộc chống dùng. Đường huỷ này là lối thoát duy nhất.
   */
  async cancel(id: string, caller: Caller) {
    if (caller.userId === null) {
      throw new ForbiddenException('Không xác định được người huỷ');
    }
    const before = await this.prisma.cardIssueApproval.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ trình duyệt này');
    }
    await this.assertInScope(caller, before.companyId, before.cemeteryId);

    if (before.submittedBy !== caller.userId) {
      throw new ForbiddenException('Chỉ người gửi mới huỷ được hồ sơ của mình.');
    }
    if (before.state !== APPROVAL_STATES.SUBMITTED) {
      throw new ConflictException(
        `Hồ sơ này không còn chờ duyệt (đang ở ${before.state}) — không huỷ được.`,
      );
    }

    const result = await this.prisma.cardIssueApproval.updateMany({
      where: { id, state: APPROVAL_STATES.SUBMITTED },
      data: { state: APPROVAL_STATES.CANCELLED },
    });
    if (result.count !== 1) {
      throw new ConflictException('Vừa có người khác quyết hồ sơ này cùng lúc — mời mở lại.');
    }

    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      companyId: before.companyId,
      action: 'CARD_APPROVAL.CANCELLED',
      entityType: 'card_issue_approval',
      entityId: id,
      beforeData: { state: before.state },
      afterData: { state: APPROVAL_STATES.CANCELLED, customerId: before.customerId },
    });
    return { id, state: APPROVAL_STATES.CANCELLED };
  }

  /* CỬA CHẶN, gọi từ `CardsService.issue` NGOÀI giao dịch.
   *
   * Trả `null` nghĩa là công ty này chưa bật cửa — đường cấp thẻ chạy y như trước. Trả một hồ sơ
   * nghĩa là đã có phê duyệt hợp lệ và `consume` sẽ tiêu nó TRONG giao dịch.
   *
   * Câu từ chối phải nêu ĐÚNG MỘT nguyên nhân, không phải "A hoặc B" — bài học đã ghi ở
   * `quoteOrBlocked` 03/09: một câu hai nhánh làm người dùng đi sửa cả hai chỗ, thường sai cả hai.
   *
   * NHẬN `issuerUserId: string | null`, KHÔNG nhận `Caller` — và đó là chữ ký ĐÚNG, không phải
   * một cách né ratchet. Phạm vi BẢN GHI đã bó ở `buildCard(customerId, caller)` trước khi vào
   * đây, và mọi hồ sơ tra ở dưới đều lọc theo `customerId` + `companyId` lấy từ chính tấm thẻ
   * đã bó đó — không có bản ghi nào người gọi tự chỉ định. Thứ duy nhất còn cần ở người gọi là
   * DANH TÍNH, để trả lời câu "người duyệt có phải chính người đang cấp không".
   *
   * Nhận `Caller` vào đây sẽ làm ratchet `scope-check-invariants` đòi một phép kiểm phạm vi
   * không tồn tại, và cách người ta làm cho nó im là ghi một dòng miễn trừ — tức làm hỏng chính
   * cái lưới. Cùng lý lẽ đã ghi ở `CardFeesService.resolveWaive`: câu hỏi về DANH TÍNH thì đừng
   * nhận tham số gợi ra câu hỏi về BẢN GHI.
   */
  async assertApproved(subject: ApprovalSubject, issuerUserId: string | null) {
    /* MIỄN PHÍ NẰM NGOÀI luồng duyệt — anh Bách chốt hướng A 07/09/2026. Đặt TRƯỚC `isRequired`
     * cho đúng nghĩa "nằm ngoài": bật cửa cho một công ty KHÔNG được biến việc miễn phí thành
     * việc không làm được nữa.
     *
     * ĐÂY KHÔNG PHẢI MỘT LỖ. `CardFeesService.resolveWaive` đã ép `cemetery.card_fee.waive`
     * TRƯỚC khi tới đây (cards.service.ts, ngay trên chỗ gọi hàm này), nên `waived` chỉ có thể
     * là `true` khi người cấp ĐÃ cầm quyền tha tiền; ai không cầm thì ăn 403 ở đó và không bao
     * giờ chạm được dòng này. Việc tha tiền vẫn để lại dấu vết riêng đếm được bằng
     * `GRAVE_CARD.FEE_WAIVED`.
     *
     * BẢN ĐẦU CỦA TÔI NÉM Ở ĐÂY, VÀ ĐÓ LÀ SAI. Nó biến "miễn phí đi đường khác" thành "miễn
     * phí không đi được đường nào": `issue()` là đường DUY NHẤT sinh số và thu tiền, nên câu
     * "người có quyền miễn cấp thẳng, không qua cửa duyệt" trỏ sang một lối KHÔNG TỒN TẠI. Ca
     * vỡ thật: khách nộp lại thẻ cũ (OLD_CARD_RETURNED, anh Bách chốt 02/09 là được miễn) thì
     * hoặc bị thu đủ 200.000đ, hoặc phải TẮT cửa duyệt cho CẢ công ty rồi bật lại — mở toang
     * mọi lần cấp khác chỉ để tha một khoản. Một lượt soi độc lập bắt trước khi mở PR. */
    if (subject.waived) {
      return null;
    }

    if (!(await this.isRequired(subject.companyId))) {
      return null;
    }

    const now = new Date();

    /* Tra ĐÚNG hồ sơ tiêu được, để CSDL lọc thay vì cắt cửa sổ ở bộ nhớ.
     *
     * VÂN TAY NẰM TRONG `where`, không phải một phép kiểm SAU khi đã chọn. Bản đầu lấy "hồ sơ
     * mới nhất còn hiệu lực" rồi mới so vân tay, và điều đó VỠ THẬT: `card_issue_approvals_one_open`
     * chỉ cấm hai hồ sơ SUBMITTED, nên hai hồ sơ APPROVED chưa tiêu cùng tồn tại là HỢP LỆ
     * (chính migration ghi vậy). Khách có hồ sơ A ({P1}, 200k, khớp) và hồ sơ B mới hơn
     * ({P1,P2}, 400k) — P2 sau đó bị thu hồi — thì bản đầu chọn B, so vân tay lệch, rồi ném
     * "nội dung đã đổi" trong khi A đang nằm sẵn đó, đúng số tiền, chưa tiêu, còn hạn.
     *
     * `take: 20` cũ còn tệ hơn ở chỗ khó thấy: sau ~20 lần gửi–huỷ trong 72 giờ, một hồ sơ đã
     * duyệt rơi khỏi cửa sổ và câu từ chối thành "khách chưa có hồ sơ nào được duyệt" — sai
     * sự thật.
     *
     * `orderBy: expiresAt asc` = tiêu cái SẮP HẾT HẠN trước, để cái còn dài hơi ở lại. */
    const usable = await this.prisma.cardIssueApproval.findFirst({
      where: {
        customerId: subject.customerId,
        companyId: subject.companyId,
        state: APPROVAL_STATES.APPROVED,
        consumedCardPrintLogId: null,
        contentHash: approvalFingerprint(subject),
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: 'asc' },
    });

    if (usable === null) {
      /* Chỉ đọc rộng khi SẮP NÉM, để dựng câu nói đúng nguyên nhân. Đường thường không trả giá
       * cho truy vấn này. */
      const candidates = await this.prisma.cardIssueApproval.findMany({
        where: { customerId: subject.customerId, companyId: subject.companyId },
        orderBy: { submittedAt: 'desc' },
        take: 20,
      });
      throw new ConflictException(
        this.blockedReason(candidates, now, approvalFingerprint(subject)),
      );
    }
    if (issuerUserId !== null && usable.approverUserId === issuerUserId) {
      /* Người DUYỆT không được là người CẤP. Ràng buộc CSDL chỉ chặn "duyệt hồ sơ của chính
       * mình"; ca này khác — duyệt xong rồi tự tay cấp luôn, tức một người đi trọn cả hai đầu. */
      throw new ForbiddenException(
        'Người đã duyệt hồ sơ này không tự cấp thẻ được — để nhân viên gửi hồ sơ thực hiện.',
      );
    }
    return usable;
  }

  /* Vì sao chưa cấp được — nêu ĐÚNG MỘT nguyên nhân, theo thứ tự người dùng cần nghe. */
  private blockedReason(
    rows: {
      state: string;
      expiresAt: Date | null;
      consumedCardPrintLogId: string | null;
      contentHash?: string;
    }[],
    now: Date,
    want?: string,
  ): string {
    /* Xét TRƯỚC mọi nhánh khác: có một hồ sơ đã duyệt, còn hạn, chưa tiêu — nhưng NỘI DUNG đã
     * đổi. Không nói ra thì người dùng nhận câu "chưa có hồ sơ nào được duyệt" và đi gửi lại
     * mà không hiểu vì sao lần trước không dùng được. */
    if (
      want !== undefined &&
      rows.some(
        (r) =>
          r.state === APPROVAL_STATES.APPROVED &&
          r.consumedCardPrintLogId === null &&
          r.expiresAt !== null &&
          r.expiresAt > now &&
          r.contentHash !== want,
      )
    ) {
      return 'Nội dung đã đổi so với lúc được duyệt (bộ phần mộ, bảng giá hoặc mức miễn phí) — phải gửi duyệt lại. Số tiền in ra phải đúng số người ký đã gật.';
    }
    if (rows.some((r) => r.state === APPROVAL_STATES.SUBMITTED)) {
      return 'Hồ sơ đang chờ người ký duyệt — chưa cấp thẻ được.';
    }
    const approved = rows.filter((r) => r.state === APPROVAL_STATES.APPROVED);
    if (approved.some((r) => r.consumedCardPrintLogId !== null) && approved.length > 0) {
      const allConsumed = approved.every((r) => r.consumedCardPrintLogId !== null);
      if (allConsumed) {
        return 'Phê duyệt này đã dùng cho một lần cấp thẻ rồi — mỗi phê duyệt chỉ cấp được một lần. Gửi duyệt lại nếu cần cấp thêm.';
      }
    }
    if (approved.some((r) => r.expiresAt !== null && r.expiresAt <= now)) {
      return `Phê duyệt đã quá hạn ${String(APPROVAL_TTL_HOURS)} giờ — gửi duyệt lại.`;
    }
    const latest = rows[0];
    if (latest?.state === APPROVAL_STATES.REJECTED) {
      return 'Hồ sơ đã bị từ chối — đọc lý do rồi gửi lại nếu vẫn cần cấp thẻ.';
    }
    if (latest?.state === APPROVAL_STATES.RETURNED) {
      return 'Hồ sơ bị trả lại để sửa — sửa xong thì gửi lại.';
    }
    return 'Công ty này bắt buộc phê duyệt trước khi cấp thẻ, mà khách chưa có hồ sơ nào được duyệt. Bấm “Gửi duyệt” trước.';
  }

  /* TIÊU phê duyệt, gọi TRONG giao dịch cấp thẻ.
   *
   * Compare-and-set ở CSDL: `state = APPROVED` VÀ `chưa tiêu` nằm trong `where`. Hai quầy bấm
   * Cấp thẻ cùng lúc trên cùng một phê duyệt thì một người thua ở tầng CSDL và cả giao dịch của
   * họ cuộn ngược — không ai thu tiền hai lần trên một quyết định.
   *
   * Nhận `tx` làm tham số ĐẦU TIÊN, cùng nếp `recordCharges`. Gọi `this.prisma` ở đây là lặng lẽ
   * ra ngoài giao dịch, và khi đó phê duyệt bị tiêu trong khi lần cấp thẻ có thể cuộn ngược.
   */
  async consume(
    tx: Prisma.TransactionClient,
    approvalId: string,
    cardPrintLogId: string,
  ): Promise<void> {
    const result = await tx.cardIssueApproval.updateMany({
      where: {
        id: approvalId,
        state: APPROVAL_STATES.APPROVED,
        consumedCardPrintLogId: null,
      },
      data: { consumedCardPrintLogId: cardPrintLogId, consumedAt: new Date() },
    });
    if (result.count !== 1) {
      throw new ConflictException(
        'Phê duyệt này vừa được dùng cho một lần cấp khác — mỗi phê duyệt chỉ cấp được một lần.',
      );
    }
  }

  /* HỘP PHÊ DUYỆT của người ký. Chỉ hồ sơ gửi ĐÍCH DANH người này. */
  async listInbox(caller: Caller) {
    if (caller.userId === null) {
      return [];
    }
    const sites = await this.scope.listSiteFilterFor(caller.userId, caller.permission);
    const companies = await this.scope.visibleCompanyIdsFor(caller.userId, caller.permission);

    const where: Prisma.CardIssueApprovalWhereInput = {
      approverUserId: caller.userId,
      state: APPROVAL_STATES.SUBMITTED,
    };
    if (sites !== null) where.cemeteryId = { in: sites };
    if (companies !== null) where.companyId = { in: companies };

    return this.prisma.cardIssueApproval.findMany({ where, orderBy: { submittedAt: 'asc' } });
  }

  /* Hồ sơ của MỘT khách — màn cấp thẻ đọc cái này để biết mình đang ở chặng nào. */
  async listForCustomer(customerId: string, caller: Caller) {
    const companies = await this.scope.visibleCompanyIdsFor(caller.userId, caller.permission);
    const sites = await this.scope.listSiteFilterFor(caller.userId, caller.permission);

    const where: Prisma.CardIssueApprovalWhereInput = { customerId };
    if (companies !== null) where.companyId = { in: companies };
    if (sites !== null) where.cemeteryId = { in: sites };

    /* `select` TƯỜNG MINH, và CỐ Ý bỏ `quoteSnapshot`.
     *
     * Màn "hồ sơ đang ở chặng nào" chỉ cần trạng thái và mốc thời gian — nó không cần bảng kê
     * từng dòng tiền. Trả cả ảnh chụp báo giá ra đây là phát một bản sao đầy đủ của thứ màn xem
     * trước đã che, cho đúng những vai cầm `cemetery.card.submit` mà không cầm
     * `cemetery.card_fee.view`. Lưới che ở controller vẫn bắt `quoteTotal`, nhưng cách chắc hơn
     * là ĐỪNG LẤY thứ mình không cần. */
    return this.prisma.cardIssueApproval.findMany({
      where,
      select: {
        id: true,
        state: true,
        cemeteryId: true,
        approverSignerId: true,
        approverUserId: true,
        submittedBy: true,
        submittedAt: true,
        decidedAt: true,
        decisionNote: true,
        expiresAt: true,
        consumedCardPrintLogId: true,
        quoteTotal: true,
        waiveRequested: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 20,
    });
  }

  /* BẬT/TẮT cửa cho một công ty. Bó phạm vi theo công ty — không ai bật cửa cho công ty mình
   * không phụ trách.
   *
   * `upsert` chứ không `create`: bật rồi tắt rồi bật lại là chuyện bình thường của một cái
   * công tắc, và mỗi lần bật không được đẻ ra một dòng mới. */
  async setRequired(companyId: string, required: boolean, caller: Caller) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);

    const before = await this.prisma.cardApprovalSetting.findUnique({ where: { companyId } });
    const row = await this.prisma.cardApprovalSetting.upsert({
      where: { companyId },
      update: { required, updatedBy: caller.userId },
      create: { companyId, required, updatedBy: caller.userId },
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      companyId,
      action: required ? 'CARD_APPROVAL.GATE_ENABLED' : 'CARD_APPROVAL.GATE_DISABLED',
      entityType: 'card_approval_setting',
      entityId: companyId,
      beforeData: { required: before?.required ?? false },
      afterData: { required },
    });
    return row;
  }

  async getSettings(companyId: string, caller: Caller) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
    const row = await this.prisma.cardApprovalSetting.findUnique({ where: { companyId } });
    /* KHÔNG có dòng = chưa bật. Trả một hình dạng ỔN ĐỊNH thay vì `null` để màn hình khỏi phải
     * phân biệt "chưa cấu hình" với "đã tắt" — hai thứ đó có cùng hệ quả. */
    return { companyId, required: row?.required ?? false, updatedAt: row?.updatedAt ?? null };
  }

  /* Dựng câu cho ca "khách đã có hồ sơ đang chờ".
   *
   * Hai câu, vì hai người đứng trước cửa có hai việc làm được khác hẳn nhau:
   *   · CHÍNH người đã gửi  → họ huỷ được, nên đưa MÃ hồ sơ để bấm huỷ luôn. Không nêu mã thì
   *     ngay cả người đúng cũng phải tự đi tra id mới gọi được đường huỷ.
   *   · NGƯỜI KHÁC          → họ KHÔNG huỷ được (`cancel` chỉ cho người gửi). Nói thẳng điều đó
   *     kèm TÊN người gửi, để việc duy nhất họ làm được — đi hỏi người kia — là việc rõ ràng.
   *
   * Tra thêm một truy vấn CHỈ trên đường lỗi, không phải đường thường. Đây cũng là nếp
   * `effectiveSchedule` đã dùng: gọi tên công ty bằng một truy vấn phụ chỉ khi sắp ném.
   */
  private async openRequestHint(customerId: string, callerUserId: string): Promise<string> {
    const open = await this.prisma.cardIssueApproval.findFirst({
      where: { customerId, state: APPROVAL_STATES.SUBMITTED },
      select: { id: true, submittedBy: true, submittedAt: true },
    });
    if (open === null) {
      /* Vừa có người quyết xong giữa lúc ta va ràng buộc và lúc ta đi tra. Đừng bịa một câu
       * chắc chắn, bảo họ thử lại. */
      return 'Khách này vừa có một hồ sơ đang chờ duyệt — mở lại danh sách rồi thử lại.';
    }
    const when = open.submittedAt.toLocaleString('vi-VN');
    if (open.submittedBy === callerUserId) {
      return `Bạn đã có một hồ sơ đang chờ duyệt cho khách này (mã ${open.id}, gửi lúc ${when}) — huỷ hồ sơ đó rồi gửi lại.`;
    }
    const sender = await this.prisma.user.findUnique({
      where: { id: open.submittedBy },
      select: { fullName: true, email: true },
    });
    const who = sender?.fullName ?? sender?.email ?? 'một người khác';
    return `Khách này đã có một hồ sơ đang chờ duyệt do ${who} gửi lúc ${when}. Bạn không huỷ được hồ sơ của người khác — chờ người ký quyết, hoặc nhờ ${who} huỷ rồi gửi lại.`;
  }

  /* Bó CẢ HAI TRỤC — công ty TRƯỚC, rồi nghĩa trang.
   *
   * `assertSiteFor` MỘT MÌNH KHÔNG ĐỦ: `ScopeService.checkSite` thoát ngay khi mức là GROUP
   * *hoặc COMPANY*, kèm chú thích "that company check is a separate call the caller already
   * makes". Đây đúng lỗ đã để hở ở lát 0 và bị một lượt soi độc lập bắt — không tái diễn.
   */
  private async assertInScope(caller: Caller, companyId: string, cemeteryId: string) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
    await this.scope.assertSiteFor(caller.userId, caller.permission, cemeteryId);
  }

  /* Dịch lỗi trùng của CSDL thành câu người đọc hiểu — và PHẢI ĐÚNG INDEX NÀO.
   * Bảng có hai unique index, cả hai đều ra P2002. Không nhận ra thì NÉM NGUYÊN lỗi gốc: đoán
   * bừa nguyên nhân chính là lớp lỗi đang tránh. */
  private async wrapDuplicate<T>(
    run: () => Promise<T>,
    openHint?: () => Promise<string>,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = duplicateTarget(err);
        if (target.includes('card_issue_approvals_one_open')) {
          throw new ConflictException(
            openHint === undefined ? 'Khách này đã có một hồ sơ đang chờ duyệt.' : await openHint(),
          );
        }
        if (target.includes('card_issue_approvals_one_consumer')) {
          throw new ConflictException('Lần cấp thẻ này đã gắn với một phê duyệt khác rồi.');
        }
      }
      throw err;
    }
  }
}

/* `meta.target` của P2002 lúc là chuỗi, lúc là mảng, lúc không có — tuỳ driver và phiên bản
 * Prisma. Gộp về MỘT chuỗi rồi mới đối chiếu tên index. */
function duplicateTarget(err: Prisma.PrismaClientKnownRequestError): string {
  const target: unknown = err.meta?.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    return target.filter((part): part is string => typeof part === 'string').join(',');
  }
  return '';
}
