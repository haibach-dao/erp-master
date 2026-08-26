import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../authorization/scope.service';
import type { IssueCardDto } from './cards.dto';

/** Hồ sơ an táng còn hiệu lực — huỷ rồi thì không in lên thẻ nữa. */
const ACTIVE_BURIAL_STATUSES = ['Draft', 'Verified', 'Scheduled', 'Completed'];

const CARD_TYPE = 'GRAVE';

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* Gom dữ liệu in lên thẻ.
   *
   * KHÔNG tự che gì ở đây. Toàn bộ việc che do MaskingInterceptor làm trên đường ra, nên
   * người in không cầm `crm.person.view_sensitive` sẽ nhận thẻ có CCCD dạng `079***123`.
   * Che ở đây nữa là che hai lần ở hai chỗ, và hai chỗ thì sẽ có ngày lệch nhau.
   */
  private async buildCard(customerId: string, actor: string | null) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: true },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    await this.scope.assertCompany(actor, customer.companyId);

    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: customerId, status: 'Active' },
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
        status: { in: ACTIVE_BURIAL_STATUSES },
      },
      include: { deceased: { include: { person: true } } },
      orderBy: { burialDate: 'asc' },
    });

    const cardPlots = rights.map((right) => {
      const plot = plotById.get(right.gravePlotId);
      if (plot === undefined) {
        throw new NotFoundException(`Không tìm thấy phần mộ ${right.gravePlotId}`);
      }
      const capacity = plot.capacityOverride ?? plot.graveType.defaultCapacity;
      const occupants = burials
        .filter((b) => b.gravePlotId === plot.id)
        .map((b) => ({
          burialRecordId: b.id,
          fullName: b.deceased.person.fullName,
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
        nationalIdMasked: customer.person?.nationalIdMasked ?? null,
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

  /* XEM TRƯỚC — không ghi gì, không cấp số.
   *
   * Đây là nửa còn thiếu của hệ cũ: bên đó mọi lần mở thẻ đều ghi một dòng nhật ký, nên
   * bấm Hủy ở hộp thoại in vẫn làm số lần cấp nhảy. `nextPrintNumber` ở đây là DỰ KIẾN,
   * và trường tên nói đúng như vậy.
   */
  async preview(customerId: string, actor: string | null) {
    const card = await this.buildCard(customerId, actor);
    return {
      ...card,
      nextPrintNumber: (await this.lastPrintNumber(customerId)) + 1,
      issued: false,
    };
  }

  /* CẤP THẺ — sinh số và ghi nhật ký. Đây mới là hành vi để lại dấu vết.
   *
   * Số lần cấp sinh trong cùng giao dịch với dòng nhật ký, và cột `printNumber` có ràng
   * buộc duy nhất theo (khách, loại thẻ). Hai người cùng bấm cấp thẻ thì một người thua
   * ở tầng CSDL — chứ không phải cả hai cùng cầm "lần 02" trên hai tờ giấy.
   */
  async issue(customerId: string, dto: IssueCardDto, actor: string | null) {
    const card = await this.buildCard(customerId, actor);
    if (card.companyId === null) {
      throw new ConflictException('Khách hàng chưa gắn công ty quản lý — chưa cấp thẻ được');
    }
    const companyId = card.companyId;

    const log = await this.prisma.$transaction(async (tx) => {
      const last = await tx.cardPrintLog.findFirst({
        where: { customerId, cardType: CARD_TYPE },
        orderBy: { printNumber: 'desc' },
        select: { printNumber: true },
      });
      return tx.cardPrintLog.create({
        data: {
          id: ulid(),
          companyId,
          customerId,
          printNumber: (last?.printNumber ?? 0) + 1,
          cardType: CARD_TYPE,
          printReason: dto.printReason ?? null,
          approvedBy: dto.approvedBy ?? null,
          approvedTitle: dto.approvedTitle ?? null,
          issuedBy: actor,
        },
      });
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE_CARD.ISSUED',
      entityType: 'card_print_log',
      entityId: log.id,
      afterData: {
        customerId,
        printNumber: log.printNumber,
        printReason: log.printReason,
        approvedBy: log.approvedBy,
      },
    });

    return { ...card, printNumber: log.printNumber, cardPrintLogId: log.id, issued: true };
  }

  /* IN LẠI một thẻ đã cấp — đọc đúng dòng cũ, KHÔNG sinh số mới.
   *
   * Giấy rách, máy in kẹt, khách làm mất bản in trước khi ký: đó là in lại cùng một lần
   * cấp, không phải cấp lần mới. Không có đường này thì mỗi sự cố máy in đều làm số trên
   * thẻ nhảy, và số đó là thứ khách dùng để đối chứng.
   */
  async reprint(cardPrintLogId: string, actor: string | null) {
    const log = await this.prisma.cardPrintLog.findUnique({ where: { id: cardPrintLogId } });
    if (log === null) {
      throw new NotFoundException('Không tìm thấy lần cấp thẻ này');
    }
    await this.scope.assertCompany(actor, log.companyId);
    const card = await this.buildCard(log.customerId, actor);
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'GRAVE_CARD.REPRINTED',
      entityType: 'card_print_log',
      entityId: log.id,
      afterData: { customerId: log.customerId, printNumber: log.printNumber },
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

  async listIssuances(customerId: string, actor: string | null) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { companyId: true },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    await this.scope.assertCompany(actor, customer.companyId);
    return this.prisma.cardPrintLog.findMany({
      where: { customerId },
      orderBy: { printNumber: 'desc' },
    });
  }
}
