import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import type { Caller } from '../authorization/caller';
import { ScopeService } from '../authorization/scope.service';
import { AuditService } from '../audit/audit.service';
import { activeBurial, activeUsageRight } from '../../common/lifecycle/active';
import type { AddPartyDto, CreateContractDto, CancelContractDto } from './contracts.dto';

/* Trạng thái hợp đồng có thể cho hiệu lực từ đó.
 *
 * Số bước phụ thuộc NGƯỜI LÀM, không phụ thuộc bản ghi (quyết định G0-Q10):
 *  - Ai cầm `contract.record.activate` (route này đã gate bằng đúng mã đó) thì đi thẳng
 *    tới Active, bỏ qua thẩm định — kể cả hợp đồng do chính mình soạn.
 *  - Ai không cầm mã đó thì không gọi được endpoint này; hợp đồng của họ phải qua
 *    `verify` bởi NGƯỜI KHÁC rồi mới tới đây.
 *
 * Nói cách khác: chuỗi bốn bước không bị bỏ, nó chỉ ngắn lại đúng với người có thẩm
 * quyền cho hiệu lực. Bỏ qua bước nào thì audit ghi lại bước đó.
 */
const ACTIVATABLE_FROM = ['Uploaded', 'PendingVerification', 'Verified'];

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async create(dto: CreateContractDto, caller: Caller) {
    try {
      const contract = await this.prisma.externalContract.create({
        data: {
          id: ulid(),
          companyId: dto.companyId,
          contractNo: dto.contractNo,
          gravePlotId: dto.gravePlotId,
          contractFileId: dto.contractFileId ?? null,
          sourceType: dto.sourceType ?? null,
          signedAt: dto.signedAt !== undefined ? new Date(dto.signedAt) : null,
          validTo: dto.validTo !== undefined ? new Date(dto.validTo) : null,
          totalAmount: dto.totalAmount ?? null,
          createdBy: caller.userId,
        },
      });
      await this.audit.record({
        actorType: 'USER',
        actorId: caller.userId,
        action: 'CONTRACT.CREATED',
        entityType: 'external_contract',
        entityId: contract.id,
      });
      return contract;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Số hợp đồng đã tồn tại trong công ty');
      }
      throw err;
    }
  }

  async addParty(contractId: string, dto: AddPartyDto) {
    const contract = await this.prisma.externalContract.findUnique({ where: { id: contractId } });
    if (contract === null) {
      throw new NotFoundException('Không tìm thấy hợp đồng');
    }
    if (contract.status === 'Active' || contract.status === 'Cancelled') {
      throw new ConflictException('Không sửa bên ký khi hợp đồng đã Active/Cancelled');
    }
    return this.prisma.contractParty.create({
      data: { id: ulid(), contractId, customerId: dto.customerId, role: dto.role },
    });
  }

  /* PHẠM VI CỦA MỘT HỢP ĐỒNG: công ty của nó, VÀ nghĩa trang của phần mộ nó gắn vào.
   *
   * Hai trục, không một. Bó theo công ty thôi thì người phụ trách nghĩa trang A vẫn thẩm
   * định / cho hiệu lực / huỷ được hợp đồng ở nghĩa trang B cùng công ty — và hợp đồng là
   * căn cứ sinh quyền sử dụng phần mộ, nên đó là chạm vào mộ của nghĩa trang khác.
   *
   * `ExternalContract.gravePlotId` là NOT NULL trong lược đồ, nên neo nghĩa trang LUÔN quy
   * được. Không có nhánh "chỉ kiểm khi khác null" — tức không có chỗ nào để fail-open, đúng
   * cái bẫy đang chặn `createDeceased` (ở đó `Customer.companyId` cho phép NULL).
   *
   * Không tìm thấy phần mộ thì TỪ CHỐI, không bỏ qua. Hợp đồng và phần mộ nằm ở hai schema
   * và KHÔNG có khoá ngoại nối (chỉ `@@index([gravePlotId])`), nên một hợp đồng trỏ vào
   * phần mộ đã biến mất là chuyện xảy ra được. Lúc đó không kiểm được nghĩa trang, và
   * "không kiểm được" phải dẫn tới chặn chứ không phải cho qua.
   */
  private async assertContractInScope(
    contract: { companyId: string; gravePlotId: string },
    caller: Caller,
  ): Promise<void> {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, contract.companyId);
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: contract.gravePlotId },
      select: { cemeteryId: true },
    });
    if (plot === null) {
      throw new ForbiddenException(
        'Không quy được phần mộ của hợp đồng về nghĩa trang nào — không kiểm được phạm vi',
      );
    }
    await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
  }

  async verify(id: string, caller: Caller) {
    const contract = await this.prisma.externalContract.findUnique({
      where: { id },
      include: { parties: true },
    });
    if (contract === null) {
      throw new NotFoundException('Không tìm thấy hợp đồng');
    }
    /* Kiểm phạm vi TRƯỚC mọi phép kiểm trạng thái. Gate `contract.record.verify` trả lời
     * "có được thẩm định hợp đồng hay không", KHÔNG trả lời "hợp đồng NÀO" — nên trước
     * 27/08/2026 người cầm mã này thẩm định được hợp đồng của công ty khác nếu biết id,
     * và thẩm định là bước mở đường cho `activate` sinh quyền sử dụng phần mộ.
     *
     * Đặt trước phép kiểm trạng thái là có chủ đích: kiểm trạng thái trước rồi mới kiểm
     * phạm vi thì câu lỗi "Không thể xác minh ở trạng thái Active" đã kể cho người ngoài
     * phạm vi biết hợp đồng đó TỒN TẠI và đang ở trạng thái nào. */
    await this.assertContractInScope(contract, caller);
    if (contract.status !== 'Uploaded' && contract.status !== 'PendingVerification') {
      throw new ConflictException(`Không thể xác minh ở trạng thái ${contract.status}`);
    }
    if (contract.contractFileId === null) {
      throw new ConflictException('Thiếu file hợp đồng');
    }
    if (contract.parties.length === 0) {
      throw new ConflictException('Thiếu bên hợp đồng');
    }
    /* Người soạn không tự thẩm định hợp đồng của mình. Kiểm ở mức BẢN GHI chứ không chỉ
     * mức vai: ma trận đã tách `create` và `verify` sang hai vai, nhưng ma trận sửa được
     * trên giao diện, nên bất biến phải sống ở chỗ không ai sửa qua màn hình được.
     * `createdBy = null` (hợp đồng cũ trước khi có cột này) thì không chặn — không biết
     * ai soạn thì không khẳng định được là trùng người. */
    if (contract.createdBy !== null && contract.createdBy === caller.userId) {
      throw new ConflictException(
        'Người soạn hợp đồng không được tự thẩm định. Cần người thứ hai xác minh.',
      );
    }
    const updated = await this.prisma.externalContract.update({
      where: { id },
      data: { status: 'Verified', verifiedBy: caller.userId, verifiedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CONTRACT.VERIFIED',
      entityType: 'external_contract',
      entityId: id,
    });
    return updated;
  }

  /* HUỶ hợp đồng — và ĐẢO đúng những gì `activate` đã sinh ra.
   *
   * Mã quyền `contract.record.cancel` có trong danh mục từ đầu, nhưng KHÔNG có endpoint
   * nào. Hậu quả thật: rào chắn xoá khách hàng nói "còn 2 hợp đồng đang hiệu lực, dọn
   * trước" mà hệ không có chỗ nào để dọn — người dùng bị dồn vào ngõ cụt. Một quyền không
   * có đường đi kèm là một quyền chỉ tồn tại trên giấy.
   *
   * Huỷ phải đảo TOÀN BỘ hệ quả của `activate`, không chỉ đổi trạng thái hợp đồng:
   *   - quyền sử dụng do hợp đồng này sinh ra phải chấm dứt
   *   - phần mộ phải trở về trống
   * Bỏ sót một trong hai là để lại một chủ mộ không có hợp đồng, hoặc một phần mộ mang
   * trạng thái `Allocated` mà không ai đứng tên.
   */
  async cancel(id: string, dto: CancelContractDto, caller: Caller) {
    const contract = await this.prisma.externalContract.findUnique({ where: { id } });
    if (contract === null) {
      throw new NotFoundException('Không tìm thấy hợp đồng');
    }
    await this.assertContractInScope(contract, caller);
    if (contract.status === 'Cancelled') {
      throw new ConflictException('Hợp đồng đã huỷ rồi');
    }

    /* CHẶN khi phần mộ đã có người an táng. Huỷ hợp đồng lúc đó là rút căn cứ pháp lý của
     * một việc đã không đảo ngược được — người đã nằm dưới đất rồi. Muốn đổi người chịu
     * trách nhiệm thì đó là SANG TÊN quyền sử dụng, không phải huỷ hợp đồng. */
    const burials = await this.prisma.burialRecord.count({
      where: { gravePlotId: contract.gravePlotId, ...activeBurial() },
    });
    if (burials > 0) {
      throw new ConflictException(
        `Phần mộ của hợp đồng ${contract.contractNo} đã có ${burials} hồ sơ an táng — không huỷ được. Dùng SANG TÊN nếu muốn đổi chủ mộ.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.externalContract.update({
        where: { id },
        data: { status: 'Cancelled', version: { increment: 1 } },
      });

      /* Quyền sử dụng do CHÍNH hợp đồng này sinh ra. Lọc theo `sourceContractId` chứ
       * không theo phần mộ: một phần mộ có thể đã qua nhiều đời hợp đồng, và huỷ hợp đồng
       * này không được đụng vào quyền do hợp đồng khác sinh. */
      const rights = await tx.graveUsageRight.findMany({
        where: { sourceContractId: id, ...activeUsageRight },
        select: { id: true },
      });
      for (const r of rights) {
        await tx.graveUsageRight.update({
          where: { id: r.id },
          data: {
            status: 'Ended',
            effectiveTo: new Date(),
            endedReason: `huỷ hợp đồng ${contract.contractNo}: ${dto.reason}`,
          },
        });
      }

      const plot = await tx.gravePlot.findUnique({ where: { id: contract.gravePlotId } });
      /* Chỉ nhả mộ đang `Allocated`. Mộ đã `Occupied` đã bị chặn ở trên; mộ `Available`
       * thì không có gì để nhả. */
      if (plot !== null && plot.status === 'Allocated') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Available', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Available',
            reason: `huỷ hợp đồng ${contract.contractNo}`,
            changedBy: caller.userId,
          },
        });
      }
      return { cancelled, endedRights: rights.length };
    });

    await this.audit.record({
      companyId: contract.companyId,
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CONTRACT.CANCELLED',
      entityType: 'external_contract',
      entityId: id,
      beforeData: { status: contract.status, contractNo: contract.contractNo },
      afterData: { reason: dto.reason, endedUsageRights: result.endedRights },
    });
    return result.cancelled;
  }

  // Activate → allocate the plot (G0-G3.1). Blocks if required data missing or another
  // Active contract/usage-right already exists on the plot (partial unique indexes).
  async activate(id: string, caller: Caller) {
    const contract = await this.prisma.externalContract.findUnique({
      where: { id },
      include: { parties: true },
    });
    if (contract === null) {
      throw new NotFoundException('Không tìm thấy hợp đồng');
    }
    // Cùng lý do như `verify`: gate mã quyền không gate BẢN GHI. Cho hiệu lực là bước
    // PHÂN BỔ phần mộ và sinh quyền sử dụng, nên đây là chỗ đắt nhất để để hở.
    await this.assertContractInScope(contract, caller);
    if (!ACTIVATABLE_FROM.includes(contract.status)) {
      throw new ConflictException(`Không thể cho hiệu lực ở trạng thái ${contract.status}`);
    }
    // Người gọi được tới đây nghĩa là họ cầm `contract.record.activate`. Đi thẳng từ
    // trạng thái chưa thẩm định là ĐƯỢC PHÉP — nhưng phải để lại vết là đã bỏ bước.
    const skippedVerification = contract.status !== 'Verified';
    const missing: string[] = [];
    if (contract.contractFileId === null) missing.push('file');
    if (contract.parties.length === 0) missing.push('bên hợp đồng');
    if (contract.validTo === null) missing.push('thời hạn');
    if (contract.totalAmount === null) missing.push('khoản thu');
    if (missing.length > 0) {
      throw new ConflictException(`Thiếu: ${missing.join(', ')}`);
    }

    const holder = contract.parties.find((p) => p.role === 'OWNER') ?? contract.parties[0];
    if (holder === undefined) {
      throw new ConflictException('Thiếu bên hợp đồng');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const plot = await tx.gravePlot.findUnique({ where: { id: contract.gravePlotId } });
        if (plot === null) {
          throw new NotFoundException('Không tìm thấy vị trí mộ');
        }
        if (plot.status !== 'Available' && plot.status !== 'Held') {
          throw new ConflictException(`Mộ đang ${plot.status}, không phân bổ được`);
        }
        const activated = await tx.externalContract.update({
          where: { id },
          data: {
            status: 'Active',
            activatedBy: caller.userId,
            activatedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Allocated', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Allocated',
            reason: `contract ${contract.contractNo} activated`,
            changedBy: caller.userId,
          },
        });
        const usageRight = await tx.graveUsageRight.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            holderCustomerId: holder.customerId,
            sourceContractId: id,
            status: 'Active',
            effectiveFrom: contract.signedAt,
            effectiveTo: contract.validTo,
          },
        });
        return { activated, usageRight };
      });
      await this.audit.record({
        companyId: contract.companyId,
        actorType: 'USER',
        actorId: caller.userId,
        action: 'CONTRACT.ACTIVATED',
        entityType: 'external_contract',
        entityId: id,
        reason: skippedVerification
          ? `Cho hiệu lực thẳng từ ${contract.status}, bỏ bước thẩm định (người gọi có quyền cho hiệu lực)`
          : null,
        afterData: {
          fromStatus: contract.status,
          skippedVerification,
          createdBy: contract.createdBy,
          verifiedBy: contract.verifiedBy,
          activatedBy: caller.userId,
        },
        changedFields: ['status'],
      });
      await this.audit.record({
        actorType: 'USER',
        actorId: caller.userId,
        action: 'GRAVE.ALLOCATED',
        entityType: 'grave_plot',
        entityId: contract.gravePlotId,
        afterData: { contractId: id, usageRightId: result.usageRight.id },
      });
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Mộ đã có hợp đồng/quyền sử dụng Active khác');
      }
      throw err;
    }
  }

  /* Đọc một hợp đồng theo id.
   *
   * Tới 27/08/2026 hàm này KHÔNG nhận `caller` và không kiểm phạm vi dòng nào: gate
   * `contract.record.view` trả lời "có được xem hợp đồng hay không", nên ai cầm mã đó đọc
   * được hợp đồng của MỌI công ty chỉ cần biết id. Ratchet phạm vi cũng không thấy, vì cái
   * lưới đó soi method NHẬN `Caller` — hàm không nhận thì nằm ngoài tầm nó.
   *
   * Không tìm thấy thì 404 thay vì trả `null`: trả `null` là đáp 200 với thân rỗng, và màn
   * hình phải tự đoán đó là "không có" hay "có mà rỗng". */
  async get(id: string, caller: Caller) {
    const contract = await this.prisma.externalContract.findUnique({
      where: { id },
      include: { parties: true },
    });
    if (contract === null) {
      throw new NotFoundException('Không tìm thấy hợp đồng');
    }
    await this.assertContractInScope(contract, caller);
    return contract;
  }

  /* Danh sách hợp đồng — bó CẢ HAI trục, y như ba đường ghi.
   *
   * Bó ghi mà để hở đọc là bó nửa vời: danh sách này chính là chỗ lấy được ID hợp đồng của
   * nghĩa trang khác, và id là tất cả những gì cần để gọi ba đường kia.
   */
  async list(companyId: string, caller: Caller, status?: string, gravePlotId?: string) {
    await this.scope.assertCompanyFor(caller.userId, caller.permission, companyId);
    const where: Prisma.ExternalContractWhereInput = { companyId };
    if (status !== undefined) where.status = status;
    if (gravePlotId !== undefined) {
      // Hỏi đúng MỘT phần mộ: phần mộ đó phải nằm trong nghĩa trang người gọi phụ trách.
      const plot = await this.prisma.gravePlot.findUnique({
        where: { id: gravePlotId },
        select: { cemeteryId: true },
      });
      if (plot === null) {
        throw new NotFoundException('Không tìm thấy phần mộ');
      }
      await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
      where.gravePlotId = gravePlotId;
    } else {
      const sites = await this.scope.listSiteFilterFor(caller.userId, caller.permission);
      if (sites !== null) {
        /* Không có quan hệ Prisma giữa hợp đồng và phần mộ (hai schema, không khoá ngoại
         * nối), nên không viết được `where: { gravePlot: { cemeteryId: ... } }` — phải quy
         * ra id phần mộ trước rồi lọc theo `in`.
         *
         * `sites` rỗng thì `in: []` và danh sách rỗng — ĐÚNG: được gán không nghĩa trang
         * nào nghĩa là với tới không cái nào, không phải với tới tất cả. */
        const plots = await this.prisma.gravePlot.findMany({
          where: { companyId, cemeteryId: { in: sites } },
          select: { id: true },
        });
        where.gravePlotId = { in: plots.map((p) => p.id) };
      }
    }
    return this.prisma.externalContract.findMany({ where, orderBy: { createdAt: 'desc' } });
  }
}
