import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  activeBurial,
  completedBurial,
  activeUsageRight,
  confirmedRelationship,
} from '../../common/lifecycle/active';
import type { CreateBurialDto, CreateDeceasedDto } from './burials.dto';

/* Chủ mộ tự an táng vào chính phần mộ mình đứng tên. Không phải một mã trong
 * `relationship_types` — ở đó không có "quan hệ với chính mình" — nên dùng một hằng
 * riêng, và cố ý KHÔNG thêm vào danh mục để không ai gán nó cho hai người khác nhau. */
const SELF_RELATIONSHIP = 'SELF';

@Injectable()
export class BurialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* Lập hồ sơ người mất.
   *
   * NGƯỜI MẤT CŨNG LÀ KHÁCH HÀNG (quyết định 26/08/2026). Ép ở đây chứ không chỉ ở giao
   * diện: hệ từng được dựng theo giả định ngược lại, và hậu quả là 3 người đã được an
   * táng nhưng màn hình khách hàng không bao giờ thấy họ. Một quy ước chỉ sống ở giao
   * diện là quy ước sẽ bị đường khác đi vòng qua.
   */
  async createDeceased(dto: CreateDeceasedDto) {
    const person = await this.prisma.person.findUnique({
      where: { id: dto.personId },
      select: { id: true, fullName: true, customer: { select: { id: true } } },
    });
    if (person === null) {
      throw new NotFoundException('Không tìm thấy nhân thân');
    }
    if (person.customer === null) {
      throw new ConflictException(
        `${person.fullName} chưa có hồ sơ khách hàng — lập hồ sơ khách hàng trước khi ghi nhận đã mất`,
      );
    }
    const existing = await this.prisma.deceasedPerson.findUnique({
      where: { personId: dto.personId },
      select: { id: true },
    });
    /* Đã có hồ sơ thì trả lại chính nó thay vì ném lỗi ràng buộc: giao diện an táng gọi
     * hàm này mỗi lần đặt cốt, và người này có thể được an táng vào mộ thứ hai. */
    if (existing !== null) {
      return this.prisma.deceasedPerson.update({
        where: { id: existing.id },
        data: {
          ...(dto.dateOfDeath !== undefined ? { dateOfDeath: new Date(dto.dateOfDeath) } : {}),
          ...(dto.deathCertFileId !== undefined ? { deathCertFileId: dto.deathCertFileId } : {}),
        },
      });
    }
    return this.prisma.deceasedPerson.create({
      data: {
        id: ulid(),
        personId: dto.personId,
        dateOfDeath: dto.dateOfDeath !== undefined ? new Date(dto.dateOfDeath) : null,
        deathCertFileId: dto.deathCertFileId ?? null,
      },
    });
  }

  // Effective capacity = per-plot override or grave type default (G0-A1).
  private async effectiveCapacity(
    gravePlotId: string,
  ): Promise<{ plotStatus: string; cap: number }> {
    const plot = await this.prisma.gravePlot.findUnique({
      where: { id: gravePlotId },
      include: { graveType: { select: { defaultCapacity: true } } },
    });
    if (plot === null) {
      throw new NotFoundException('Không tìm thấy vị trí mộ');
    }
    return {
      plotStatus: plot.status,
      cap: plot.capacityOverride ?? plot.graveType.defaultCapacity,
    };
  }

  /* Người được an táng phải có quan hệ với chủ mộ (quyết định 2026-08-26).
   *
   * Trả về CĂN CỨ chứ không phải true/false: hồ sơ an táng phải kể được vì sao lúc đó
   * cho phép, kể cả sau khi mộ đổi chủ hoặc quan hệ bị chấm dứt. Hai giá trị trả về được
   * chụp thẳng vào bản ghi.
   *
   * Chỉ nhận quan hệ đã `Confirmed` và còn trong hiệu lực. Quan hệ `Pending`/`Disputed`
   * KHÔNG đủ căn cứ đặt cốt — đó là việc không đảo ngược được.
   */
  private async resolveOwnerRelationship(
    gravePlotId: string,
    deceasedPersonId: string,
  ): Promise<{ ownerCustomerId: string; relationshipToOwner: string }> {
    const right = await this.prisma.graveUsageRight.findFirst({
      where: { gravePlotId, ...activeUsageRight },
      orderBy: { createdAt: 'desc' },
    });
    if (right === null) {
      throw new ConflictException(
        'Mộ chưa có chủ đứng tên (chưa có quyền sử dụng hiệu lực) — không xác định được quan hệ',
      );
    }
    const owner = await this.prisma.customer.findUnique({
      where: { id: right.holderCustomerId },
      select: { id: true, personId: true },
    });
    if (owner === null) {
      throw new NotFoundException('Không tìm thấy chủ mộ');
    }
    if (owner.personId === null) {
      /* Khách hàng tổ chức không có nhân thân để đối chiếu. CHƯA có quyết định về trường
       * hợp này, nên chặn thay vì tự bịa ra một ngoại lệ — mở ngoại lệ ở đây là mở một
       * đường vòng qua toàn bộ luật quan hệ. */
      throw new ConflictException(
        'Mộ do khách hàng tổ chức đứng tên — chưa có quy tắc quan hệ nhân thân cho trường hợp này',
      );
    }
    const deceased = await this.prisma.deceasedPerson.findUnique({
      where: { id: deceasedPersonId },
      select: { personId: true },
    });
    if (deceased === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ người mất');
    }
    if (deceased.personId === owner.personId) {
      return { ownerCustomerId: owner.id, relationshipToOwner: SELF_RELATIONSHIP };
    }

    const today = new Date();
    const inEffect = [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
    ];
    // Hướng thuận: người mất LÀ GÌ của chủ mộ — đúng chiều cần in ra thẻ.
    const direct = await this.prisma.familyRelationship.findFirst({
      where: {
        sourcePersonId: deceased.personId,
        targetPersonId: owner.personId,
        ...confirmedRelationship,
        AND: inEffect,
      },
    });
    if (direct !== null) {
      return { ownerCustomerId: owner.id, relationshipToOwner: direct.relationshipType };
    }
    /* Dự phòng cho dữ liệu nhập từ hệ cũ chưa có dòng đối ứng: đọc chiều ngược rồi quy
     * về chiều thuận qua `reciprocalCode`. Suy ra bằng danh mục, không tự đặt tên. */
    const reverse = await this.prisma.familyRelationship.findFirst({
      where: {
        sourcePersonId: owner.personId,
        targetPersonId: deceased.personId,
        ...confirmedRelationship,
        AND: inEffect,
      },
    });
    if (reverse !== null) {
      const rtype = await this.prisma.relationshipType.findUnique({
        where: { code: reverse.relationshipType },
        select: { reciprocalCode: true },
      });
      if (rtype === null) {
        throw new ConflictException(
          `Quan hệ "${reverse.relationshipType}" không có trong danh mục — không quy được chiều`,
        );
      }
      return { ownerCustomerId: owner.id, relationshipToOwner: rtype.reciprocalCode };
    }
    throw new ConflictException(
      'Người được an táng chưa có quan hệ nhân thân đã xác nhận với chủ mộ',
    );
  }

  /* Cốt phải nằm trong sức chứa và chưa ai chiếm.
   *
   * Kiểm ở đây là để BÁO LỖI ĐỌC ĐƯỢC — "cốt 3 đã có người" thay vì một lỗi ràng buộc
   * CSDL khó hiểu. Nhưng nó KHÔNG phải chỗ bảo đảm: hai người bấm cùng lúc thì cả hai
   * cùng thấy cốt trống rồi cùng ghi (TOCTOU). Chỗ bảo đảm thật là partial unique index
   * `burial_records_active_slot`, và lỗi của nó được dịch lại ở `createBurial`.
   */
  private async assertSlotAvailable(
    gravePlotId: string,
    slotNumber: number | undefined,
    capacity: number,
  ): Promise<void> {
    if (slotNumber === undefined) {
      return;
    }
    if (slotNumber > capacity) {
      throw new ConflictException(`Phần mộ chỉ có ${capacity} cốt — không có cốt số ${slotNumber}`);
    }
    const taken = await this.prisma.burialRecord.findFirst({
      where: { gravePlotId, slotNumber, ...activeBurial() },
      include: { deceased: { include: { person: { select: { fullName: true } } } } },
    });
    if (taken !== null) {
      throw new ConflictException(`Cốt số ${slotNumber} đã có ${taken.deceased.person.fullName}`);
    }
  }

  async createBurial(dto: CreateBurialDto, actor: string | null) {
    const { plotStatus, cap } = await this.effectiveCapacity(dto.gravePlotId);
    if (plotStatus !== 'Allocated' && plotStatus !== 'Occupied') {
      throw new ConflictException(
        `Mộ đang ${plotStatus}, cần phân bổ (hợp đồng) trước khi an táng`,
      );
    }
    const activeCount = await this.prisma.burialRecord.count({
      where: { gravePlotId: dto.gravePlotId, ...activeBurial() },
    });
    if (activeCount >= cap) {
      throw new ConflictException(`Vượt sức chứa mộ (${activeCount}/${cap})`);
    }
    const { ownerCustomerId, relationshipToOwner } = await this.resolveOwnerRelationship(
      dto.gravePlotId,
      dto.deceasedPersonId,
    );
    await this.assertSlotAvailable(dto.gravePlotId, dto.slotNumber, cap);
    /* Ràng buộc CSDL là chỗ bảo đảm thật cho "một cốt một người" — nhưng lỗi nó ném ra là
     * `P2002 unique constraint`, đọc lên màn hình thì vô nghĩa với người dùng. Dịch lại
     * đúng một mã lỗi đó; mọi lỗi khác để nguyên, nuốt hết là giấu mất lỗi thật. */
    let burial;
    try {
      burial = await this.prisma.burialRecord.create({
        data: {
          id: ulid(),
          gravePlotId: dto.gravePlotId,
          deceasedPersonId: dto.deceasedPersonId,
          contractId: dto.contractId ?? null,
          slotNumber: dto.slotNumber ?? null,
          ownerCustomerId,
          relationshipToOwner,
          burialDate: dto.burialDate !== undefined ? new Date(dto.burialDate) : null,
          legalDocFileId: dto.legalDocFileId ?? null,
          notes: dto.notes ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          `Cốt số ${dto.slotNumber} vừa có người khác nhận — chọn cốt khác`,
        );
      }
      throw e;
    }
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.CREATED',
      entityType: 'burial_record',
      entityId: burial.id,
      afterData: {
        gravePlotId: dto.gravePlotId,
        deceasedPersonId: dto.deceasedPersonId,
        slotNumber: dto.slotNumber ?? null,
        ownerCustomerId,
        relationshipToOwner,
      },
    });
    return burial;
  }

  async verify(id: string, actor: string | null) {
    const burial = await this.prisma.burialRecord.findUnique({ where: { id } });
    if (burial === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ an táng');
    }
    if (burial.status !== 'Draft') {
      throw new ConflictException(`Không thể xác minh ở trạng thái ${burial.status}`);
    }
    const updated = await this.prisma.burialRecord.update({
      where: { id },
      data: { status: 'Verified' },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.VERIFIED',
      entityType: 'burial_record',
      entityId: id,
    });
    return updated;
  }

  // Complete a burial → plot becomes Occupied (re-checks capacity). Blueprint M4.
  async complete(id: string, actor: string | null) {
    const burial = await this.prisma.burialRecord.findUnique({ where: { id } });
    if (burial === null) {
      throw new NotFoundException('Không tìm thấy hồ sơ an táng');
    }
    if (burial.status !== 'Verified' && burial.status !== 'Scheduled') {
      throw new ConflictException(
        `Chỉ hoàn tất hồ sơ đã Verified/Scheduled (đang ${burial.status})`,
      );
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const plot = await tx.gravePlot.findUnique({
        where: { id: burial.gravePlotId },
        include: { graveType: { select: { defaultCapacity: true } } },
      });
      if (plot === null) {
        throw new NotFoundException('Không tìm thấy vị trí mộ');
      }
      const cap = plot.capacityOverride ?? plot.graveType.defaultCapacity;
      const completedCount = await tx.burialRecord.count({
        where: { gravePlotId: burial.gravePlotId, ...completedBurial },
      });
      if (completedCount >= cap) {
        throw new ConflictException(`Vượt sức chứa mộ (${completedCount}/${cap})`);
      }
      const updated = await tx.burialRecord.update({
        where: { id },
        data: { status: 'Completed', version: { increment: 1 } },
      });
      if (plot.status !== 'Occupied') {
        await tx.gravePlot.update({
          where: { id: plot.id },
          data: { status: 'Occupied', version: { increment: 1 } },
        });
        await tx.gravePlotStatusHistory.create({
          data: {
            id: ulid(),
            gravePlotId: plot.id,
            fromStatus: plot.status,
            toStatus: 'Occupied',
            reason: `burial ${id} completed`,
            changedBy: actor,
          },
        });
      }
      return { updated, plotId: plot.id };
    });

    // Audit outside the transaction (AuditService opens its own tx).
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'BURIAL.COMPLETED',
      entityType: 'burial_record',
      entityId: id,
      afterData: { gravePlotId: result.plotId },
    });
    return result.updated;
  }

  get(id: string) {
    return this.prisma.burialRecord.findUnique({
      where: { id },
      include: { deceased: { include: { person: { select: { id: true, fullName: true } } } } },
    });
  }

  list(gravePlotId?: string, status?: string) {
    return this.prisma.burialRecord.findMany({
      where: {
        ...(gravePlotId !== undefined ? { gravePlotId } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
