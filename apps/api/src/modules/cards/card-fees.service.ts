import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Caller } from '../authorization/caller';
import { PermissionsService } from '../authorization/permissions.service';
import { ScopeService } from '../authorization/scope.service';
import type { CreateCardFeeScheduleDto } from './cards.dto';
import type { CardFeeKind, CardFeeWaiveReason } from './cards.constants';

const CARD_TYPE = 'GRAVE';

/** Một dòng tiền cho MỘT phần mộ trong một lần cấp thẻ. */
export interface FeeLine {
  gravePlotId: string;
  plotCode: string;
  feeKind: CardFeeKind;
  feeScheduleId: string;
  /** Đơn giá — chuỗi, vì Decimal ra JSON là chuỗi và tiền không đi qua `number`. */
  unitPrice: string;
  /** 1 với FIRST_ISSUE (giá phẳng); số cốt của phần mộ với REPRINT. */
  remainsCount: number;
  feeAmount: string;
}

export interface FeeQuote {
  scheduleId: string;
  effectiveFrom: Date;
  lines: FeeLine[];
  /** Tổng tiền TRƯỚC khi xét miễn. */
  totalAmount: string;
}

/* Biểu phí cấp thẻ mộ — anh Bách chốt 02/09/2026.
 *
 *   cấp giấy LẦN ĐẦU: 200.000đ PHẲNG, không nhân với gì
 *   mỗi lần IN LẠI  : 50.000đ × SỐ CỐT CỦA PHẦN MỘ
 *   "lần đầu" neo theo CẶP (khách hàng, phần mộ)
 *
 * Tách khỏi `CardsService` vì đây là một luật khác hẳn: `CardsService` trả lời "thẻ này in
 * ra gồm những gì", còn ở đây trả lời "lần cấp này thu bao nhiêu". Gộp lại thì một hàm 300
 * dòng vừa dựng nội dung in vừa tính tiền, và không ai tách được để kiểm.
 */
@Injectable()
export class CardFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly permissions: PermissionsService,
  ) {}

  /* BIỂU PHÍ ĐANG HIỆU LỰC cho một công ty tại một ngày.
   *
   * Bảng biểu phí append-only và CỐ Ý không có `effectiveTo` — đóng hiệu lực bằng UPDATE
   * thì trigger chặn. Nên "đang hiệu lực" = dòng có `effectiveFrom <= ngày cấp` LỚN NHẤT.
   * Vì thế KHÔNG dùng được `inEffect()` ở `common/lifecycle/active.ts`: hàm đó đòi cặp
   * from/to. Phép chọn viết ở đúng đây, một chỗ.
   *
   * Chưa có biểu phí thì NÉM, không trả 0. Trả 0 nghĩa là hệ âm thầm cấp thẻ miễn phí cho
   * cả một công ty chỉ vì chưa ai ban hành giá — và không ai biết cho tới lúc đối soát.
   */
  async effectiveSchedule(companyId: string, on: Date) {
    const schedule = await this.prisma.graveCardFeeSchedule.findFirst({
      where: { companyId, cardType: CARD_TYPE, effectiveFrom: { lte: on } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (schedule === null) {
      throw new ConflictException(
        'Chưa có biểu phí cấp thẻ có hiệu lực cho công ty này — cần ban hành biểu phí trước khi cấp thẻ',
      );
    }
    return schedule;
  }

  /* TÍNH tiền, không ghi gì.
   *
   * Một dòng cho mỗi phần mộ trên thẻ, vì thẻ gom toàn bộ mộ của khách: cùng một lần cấp
   * có thể vừa là lần đầu với mộ mới mua vừa là in lại với mộ đã có thẻ.
   *
   * Bậc giá quyết bằng cách hỏi bảng `grave_card_fee_charges` xem cặp (khách, mộ) này đã
   * từng thu FIRST_ISSUE chưa — KHÔNG suy từ `printNumber === 1`. Suy từ số lần cấp là sai
   * ở đúng ca hay gặp nhất: khách đã có thẻ cho mộ A rồi mua thêm mộ B thì `printNumber`
   * là 2, nhưng mộ B chưa từng được cấp giấy lần nào.
   */
  async quote(
    card: {
      customerId: string;
      companyId: string;
      plots: readonly { gravePlotId: string; plotCode: string; capacity: number }[];
    },
    on: Date,
  ): Promise<FeeQuote> {
    const schedule = await this.effectiveSchedule(card.companyId, on);

    const charged = await this.prisma.graveCardFeeCharge.findMany({
      where: {
        customerId: card.customerId,
        gravePlotId: { in: card.plots.map((p) => p.gravePlotId) },
        feeKind: 'FIRST_ISSUE',
      },
      select: { gravePlotId: true },
    });
    const alreadyFirstIssued = new Set(charged.map((c) => c.gravePlotId));

    const lines: FeeLine[] = card.plots.map((plot) => {
      const isFirst = !alreadyFirstIssued.has(plot.gravePlotId);
      /* Lần đầu: giá PHẲNG, nên `remainsCount = 1`. Ghi 1 chứ không ghi số cốt thật, vì
       * ràng buộc `fee_amount = unit_price * remains_count` ở CSDL phải đúng — và vì cột
       * đó phải đọc được thành "đã nhân với cái gì", không phải một số trang trí. */
      const unit = isFirst ? schedule.firstIssueFee : schedule.reprintFeePerRemains;
      const count = isFirst ? 1 : plot.capacity;
      return {
        gravePlotId: plot.gravePlotId,
        plotCode: plot.plotCode,
        feeKind: isFirst ? 'FIRST_ISSUE' : 'REPRINT',
        feeScheduleId: schedule.id,
        unitPrice: unit.toString(),
        remainsCount: count,
        feeAmount: unit.mul(count).toString(),
      };
    });

    const total = lines.reduce(
      (sum, l) => sum.add(new Prisma.Decimal(l.feeAmount)),
      new Prisma.Decimal(0),
    );

    return {
      scheduleId: schedule.id,
      effectiveFrom: schedule.effectiveFrom,
      lines,
      totalAmount: total.toString(),
    };
  }

  /* GHI các dòng phí. Phải gọi TRONG cùng giao dịch với `CardPrintLog` — nhận `tx`, không
   * tự mở giao dịch riêng. Có thẻ mà không có phí (hoặc ngược lại) là hai bản ghi kể hai
   * câu chuyện khác nhau về cùng một lần cấp.
   */
  async recordCharges(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      cardPrintLogId: string;
      customerId: string;
      quote: FeeQuote;
      waived: boolean;
      waiveReason: CardFeeWaiveReason | null;
      chargedBy: string | null;
    },
  ) {
    /* Miễn phí ghi ĐỦ số tiền kèm `waived = true`, không ghi 0. Ghi 0 thì mất luôn thông
     * tin "đã tha bao nhiêu" — và đó chính là con số kế toán sẽ hỏi. */
    const rows = input.quote.lines.map((line) => ({
      id: ulid(),
      companyId: input.companyId,
      cardPrintLogId: input.cardPrintLogId,
      customerId: input.customerId,
      gravePlotId: line.gravePlotId,
      feeKind: line.feeKind,
      feeScheduleId: line.feeScheduleId,
      unitPrice: new Prisma.Decimal(line.unitPrice),
      remainsCount: line.remainsCount,
      feeAmount: new Prisma.Decimal(line.feeAmount),
      waived: input.waived,
      waiveReason: input.waived ? input.waiveReason : null,
      chargedBy: input.chargedBy,
    }));
    await tx.graveCardFeeCharge.createMany({ data: rows });
    return rows.map((r) => r.id);
  }

  /* Người gọi có cầm quyền MIỄN PHÍ không.
   *
   * Nhận `userId`, KHÔNG nhận `Caller` — cùng lý do đã ghi ở `CardsService.nationalIdOnCard`:
   * đây là câu hỏi về một MÃ QUYỀN, không phải về một BẢN GHI. Nhận `Caller` sẽ khiến ratchet
   * quét phạm vi đòi bó phạm vi ở đây, một đòi hỏi đúng luật nhưng sai chỗ.
   *
   * Dùng `scopeLevelFor`, KHÔNG dùng `holdsForMasking`: hàm kia CỐ Ý không đi qua chuỗi luật
   * truy cập (xem chú thích ở `permissions.service.ts`), nên một luật DENY sẽ không chặn
   * được. Che sai một trường là lộ dữ liệu; miễn sai một khoản là mất tiền.
   */
  private async holdsWaiveRight(userId: string | null): Promise<boolean> {
    if (userId === null) {
      return false;
    }
    const level = await this.permissions.scopeLevelFor(userId, 'cemetery.card_fee.waive');
    return level !== 'NONE';
  }

  /* Chốt quyết định miễn phí, trước khi mở giao dịch cấp thẻ. Trả về lý do đã kiểm.
   *
   * Nhận `userId`, KHÔNG nhận `Caller` — cùng lý do như `holdsWaiveRight` ngay trên, và
   * ratchet quét phạm vi (`test/scope-check-invariants.spec.ts`) đã bắt đúng chỗ này khi
   * tôi viết nó nhận `Caller`: một method nhận `Caller` thì phải bó phạm vi BẢN GHI, mà ở
   * đây không có bản ghi nào để bó — câu hỏi là "người này có cầm mã miễn phí không".
   * Phạm vi bản ghi đã bó ở `buildCard`, trước khi tới đây.
   *
   * Cách trả lời tử tế cho một đòi hỏi đúng-luật-nhưng-sai-chỗ là đừng nhận cái tham số
   * gợi ra câu hỏi đó, chứ không phải khai một ngoại lệ vào danh sách đã-đo.
   */
  async resolveWaive(
    dto: { waive?: boolean | undefined; waiveReason?: string | undefined },
    userId: string | null,
  ): Promise<{ waived: boolean; waiveReason: CardFeeWaiveReason | null }> {
    if (dto.waive !== true) {
      return { waived: false, waiveReason: null };
    }
    if (!(await this.holdsWaiveRight(userId))) {
      throw new ForbiddenException(
        'Thiếu quyền miễn phí cấp thẻ (cemetery.card_fee.waive) — người thu tiền không tự miễn được',
      );
    }
    /* Lý do là BẮT BUỘC khi miễn. CSDL cũng chặn, nhưng chặn ở đây để người dùng nhận một
     * câu tiếng Việt thay vì lỗi ràng buộc Postgres thô. */
    if (dto.waiveReason === undefined) {
      throw new ConflictException(
        'Miễn phí phải nêu lý do — miễn không có lý do thì không truy được',
      );
    }
    return { waived: true, waiveReason: dto.waiveReason as CardFeeWaiveReason };
  }

  async listSchedules(companyId: string, caller: Caller) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
    return this.prisma.graveCardFeeSchedule.findMany({
      where: { companyId, cardType: CARD_TYPE },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /* BAN HÀNH một dòng biểu phí. Chỉ thêm — bảng append-only, không có đường sửa.
   *
   * Đó là cái giá của "đọc lại được giá năm 2026 sau khi đã đổi giá ba lần", và là cái giá
   * phải trả có ý thức: lựa chọn ngược lại (sửa đè giá) làm mọi tờ thẻ đã in thành sai.
   */
  async createSchedule(dto: CreateCardFeeScheduleDto, caller: Caller) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, dto.companyId);
    const created = await this.prisma.graveCardFeeSchedule.create({
      data: {
        id: ulid(),
        companyId: dto.companyId,
        cardType: CARD_TYPE,
        firstIssueFee: new Prisma.Decimal(dto.firstIssueFee),
        reprintFeePerRemains: new Prisma.Decimal(dto.reprintFeePerRemains),
        effectiveFrom: new Date(dto.effectiveFrom),
        decisionRef: dto.decisionRef ?? null,
        createdBy: caller.userId,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'GRAVE_CARD_FEE.SCHEDULE_CREATED',
      entityType: 'grave_card_fee_schedule',
      entityId: created.id,
      afterData: {
        companyId: created.companyId,
        firstIssueFee: created.firstIssueFee.toString(),
        reprintFeePerRemains: created.reprintFeePerRemains.toString(),
        effectiveFrom: created.effectiveFrom.toISOString(),
        decisionRef: created.decisionRef,
      },
    });
    return created;
  }

  /** Dòng phí của một lần cấp — để đối chứng với tờ giấy khách cầm. */
  async listCharges(cardPrintLogId: string, caller: Caller) {
    const rows = await this.prisma.graveCardFeeCharge.findMany({
      where: { cardPrintLogId },
      orderBy: { chargedAt: 'asc' },
    });
    for (const companyId of new Set(rows.map((r) => r.companyId))) {
      await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
    }
    return rows;
  }
}
