import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Caller } from '../authorization/caller';
import { PermissionsService } from '../authorization/permissions.service';
import { ScopeService } from '../authorization/scope.service';
import { PiiService } from '../../common/pii/pii.service';
import { CardFeesService, type FeeQuote } from './card-fees.service';
import { activeBurial, activeUsageRight } from '../../common/lifecycle/active';
import type { IssueCardDto } from './cards.dto';
import { effectiveCapacity } from '../../common/cemetery/capacity';

const CARD_TYPE = 'GRAVE';

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly pii: PiiService,
    private readonly permissions: PermissionsService,
    private readonly fees: CardFeesService,
  ) {}

  /* Gom dữ liệu in lên thẻ.
   *
   * KHÔNG tự che gì ở đây. Trả `nationalId` BẢN RÕ và để `MaskingInterceptor` che trên
   * đường ra: người không cầm `crm.person.view_sensitive` nhận `079***789`, người có cầm
   * nhận số đầy đủ. Che ở đây nữa là che hai lần ở hai chỗ, và hai chỗ thì sẽ có ngày
   * lệch nhau.
   *
   * Tới 28/08/2026 hàm này đọc cột `nationalIdMasked` — cột LƯU SẴN ở dạng đã che — nên
   * thẻ ra `079***123` với MỌI người, kể cả người cầm S3, trong khi chú thích ngay trên
   * đầu lại tả ngược lại. Không có bản rõ nào đi qua thì không có gì để mở khoá.
   */
  private async buildCard(customerId: string, caller: Caller) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: true },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, customer.companyId);

    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: customerId, ...activeUsageRight },
      orderBy: { createdAt: 'asc' },
    });
    if (rights.length === 0) {
      throw new ConflictException('Khách hàng chưa đứng tên phần mộ nào — chưa cấp thẻ được');
    }

    const plots = await this.prisma.gravePlot.findMany({
      where: { id: { in: rights.map((r) => r.gravePlotId) } },
      include: { cemetery: true, graveType: true },
    });
    const plotById = new Map(plots.map((p) => [p.id, p]));

    const burials = await this.prisma.burialRecord.findMany({
      where: {
        gravePlotId: { in: rights.map((r) => r.gravePlotId) },
        ...activeBurial(),
      },
      include: { deceased: { include: { person: true } } },
      orderBy: { burialDate: 'asc' },
    });

    const cardPlots = rights.map((right) => {
      const plot = plotById.get(right.gravePlotId);
      if (plot === undefined) {
        throw new NotFoundException(`Không tìm thấy phần mộ ${right.gravePlotId}`);
      }
      const capacity = effectiveCapacity(plot);
      const occupants = burials
        .filter((b) => b.gravePlotId === plot.id)
        .map((b) => ({
          burialRecordId: b.id,
          fullName: b.deceased.person.fullName,
          /* Giới tính để in nhãn quan hệ ĐÚNG VAI: "Bố đẻ"/"Mẹ đẻ", không phải "Cha/Mẹ".
           * Thẻ mộ được in ra trao tận tay gia đình, nên nhãn chung chung ở đây đọc rất
           * vô cảm — anh Bách đã yêu cầu rõ "con trai - bố đẻ chứ không chung chung". */
          gender: b.deceased.person.gender,
          dateOfBirth: b.deceased.person.dateOfBirth,
          dateOfDeath: b.deceased.dateOfDeath,
          burialDate: b.burialDate,
          /* Quan hệ với chủ mộ — cột "Quan hệ" trên bảng mặt trong thẻ. Đọc từ ảnh chụp
           * lúc đặt cốt, KHÔNG tra lại quan hệ hiện tại: thẻ phải kể căn cứ tại thời
           * điểm an táng, kể cả khi mộ đã sang tên từ lâu. */
          relationshipToOwner: b.relationshipToOwner,
          status: b.status,
        }));
      return {
        gravePlotId: plot.id,
        plotCode: plot.plotCode,
        /* `cemeteryId` thêm 05/09/2026 cùng luật "người ký là người quản lý nghĩa trang":
         * màn hình cấp thẻ phải lọc ô chọn người ký theo nghĩa trang của bộ mộ, mà trước đó
         * ở đây chỉ có TÊN nghĩa trang — không lọc được bằng tên.
         *
         * Đây cũng đúng chỗ một bản thiết kế trong đợt khảo sát đã vấp: nó định tuyến người
         * duyệt bằng `card.plots[0].cemeteryId` và tin rằng trường đó có sẵn. Nó không có. */
        cemeteryId: plot.cemeteryId,
        cemeteryName: plot.cemetery.name,
        zone: plot.zone,
        subzone: plot.subzone,
        block: plot.block,
        row: plot.row,
        mapX: plot.mapX,
        mapY: plot.mapY,
        graveTypeName: plot.graveType.name,
        capacity,
        /* Số dòng TRỐNG mà thẻ phải in sẵn. Tính ở API chứ không ở giao diện: đây là quy
         * tắc nghiệp vụ ("thẻ chừa đủ chỗ cho sức chứa"), và hai giao diện khác nhau mà
         * tự tính thì sẽ in ra hai loại thẻ khác nhau. */
        emptySlots: Math.max(capacity - occupants.length, 0),
        occupants,
      };
    });

    /* Gán ra biến để TypeScript thu hẹp được kiểu: `customer.person?.x` qua optional chain
     * không thu hẹp lần truy cập sau đó. */
    const cipher = customer.person?.nationalIdCipher ?? null;

    const ownershipDate = rights
      .map((r) => r.effectiveFrom)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      customerId: customer.id,
      customerCode: customer.customerCode,
      companyId: customer.companyId,
      owner: {
        fullName: customer.person?.fullName ?? customer.orgName ?? null,
        gender: customer.person?.gender ?? null,
        dateOfBirth: customer.person?.dateOfBirth ?? null,
        /* Bản RÕ, giải mã tại chỗ. `nationalId` nằm trong sổ trường nhạy cảm nên
         * interceptor che lại thành `079***789` nếu người gọi không cầm S3 — quyết định
         * "ai đọc được số thật" nằm ở sổ đó, một chỗ, không rải ra từng service. */
        nationalId: cipher === null ? null : this.pii.decrypt(cipher),
        nationalIdIssuedOn: customer.person?.nationalIdIssuedOn ?? null,
        nationalIdIssuedPlace: customer.person?.nationalIdIssuedPlace ?? null,
        phone: customer.person?.phone ?? customer.phone ?? null,
        permanentAddress: customer.person?.permanentAddress ?? null,
        religion: customer.person?.religion ?? null,
      },
      ownershipDate: ownershipDate ?? null,
      plots: cardPlots,
    };
  }

  private async lastPrintNumber(customerId: string): Promise<number> {
    const last = await this.prisma.cardPrintLog.findFirst({
      where: { customerId, cardType: CARD_TYPE },
      orderBy: { printNumber: 'desc' },
      select: { printNumber: true },
    });
    return last?.printNumber ?? 0;
  }

  /* Thẻ vừa cấp có mang CCCD ĐẦY ĐỦ hay bản đã che.
   *
   * Ghi vào nhật ký vì mỗi tờ thẻ mang số thật là một bản sao dữ liệu cá nhân RỜI KHỎI HỆ
   * — không thu hồi được, không biết nó đi đâu. NĐ 13/2023 đòi biết ai đưa dữ liệu của một
   * người ra ngoài và lúc nào; "đã in một cái thẻ" không trả lời được câu đó, "đã in một
   * cái thẻ CÓ SỐ THẬT" thì có.
   *
   * Hỏi đúng cái hàm mà interceptor dùng để quyết che hay không, chứ không tự kiểm lại —
   * xem `holdsForMasking`. Hai chỗ tự kiểm là hai chỗ sẽ lệch, và lúc đó nhật ký nói một
   * đằng còn tờ giấy in một nẻo.
   *
   * Nhận `userId` chứ KHÔNG nhận `Caller`, có chủ đích: đây là câu hỏi về một MÃ QUYỀN
   * ("người này có cầm S3 không"), không phải câu hỏi về một BẢN GHI ("người này có với
   * tới hồ sơ kia không"). Nhận `Caller` sẽ khiến ratchet quét phạm vi đòi bó phạm vi ở
   * đây — một đòi hỏi đúng luật nhưng sai chỗ, và cách trả lời tử tế là đừng nhận cái
   * tham số gợi ra câu hỏi đó. Phạm vi bản ghi đã bó ở `buildCard`, trước khi tới đây.
   */
  private async nationalIdOnCard(userId: string | null): Promise<'FULL' | 'MASKED'> {
    /* Không biết là ai thì ghi MASKED — cùng nếp FAIL CLOSED với lớp che, vốn cũng che khi
     * request không mang người dùng. Hai chỗ phải trả lời giống nhau kể cả ở ca biên này,
     * nếu không thì đúng ở ca thường mà lệch ở ca hiếm — loại lệch khó thấy nhất. */
    if (userId === null) {
      return 'MASKED';
    }
    const holds = await this.permissions.holdsForMasking(userId, 'crm.person.view_sensitive');
    return holds ? 'FULL' : 'MASKED';
  }

  /* XEM TRƯỚC — không ghi gì, không cấp số.
   *
   * Đây là nửa còn thiếu của hệ cũ: bên đó mọi lần mở thẻ đều ghi một dòng nhật ký, nên
   * bấm Hủy ở hộp thoại in vẫn làm số lần cấp nhảy. `nextPrintNumber` ở đây là DỰ KIẾN,
   * và trường tên nói đúng như vậy.
   */
  async preview(customerId: string, caller: Caller) {
    const card = await this.buildCard(customerId, caller);
    const fee = await this.quoteOrBlocked(card);
    return {
      ...card,
      nextPrintNumber: (await this.lastPrintNumber(customerId)) + 1,
      /* Bảng kê tiền DỰ KIẾN — người ở quầy phải trả lời được "cấp thẻ này hết bao nhiêu"
       * trước khi khách quyết.
       *
       * Trả `null` khi chưa tính được. KHÔNG trả 0 và KHÔNG trả chuỗi rỗng: `formatMoney`
       * hiện `—` cho `null` nhưng hiện "0 ₫" cho 0 — và "0 ₫" trên màn hình quầy đọc thành
       * "miễn phí". Lý do đi kèm ở `feeBlocked`, đã gọi tên công ty. */
      fee: fee.quote,
      feeBlocked: fee.blocked,
      issued: false,
    };
  }

  /* Bảng kê tiền, kèm LÝ DO khi chưa tính được.
   *
   * `preview` CỐ Ý không chặn khách chưa gắn công ty (khác `issue`), vì xem trước là đường
   * ĐỌC — chặn ở đó thì người dùng không xem được thẻ chỉ vì hồ sơ còn thiếu một trường.
   * Nhưng không có công ty thì không có biểu phí, nên tiền là câu chưa trả lời được.
   *
   * Trả kèm `blocked` chứ không chỉ `null`: trước 03/09/2026 hàm này trả `null` trơ, nên màn
   * hình phải đoán và in ra "khách chưa gắn công ty, HOẶC công ty chưa ban hành biểu phí" —
   * hai nguyên nhân, cách xử lý khác hẳn nhau, mà người đọc không biết mình đang dính cái
   * nào. Câu chẩn đoán nêu hai khả năng là câu bắt người dùng tự chẩn đoán.
   */
  private async quoteOrBlocked(card: {
    customerId: string;
    companyId: string | null;
    plots: readonly { gravePlotId: string; plotCode: string; capacity: number }[];
  }): Promise<{ quote: FeeQuote | null; blocked: string | null }> {
    if (card.companyId === null) {
      return {
        quote: null,
        blocked:
          'Khách hàng chưa gắn công ty quản lý, nên chưa tra được biểu phí. Cấp thẻ sẽ bị từ chối cho tới khi hồ sơ khách có công ty.',
      };
    }
    try {
      return {
        quote: await this.fees.quote(
          { customerId: card.customerId, companyId: card.companyId, plots: card.plots },
          new Date(),
        ),
        blocked: null,
      };
    } catch (err) {
      /* Chưa ban hành biểu phí thì XEM TRƯỚC vẫn phải mở được — người ở quầy cần thấy thẻ.
       * Chỉ `issue` mới được phép chặn, và nó chặn thật.
       *
       * Nuốt ĐÚNG `ConflictException` thôi, không nuốt trần như trước. `catch {}` trần biến
       * mọi hỏng hóc — CSDL sập, Prisma lỗi — thành cùng một câu "chưa tính được phí", tức
       * là giấu một sự cố thật sau một thông báo nghiệp vụ bình thường. */
      if (err instanceof ConflictException) {
        return {
          quote: null,
          blocked: (err.getResponse() as { message?: string }).message ?? err.message,
        };
      }
      throw err;
    }
  }

  /* CẤP THẺ — sinh số và ghi nhật ký. Đây mới là hành vi để lại dấu vết.
   *
   * Số lần cấp sinh trong cùng giao dịch với dòng nhật ký, và cột `printNumber` có ràng
   * buộc duy nhất theo (khách, loại thẻ). Hai người cùng bấm cấp thẻ thì một người thua
   * ở tầng CSDL — chứ không phải cả hai cùng cầm "lần 02" trên hai tờ giấy.
   */
  async issue(customerId: string, dto: IssueCardDto, caller: Caller) {
    const card = await this.buildCard(customerId, caller);
    if (card.companyId === null) {
      throw new ConflictException('Khách hàng chưa gắn công ty quản lý — chưa cấp thẻ được');
    }
    const companyId = card.companyId;

    /* Hai việc phải xong TRƯỚC khi mở giao dịch, và cả hai đều gọi ra ngoài Prisma:
     * kiểm quyền miễn phí, và tra biểu phí. Giữ giao dịch mở trong lúc chờ chúng là giữ
     * khoá hàng lâu hơn cần thiết — cùng lý do `changeGravePlotStatus` kiểm phạm vi trước
     * khi mở giao dịch. */
    const waive = await this.fees.resolveWaive(dto, caller.userId);
    const quote = await this.fees.quote({ customerId, companyId, plots: card.plots }, new Date());

    const { log, chargeIds } = await this.prisma.$transaction(async (tx) => {
      const last = await tx.cardPrintLog.findFirst({
        where: { customerId, cardType: CARD_TYPE },
        orderBy: { printNumber: 'desc' },
        select: { printNumber: true },
      });
      const created = await tx.cardPrintLog.create({
        data: {
          id: ulid(),
          companyId,
          customerId,
          printNumber: (last?.printNumber ?? 0) + 1,
          cardType: CARD_TYPE,
          printReason: dto.printReason ?? null,
          approvedBy: dto.approvedBy ?? null,
          approvedTitle: dto.approvedTitle ?? null,
          issuedBy: caller.userId,
        },
      });
      /* Dòng phí ghi trong CÙNG giao dịch với dòng cấp thẻ. Tách ra hai giao dịch nghĩa là
       * có ngày tồn tại một lần cấp thẻ không có khoản phí, hoặc một khoản phí không gắn
       * lần cấp nào — hai bản ghi kể hai câu chuyện khác nhau về cùng một việc.
       *
       * Đây cũng là chỗ partial unique index `grave_card_fee_charges_first_issue` ép luật
       * "một cặp (khách, mộ) chỉ có đúng một lần đầu": hai quầy bấm cùng lúc thì một người
       * thua ở tầng CSDL, chứ không phải cả hai cùng thu tiền lần đầu. */
      const ids = await this.fees.recordCharges(tx, {
        companyId,
        cardPrintLogId: created.id,
        customerId,
        quote,
        waived: waive.waived,
        waiveReason: waive.waiveReason,
        chargedBy: caller.userId,
      });
      return { log: created, chargeIds: ids };
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'GRAVE_CARD.ISSUED',
      entityType: 'card_print_log',
      entityId: log.id,
      afterData: {
        customerId,
        printNumber: log.printNumber,
        printReason: log.printReason,
        approvedBy: log.approvedBy,
        nationalIdOnCard: await this.nationalIdOnCard(caller.userId),
      },
    });

    /* Dòng nhật ký RIÊNG cho tiền, không nhét vào `GRAVE_CARD.ISSUED`.
     *
     * Vì hai câu hỏi khác nhau tìm đến hai dòng khác nhau: "ai đã cấp thẻ cho khách này"
     * và "tháng này ai đã tha bao nhiêu khoản". Câu thứ hai là câu kế toán hỏi, và nó chỉ
     * trả lời được nếu miễn phí là một HÀNH ĐỘNG đếm được — không phải một trường nấp
     * trong afterData của một hành động khác. */
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: waive.waived ? 'GRAVE_CARD.FEE_WAIVED' : 'GRAVE_CARD.FEE_CHARGED',
      entityType: 'grave_card_fee_charge',
      entityId: chargeIds[0] ?? log.id,
      afterData: {
        cardPrintLogId: log.id,
        customerId,
        totalAmount: quote.totalAmount,
        feeScheduleId: quote.scheduleId,
        waiveReason: waive.waiveReason,
        lines: quote.lines.map((l) => ({
          plotCode: l.plotCode,
          feeKind: l.feeKind,
          unitPrice: l.unitPrice,
          remainsCount: l.remainsCount,
          feeAmount: l.feeAmount,
        })),
      },
    });

    return {
      ...card,
      printNumber: log.printNumber,
      cardPrintLogId: log.id,
      fee: { ...quote, waived: waive.waived, waiveReason: waive.waiveReason },
      issued: true,
    };
  }

  /* IN LẠI một thẻ đã cấp — đọc đúng dòng cũ, KHÔNG sinh số mới, KHÔNG thu tiền.
   *
   * Giấy rách, máy in kẹt, khách làm mất bản in trước khi ký: đó là in lại cùng một lần
   * cấp, không phải cấp lần mới. Không có đường này thì mỗi sự cố máy in đều làm số trên
   * thẻ nhảy, và số đó là thứ khách dùng để đối chứng.
   *
   * KHÔNG thu tiền ở đây, và đó là một quyết định, không phải một chỗ bỏ sót. Bậc "in lại
   * 50.000đ × số cốt" của anh Bách là bậc của một LẦN CẤP MỚI — thẻ phải in lại vì nội
   * dung đã đổi (thêm cốt, đổi thông tin). Còn đường này in lại ĐÚNG tờ giấy cũ vì máy in
   * kẹt; thu tiền cho một lần máy in kẹt là bắt khách trả cho lỗi của công ty, mà chính
   * anh Bách đã xếp "lỗi thuộc về công ty" vào ca MIỄN phí.
   */
  async reprint(cardPrintLogId: string, caller: Caller) {
    const log = await this.prisma.cardPrintLog.findUnique({ where: { id: cardPrintLogId } });
    if (log === null) {
      throw new NotFoundException('Không tìm thấy lần cấp thẻ này');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, log.companyId);
    const card = await this.buildCard(log.customerId, caller);
    await this.assertReprintUnchanged(log.id, card.plots);
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'GRAVE_CARD.REPRINTED',
      entityType: 'card_print_log',
      entityId: log.id,
      afterData: {
        customerId: log.customerId,
        printNumber: log.printNumber,
        nationalIdOnCard: await this.nationalIdOnCard(caller.userId),
      },
    });
    return {
      ...card,
      printNumber: log.printNumber,
      cardPrintLogId: log.id,
      approvedBy: log.approvedBy,
      approvedTitle: log.approvedTitle,
      issued: true,
      reprint: true,
    };
  }

  /* IN LẠI chỉ được phép khi NỘI DUNG CHƯA ĐỔI.
   *
   * Đây là chỗ bịt một cửa trốn tiền có thật, đo được ngày 02/09/2026: `reprint` dựng thẻ
   * lại từ dữ liệu HIỆN TẠI (nó gọi `buildCard`, không đọc lại nội dung đã in — schema cố
   * ý không chụp lại). Nên khách mua thêm một phần mộ rồi bấm "In lại" là nhận được tờ thẻ
   * MỚI, đã có mộ mới, mà không sinh số cấp và không mất một đồng.
   *
   * So bằng đúng bộ phần mộ đã ghi trong dòng phí của lần cấp đó — không cần chụp lại nội
   * dung thẻ, vì bảng phí đã phải lưu chiều phần mộ để tính tiền. Một dữ liệu, hai việc.
   *
   * Lần cấp CŨ (trước khi có biểu phí) không có dòng phí nào; những lần đó cho qua, vì
   * không có căn cứ để nói nội dung đã đổi — và từ chối in lại thẻ cũ là chặn cả đường
   * đối chứng với khách.
   */
  private async assertReprintUnchanged(
    cardPrintLogId: string,
    plots: readonly { gravePlotId: string }[],
  ): Promise<void> {
    const charges = await this.prisma.graveCardFeeCharge.findMany({
      where: { cardPrintLogId },
      select: { gravePlotId: true },
    });
    if (charges.length === 0) {
      return;
    }
    const issued = new Set(charges.map((c) => c.gravePlotId));
    const now = new Set(plots.map((p) => p.gravePlotId));
    const added = [...now].filter((id) => !issued.has(id));
    const removed = [...issued].filter((id) => !now.has(id));
    if (added.length > 0 || removed.length > 0) {
      throw new ConflictException(
        'Phần mộ của khách đã thay đổi so với lần cấp này' +
          ` (thêm ${added.length}, bớt ${removed.length})` +
          ' — phải CẤP THẺ lần mới, không in lại được',
      );
    }
  }

  async listIssuances(customerId: string, caller: Caller) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyId: true },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    await this.scope.assertCompanyFor(caller.userId, caller.permission, customer.companyId);
    return this.prisma.cardPrintLog.findMany({
      where: { customerId },
      orderBy: { printNumber: 'desc' },
    });
  }
}
