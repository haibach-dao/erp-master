import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { PiiService } from '../../common/pii/pii.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
import {
  activeBurial,
  activeSubRecord,
  activeTag,
  activeUsageRight,
} from '../../common/lifecycle/active';
import {
  CUSTOMER_BLOCKING_REFERENCES,
  CUSTOMER_CASCADE_REFERENCES,
  CUSTOMER_DETACH_REFERENCES,
} from '../../common/lifecycle/customer-references';
import {
  PERSON_BLOCKING_REFERENCES,
  PERSON_CASCADE_REFERENCES,
} from '../../common/lifecycle/person-references';
import { effectiveCapacity } from '../../common/cemetery/capacity';
import type {
  AddPersonAddressDto,
  AddPersonBankAccountDto,
  AddPersonEducationDto,
  AddPersonPhoneDto,
  CreateCustomerDto,
  CreatePersonDto,
  CreateRelationshipDto,
  UpdateCustomerDto,
} from './customers.dto';

interface DedupWarning {
  reason: string;
  matches: unknown[];
}

/* ---- Bộ lọc danh sách khách hàng ----
 *
 * DANH SÁCH ĐÓNG cho mọi trục có tập giá trị hữu hạn, và giá trị lạ bị TỪ CHỐI ở DTO chứ
 * không bị bỏ qua âm thầm. Bỏ qua âm thầm là cách một bộ lọc gõ sai (`deceased` thay vì
 * `Deceased`) trả về đúng dữ liệu mà người dùng tưởng là đã lọc.
 */

/** Còn sống / đã mất. `all` là mặc định, và phải khai tường minh chứ không để `undefined`. */
export const LIFE_STATUS = ['all', 'alive', 'deceased'] as const;
export type LifeStatus = (typeof LIFE_STATUS)[number];

/** Đang đứng tên phần mộ hay chưa. */
export const GRAVE_OWNER_FILTER = ['all', 'yes', 'no'] as const;
export type GraveOwnerFilter = (typeof GRAVE_OWNER_FILTER)[number];

export interface CustomerFilters {
  q?: string;
  lifeStatus?: LifeStatus;
  graveOwner?: GraveOwnerFilter;
  /** Đứng tên mộ Ở nghĩa trang này. Kiểm phạm vi trước khi dùng. */
  cemeteryId?: string;
  companyId?: string;
  /** `Customer.type`: INDIVIDUAL | ORGANIZATION | AGENT | PROSPECT. */
  type?: string;
  /** `Customer.status`: active | inactive. */
  status?: string;
  /** Đang mang thẻ nhãn này. Một thẻ mỗi lần ở đợt 1. */
  tagTypeId?: string;
  limit?: number;
}

/* Trần cứng cho số dòng trả về.
 *
 * Có trần vì không có trần thì một truy vấn `?limit=100000` biến endpoint này thành cổng
 * trích xuất toàn bộ danh sách khách hàng — mà trích xuất là mã quyền KHÁC
 * (`crm.customer.export`, S3). Không để client tự chọn nghĩa là không để client tự nâng
 * cấp quyền của mình bằng một tham số URL.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function notBlank(v: string | undefined | null): boolean {
  return v !== undefined && v !== null && v !== '';
}

/* "Đã mất" suy từ SỰ TỒN TẠI của hồ sơ người mất, không từ một cờ riêng — cùng một sự thật
 * với chỗ hiển thị, nên hai nơi không thể mâu thuẫn.
 *
 * Khách hàng TỔ CHỨC (`personId = null`) không sống cũng không mất. Họ rơi khỏi CẢ HAI
 * nhánh, và đó là câu trả lời đúng: một công ty không có ngày mất. Ai muốn thấy họ thì để
 * `all` hoặc lọc theo `type`.
 */
function lifeStatusWhere(status: LifeStatus | undefined): Prisma.CustomerWhereInput {
  if (status === 'deceased') {
    return { person: { deceased: { isNot: null } } };
  }
  if (status === 'alive') {
    return { person: { deceased: { is: null } } };
  }
  return {};
}

/* Tìm tự do. Chuỗi rỗng KHÔNG được sinh mệnh đề nào.
 *
 * `contains: ''` khớp mọi dòng nên nhìn qua tưởng vô hại — nhưng nó vẫn là một `OR` gồm 5
 * nhánh, và nhánh `person.fullName` ép Postgres nối bảng `persons` cho mọi truy vấn kể cả
 * khi người dùng chưa gõ gì. Bỏ hẳn khi rỗng là rẻ hơn và nói đúng ý hơn.
 */
function freeTextWhere(q: string): Prisma.CustomerWhereInput {
  if (q === '') {
    return {};
  }
  return {
    OR: [
      { customerCode: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
      { orgName: { contains: q, mode: 'insensitive' } },
      { person: { fullName: { contains: q, mode: 'insensitive' } } },
    ],
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: PiiService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private personData(dto: CreatePersonDto): Prisma.PersonCreateInput {
    const nid = dto.nationalId;
    return {
      id: ulid(),
      fullName: dto.fullName,
      gender: dto.gender ?? null,
      dateOfBirth: dto.dateOfBirth !== undefined ? new Date(dto.dateOfBirth) : null,
      nationalIdHash: nid !== undefined && nid.length > 0 ? this.pii.hash(nid) : null,
      nationalIdMasked: nid !== undefined && nid.length > 0 ? this.pii.mask(nid) : null,
      nationalIdCipher: nid !== undefined && nid.length > 0 ? this.pii.encrypt(nid) : null,
      nationalIdIssuedOn:
        dto.nationalIdIssuedOn !== undefined ? new Date(dto.nationalIdIssuedOn) : null,
      nationalIdIssuedPlace: dto.nationalIdIssuedPlace ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      permanentAddress: dto.permanentAddress ?? null,
      contactAddress: dto.contactAddress ?? null,
      placeOfBirth: dto.placeOfBirth ?? null,
      ethnicity: dto.ethnicity ?? null,
      religion: dto.religion ?? null,
    };
  }

  // Warn on likely duplicates (CCCD hash exact, similar name, phone/email). Never auto-merge.
  async findDuplicates(input: {
    fullName?: string;
    nationalId?: string;
    phone?: string;
    email?: string;
  }): Promise<DedupWarning[]> {
    const warnings: DedupWarning[] = [];
    if (input.nationalId !== undefined && input.nationalId.length > 0) {
      const matches = await this.prisma.person.findMany({
        where: { nationalIdHash: this.pii.hash(input.nationalId) },
        select: { id: true, fullName: true, nationalIdMasked: true },
      });
      if (matches.length > 0) warnings.push({ reason: 'SAME_NATIONAL_ID', matches });
    }
    if (input.fullName !== undefined && input.fullName.length > 0) {
      const matches = await this.prisma.person.findMany({
        where: { fullName: { contains: input.fullName, mode: 'insensitive' } },
        select: { id: true, fullName: true },
        take: 5,
      });
      if (matches.length > 0) warnings.push({ reason: 'SIMILAR_NAME', matches });
    }
    const orClauses: Prisma.CustomerWhereInput[] = [];
    if (input.phone !== undefined && input.phone.length > 0) orClauses.push({ phone: input.phone });
    if (input.email !== undefined && input.email.length > 0) orClauses.push({ email: input.email });
    if (orClauses.length > 0) {
      const matches = await this.prisma.customer.findMany({
        where: { OR: orClauses },
        select: { id: true, customerCode: true, phone: true, email: true },
        take: 5,
      });
      if (matches.length > 0) warnings.push({ reason: 'SAME_PHONE_OR_EMAIL', matches });
    }
    return warnings;
  }

  async createPerson(dto: CreatePersonDto, actor: string | null) {
    const warnings = await this.findDuplicates({
      fullName: dto.fullName,
      ...(dto.nationalId !== undefined ? { nationalId: dto.nationalId } : {}),
    });
    const person = await this.prisma.person.create({ data: this.personData(dto) });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'PERSON.CREATED',
      entityType: 'person',
      entityId: person.id,
      afterData: { fullName: person.fullName, nationalId: dto.nationalId },
    });
    return { person, warnings };
  }

  async createCustomer(dto: CreateCustomerDto, actor: string | null) {
    let personId = dto.personId ?? null;
    let warnings: DedupWarning[] = [];

    if (dto.type === 'INDIVIDUAL' && personId === null) {
      if (dto.person === undefined) {
        throw new BadRequestException('INDIVIDUAL cần personId hoặc person');
      }
      const created = await this.createPerson(dto.person, actor);
      personId = created.person.id;
      warnings = created.warnings;
    }

    warnings = warnings.concat(
      await this.findDuplicates({
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
      }),
    );

    const customer = await this.prisma.customer.create({
      data: {
        id: ulid(),
        personId,
        customerCode: `KH-${ulid().slice(-8)}`,
        type: dto.type,
        orgName: dto.orgName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        companyId: dto.companyId ?? null,
      },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.CREATED',
      entityType: 'customer',
      entityId: customer.id,
      afterData: { customerCode: customer.customerCode, type: customer.type },
    });
    return { customer, warnings };
  }

  // Create A->B and auto-create reciprocal B->A in one transaction; audit both (doc 04 §2.1).
  async createRelationship(dto: CreateRelationshipDto, actor: string | null) {
    if (dto.sourcePersonId === dto.targetPersonId) {
      throw new BadRequestException('Không thể tạo quan hệ với chính mình');
    }
    const rtype = await this.prisma.relationshipType.findUnique({
      where: { code: dto.relationshipType },
    });
    if (rtype === null) {
      throw new BadRequestException('relationshipType không hợp lệ');
    }
    const existing = await this.prisma.familyRelationship.findFirst({
      where: {
        sourcePersonId: dto.sourcePersonId,
        targetPersonId: dto.targetPersonId,
        relationshipType: rtype.code,
        status: { not: 'Ended' },
      },
    });
    if (existing !== null) {
      /* Truy vấn ở trên kiểm dòng CÙNG CHIỀU (source -> target), không phải dòng đối ứng —
       * thông báo cũ ghi "quan hệ đối ứng" nên người đọc đi tìm nhầm dòng. Thông báo tả
       * sai việc mã vừa làm thì người dùng sẽ sửa nhầm chỗ. */
      throw new ConflictException('Quan hệ này đã được khai và còn hiệu lực');
    }

    const idA = ulid();
    const idB = ulid();
    const effectiveFrom = dto.effectiveFrom !== undefined ? new Date(dto.effectiveFrom) : null;
    const verificationSource = dto.verificationSource ?? null;

    const [rowA, rowB] = await this.prisma.$transaction([
      this.prisma.familyRelationship.create({
        data: {
          id: idA,
          sourcePersonId: dto.sourcePersonId,
          targetPersonId: dto.targetPersonId,
          relationshipType: rtype.code,
          reciprocalRelationshipId: idB,
          status: 'Confirmed',
          effectiveFrom,
          verificationSource,
        },
      }),
      this.prisma.familyRelationship.create({
        data: {
          id: idB,
          sourcePersonId: dto.targetPersonId,
          targetPersonId: dto.sourcePersonId,
          relationshipType: rtype.reciprocalCode,
          reciprocalRelationshipId: idA,
          status: 'Confirmed',
          effectiveFrom,
          verificationSource,
        },
      }),
    ]);

    for (const row of [rowA, rowB]) {
      await this.audit.record({
        actorType: 'USER',
        actorId: actor,
        action: 'FAMILY_RELATION.CREATED',
        entityType: 'family_relationship',
        entityId: row.id,
        afterData: {
          source: row.sourcePersonId,
          target: row.targetPersonId,
          type: row.relationshipType,
        },
      });
    }
    return { relationship: rowA, reciprocal: rowB };
  }

  // End A->B and its reciprocal in one transaction; audit both.
  async endRelationship(id: string, actor: string | null) {
    const rel = await this.prisma.familyRelationship.findUnique({ where: { id } });
    if (rel === null) {
      throw new NotFoundException('Không tìm thấy quan hệ');
    }
    /* Đã chấm dứt rồi thì thôi.
     *
     * Trước đây không kiểm: gọi lại lần hai sẽ ghi đè `effectiveTo` sang ngày HÔM NAY, tức
     * là sửa lại quá khứ — quan hệ chấm dứt từ tháng trước bỗng thành chấm dứt hôm nay, và
     * mọi câu hỏi "lúc an táng thì quan hệ còn hiệu lực không" sẽ được trả lời sai. */
    if (rel.status === 'Ended') {
      throw new ConflictException('Quan hệ này đã chấm dứt rồi');
    }
    const endedAt = new Date();
    const ids = [
      id,
      ...(rel.reciprocalRelationshipId !== null ? [rel.reciprocalRelationshipId] : []),
    ];
    await this.prisma.$transaction(
      ids.map((rid) =>
        this.prisma.familyRelationship.update({
          where: { id: rid },
          data: { status: 'Ended', effectiveTo: endedAt },
        }),
      ),
    );
    for (const rid of ids) {
      await this.audit.record({
        actorType: 'USER',
        actorId: actor,
        action: 'FAMILY_RELATION.ENDED',
        entityType: 'family_relationship',
        entityId: rid,
      });
    }
    return { endedIds: ids };
  }

  getPersonRelationships(personId: string) {
    return this.prisma.familyRelationship.findMany({
      where: { sourcePersonId: personId },
      /* Cần cả giới tính VÀ ngày sinh để đặt được nhãn cụ thể: "bố đẻ" hay "mẹ đẻ" suy từ
       * giới tính; "anh trai" hay "em trai" còn cần so tuổi. */
      include: {
        target: {
          select: { id: true, fullName: true, gender: true, dateOfBirth: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* Hồ sơ khách hàng 360 — một lần gọi cho cả màn hình chi tiết.
   *
   * Gộp ở API chứ không để giao diện gọi năm lần rồi tự ghép: năm lời gọi là năm trạng
   * thái tải khác nhau, và màn hình sẽ hiện ra từng mảnh một. Quan trọng hơn, mọi mảnh
   * đều đi qua CÙNG một lớp che — ghép ở client thì mỗi mảnh che theo một đường.
   *
   * Chỉ trả mục còn hiệu lực ở các bảng phụ; mục đã ngừng dùng thuộc màn hình lịch sử.
   */
  async getCustomerDetail(customerId: string) {
    const activeSub = { where: activeSubRecord, orderBy: { createdAt: 'asc' } } as const;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        person: {
          include: {
            phones: activeSub,
            addresses: activeSub,
            education: activeSub,
            bankAccounts: activeSub,
            /* Còn sống hay đã mất. Suy từ sự tồn tại của hồ sơ người mất chứ không từ
             * một cờ riêng — cờ riêng là thứ lệch được với hồ sơ an táng. */
            deceased: { select: { id: true, dateOfDeath: true, deathCertFileId: true } },
          },
        },
      },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    /* Phần mộ đang đứng tên. Đi qua `GraveUsageRight` chứ không qua hợp đồng: quyền sử
     * dụng mới là thứ nói ai đang là chủ mộ HÔM NAY, hợp đồng chỉ là căn cứ sinh ra nó. */
    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: customerId, ...activeUsageRight },
      orderBy: { createdAt: 'asc' },
    });
    const plots =
      rights.length === 0
        ? []
        : await this.prisma.gravePlot.findMany({
            where: { id: { in: rights.map((r) => r.gravePlotId) } },
            include: { cemetery: { select: { name: true } }, graveType: true },
          });
    const plotById = new Map(plots.map((pl) => [pl.id, pl]));

    /* AI ĐANG NẰM trong từng phần mộ khách này đứng tên.
     *
     * VÌ SAO Ở ĐÂY, KHÔNG Ở GIAO DIỆN (chủ doanh nghiệp nêu 27/08/2026): bảng "Phần mộ đứng
     * tên" trước đây chỉ có mã mộ / vị trí / trạng thái / sức chứa. An táng xong, màn hình
     * KHÔNG đổi một chữ — nên việc vừa làm nhìn như không ăn. Để giao diện tự gọi
     * `plotOwnership` cho từng dòng thì thành N lượt gọi và N ô nhấp nháy chờ tải, cho một
     * thứ vốn đã nằm sẵn cạnh dữ liệu đang lấy.
     *
     * MỘT truy vấn cho MỌI mộ (`in`), không phải một truy vấn mỗi mộ.
     *
     * Dùng ĐÚNG `activeBurial()` và đúng `orderBy` như `CemeteryService.plotOwnership`. Hai
     * màn hình kể về cùng một phần mộ thì phải kể cùng một chuyện: lệch bộ lọc ở đây là
     * bảng nói "còn trống" trong khi hộp thoại nói "đã kín" — đúng lớp lỗi mà
     * `common/lifecycle/active.ts` sinh ra để dẹp. */
    const occupantRows =
      plots.length === 0
        ? []
        : await this.prisma.burialRecord.findMany({
            where: { gravePlotId: { in: plots.map((pl) => pl.id) }, ...activeBurial() },
            include: {
              deceased: {
                include: {
                  person: { select: { id: true, fullName: true, gender: true, dateOfBirth: true } },
                },
              },
            },
            orderBy: [{ slotNumber: 'asc' }, { createdAt: 'asc' }],
          });
    const occupantsByPlot = new Map<string, typeof occupantRows>();
    for (const row of occupantRows) {
      const list = occupantsByPlot.get(row.gravePlotId);
      if (list === undefined) {
        occupantsByPlot.set(row.gravePlotId, [row]);
      } else {
        list.push(row);
      }
    }

    const relationships =
      customer.personId === null
        ? []
        : await this.prisma.familyRelationship.findMany({
            where: { sourcePersonId: customer.personId, status: { not: 'Ended' } },
            /* Cần cả giới tính VÀ ngày sinh để đặt được nhãn cụ thể: "bố đẻ" hay "mẹ đẻ" suy từ
             * giới tính; "anh trai" hay "em trai" còn cần so tuổi. */
            include: {
              target: {
                select: { id: true, fullName: true, gender: true, dateOfBirth: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          });

    /* NƠI AN NGHỈ — mộ khách này NẰM TRONG, khác hẳn `gravePlots` là mộ khách này ĐỨNG TÊN.
     *
     * VÌ SAO KHỐI NÀY PHẢI CÓ (27/08/2026): thiếu nó, hồ sơ an táng đang CHẶN xoá khách
     * hàng lại VÔ HÌNH trên chính màn hình của họ. Người dùng đọc "đã được an táng (1 hồ
     * sơ)", mở hết năm tab không thấy hồ sơ nào, và kết luận là hệ báo sai. Đó đúng là cái
     * "hai chỗ trả lời khác nhau cho cùng một câu hỏi" mà `common/lifecycle/active.ts` sinh
     * ra để dẹp — chỉ khác là lần này một trong hai chỗ không trả lời gì cả.
     *
     * KHÔNG lọc `activeBurial()` — NGOẠI LỆ CÓ CHỦ ĐÍCH theo đúng quy ước ở `active.ts`:
     * đây là khối LỊCH SỬ, và hồ sơ đã huỷ chính là thứ giải thích vì sao một cốt từng bị
     * giữ rồi lại trống. Bù lại, `restingPlacesActive` đếm riêng phần CÒN HIỆU LỰC để con
     * số trên tab khớp với con số trong lời từ chối xoá — hai con số lệch nhau là tái lập
     * đúng cái bệnh đang chữa.
     */
    const burials =
      customer.personId === null
        ? []
        : await this.prisma.burialRecord.findMany({
            where: { deceased: { personId: customer.personId } },
            orderBy: { createdAt: 'desc' },
          });
    /* `BurialRecord.gravePlotId` và `ownerCustomerId` là con trỏ LỎNG (không có quan hệ
     * Prisma), nên phải tra hai lượt riêng. Cùng lối `plotById` đã dùng cho `gravePlots`. */
    const burialPlots =
      burials.length === 0
        ? []
        : await this.prisma.gravePlot.findMany({
            where: { id: { in: burials.map((b) => b.gravePlotId) } },
            include: { cemetery: { select: { name: true } } },
          });
    const burialPlotById = new Map(burialPlots.map((pl) => [pl.id, pl]));
    const ownerIds = burials
      .map((b) => b.ownerCustomerId)
      .filter((id): id is string => id !== null);
    const owners =
      ownerIds.length === 0
        ? []
        : await this.prisma.customer.findMany({
            where: { id: { in: ownerIds } },
            select: {
              id: true,
              customerCode: true,
              orgName: true,
              person: { select: { fullName: true } },
            },
          });
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    return {
      ...customer,
      restingPlaces: burials.map((b) => {
        const plot = burialPlotById.get(b.gravePlotId);
        const owner = b.ownerCustomerId === null ? undefined : ownerById.get(b.ownerCustomerId);
        return {
          burialRecordId: b.id,
          gravePlotId: b.gravePlotId,
          plotCode: plot?.plotCode ?? null,
          cemeteryName: plot?.cemetery.name ?? null,
          slotNumber: b.slotNumber,
          status: b.status,
          burialDate: b.burialDate,
          cancelledAt: b.cancelledAt,
          cancelReason: b.cancelReason,
          /* Chủ mộ và quan hệ là ẢNH CHỤP lúc đặt cốt (xem chú thích ở schema) — trả đúng
           * cái đã lưu, KHÔNG tính lại từ quan hệ hiện tại. Chủ mộ có thể đã đổi vì kế
           * thừa, và quan hệ có thể đã chấm dứt; hồ sơ vẫn phải kể đúng căn cứ hồi đó. */
          ownerCustomerId: b.ownerCustomerId,
          ownerCustomerCode: owner?.customerCode ?? null,
          ownerName: owner?.person?.fullName ?? owner?.orgName ?? null,
          relationshipToOwner: b.relationshipToOwner,
        };
      }),
      gravePlots: rights.map((r) => {
        const plot = plotById.get(r.gravePlotId);
        return {
          /* Id của QUYỀN, không chỉ id của mộ: thu hồi và sang tên thao tác trên quyền
           * sử dụng, và bắt giao diện đi tra lại quyền từ id mộ là một lượt gọi thừa cho
           * thứ vốn đã có sẵn ở đây. */
          usageRightId: r.id,
          gravePlotId: r.gravePlotId,
          plotCode: plot?.plotCode ?? null,
          cemeteryName: plot?.cemetery.name ?? null,
          zone: plot?.zone ?? null,
          block: plot?.block ?? null,
          row: plot?.row ?? null,
          status: plot?.status ?? null,
          capacity: plot === undefined ? null : effectiveCapacity(plot),
          effectiveFrom: r.effectiveFrom,
          /* Trả cả `gender` và `dateOfBirth`: nhãn quan hệ ("anh trai" hay "em trai") suy
           * từ giới tính VÀ so tuổi với chủ mộ, nên thiếu hai trường này thì giao diện phải
           * lùi về nhãn trung tính. Xem `lib/relationship` bên web. */
          occupants: (occupantsByPlot.get(r.gravePlotId) ?? []).map((b) => ({
            burialRecordId: b.id,
            slotNumber: b.slotNumber,
            personId: b.deceased.person.id,
            fullName: b.deceased.person.fullName,
            gender: b.deceased.person.gender,
            dateOfBirth: b.deceased.person.dateOfBirth,
            relationshipToOwner: b.relationshipToOwner,
            /* Trạng thái hồ sơ an táng: `Draft` -> `Verified` -> `Completed`. Bảng phần mộ
             * phải nói ra được hồ sơ nào còn thiếu bước, nếu không nó in một cái tên như thể
             * việc đã xong trong khi phần mộ vẫn chưa chuyển sang `Occupied`. */
            status: b.status,
          })),
        };
      }),
      relationships,
    };
  }

  /* ---- Sửa hồ sơ khách hàng ----
   *
   * Nhận cả trường của Customer lẫn của Person trong MỘT lời gọi: với người dùng đó là
   * một hồ sơ, và bắt họ lưu hai lần ở hai chỗ là chỗ dữ liệu lệch nhau khi lần lưu thứ
   * hai thất bại.
   *
   * CCCD sửa được nhưng phải sinh lại CẢ BA cột (hash để chống trùng, masked để hiện,
   * cipher để lưu) — sửa một cột là ba câu trả lời khác nhau về cùng một số.
   */
  async updateCustomer(customerId: string, dto: UpdateCustomerDto, actor: string | null) {
    const before = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: true },
    });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }

    const customerData: Prisma.CustomerUpdateInput = {};
    if (dto.type !== undefined) customerData.type = dto.type;
    if (dto.orgName !== undefined) customerData.orgName = dto.orgName === '' ? null : dto.orgName;
    if (dto.phone !== undefined) customerData.phone = dto.phone === '' ? null : dto.phone;
    if (dto.email !== undefined) customerData.email = dto.email === '' ? null : dto.email;

    const dp = dto.person;
    const personData: Prisma.PersonUpdateInput = {};
    if (dp !== undefined) {
      if (before.personId === null) {
        throw new BadRequestException(
          'Khách hàng tổ chức không có hồ sơ nhân thân để sửa — đổi loại khách hàng trước',
        );
      }
      /* Chỉ gọi bên trong nhánh đã kiểm `!== undefined`, nên tham số là `string` chắc
       * chắn. Nhận `string | undefined` ở đây thì kiểu trả về cũng mang `undefined`, và
       * `exactOptionalPropertyTypes` sẽ từ chối gán vào ô không nhận undefined. */
      const text = (v: string): string | null => (v === '' ? null : v);
      const date = (v: string): Date | null => (v === '' ? null : new Date(v));

      if (dp.fullName !== undefined) personData.fullName = dp.fullName;
      if (dp.gender !== undefined) personData.gender = text(dp.gender);
      if (dp.dateOfBirth !== undefined) personData.dateOfBirth = date(dp.dateOfBirth);
      if (dp.nationalIdIssuedOn !== undefined)
        personData.nationalIdIssuedOn = date(dp.nationalIdIssuedOn);
      if (dp.nationalIdIssuedPlace !== undefined)
        personData.nationalIdIssuedPlace = text(dp.nationalIdIssuedPlace);
      if (dp.phone !== undefined) personData.phone = text(dp.phone);
      if (dp.email !== undefined) personData.email = text(dp.email);
      if (dp.permanentAddress !== undefined)
        personData.permanentAddress = text(dp.permanentAddress);
      if (dp.contactAddress !== undefined) personData.contactAddress = text(dp.contactAddress);
      if (dp.placeOfBirth !== undefined) personData.placeOfBirth = text(dp.placeOfBirth);
      if (dp.ethnicity !== undefined) personData.ethnicity = text(dp.ethnicity);
      if (dp.religion !== undefined) personData.religion = text(dp.religion);
      if (dp.nationalId !== undefined) {
        const nid = dp.nationalId;
        personData.nationalIdHash = nid === '' ? null : this.pii.hash(nid);
        personData.nationalIdMasked = nid === '' ? null : this.pii.mask(nid);
        personData.nationalIdCipher = nid === '' ? null : this.pii.encrypt(nid);
      }
    }

    const personId = before.personId;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (personId !== null && Object.keys(personData).length > 0) {
        await tx.person.update({ where: { id: personId }, data: personData });
      }
      return Object.keys(customerData).length > 0
        ? tx.customer.update({ where: { id: customerId }, data: customerData })
        : before;
    });

    /* Audit ghi TÊN TRƯỜNG đã đổi, KHÔNG ghi giá trị của trường nhạy cảm. Nhật ký đọc
     * được bằng một mã quyền KHÁC với mã mở khoá CCCD — chép giá trị vào đó là mở một cửa
     * sau vòng qua lớp che. */
    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.UPDATED',
      entityType: 'customer',
      entityId: customerId,
      afterData: {
        changedCustomerFields: Object.keys(customerData),
        changedPersonFields: Object.keys(personData),
      },
    });
    return updated;
  }

  /* ---- Xoá hẳn hồ sơ khách hàng ----
   *
   * Chỉ xoá được khi CHƯA phát sinh nghiệp vụ nào. Các bảng trỏ tới khách hàng bằng id
   * LỎNG — không có khoá ngoại, chỉ `grave_holds` là có — nên CSDL sẽ vui vẻ để lại con
   * trỏ treo nếu không tự kiểm.
   *
   * MỌI nhánh đều SINH RA từ sổ đăng ký, không viết tay lời gọi nào. HAI sổ, vì có hai
   * cách một dòng dữ liệu dính tới người bị xoá:
   *   - `common/lifecycle/customer-references` — trỏ tới HỒ SƠ KHÁCH HÀNG
   *       (CHẶN · XOÁ THEO · GỠ CON TRỎ)
   *   - `common/lifecycle/person-references`   — trỏ tới HỒ SƠ NHÂN THÂN
   *       (CHẶN · XOÁ THEO, có thứ tự bắt buộc)
   *
   * Chú thích cũ ở đây từng tả cách làm bằng tay và tả sai cả số bảng — chú thích tả sai
   * việc mã đang làm còn nguy hơn không có chú thích. Sổ theo nhân thân ra đời 27/08/2026,
   * đúng chỗ mà một chú thích cũ trong chính hàm này đã đoán trước là sẽ hỏng.
   *
   * Trả về danh sách CHẶN chứ không phải một câu "không xoá được": người dùng cần biết
   * phải dọn cái gì trước, không phải biết là mình vừa thất bại.
   */
  async deleteCustomer(customerId: string, actor: string | null) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { person: { select: { id: true, fullName: true } } },
    });
    if (customer === null) {
      throw new NotFoundException('Không tìm thấy khách hàng');
    }
    const personId = customer.person?.id ?? null;

    /* Rào chắn SINH RA từ sổ đăng ký, không viết tay từng lời gọi.
     *
     * Viết tay là cách đã hỏng ba lần trong một ngày: mỗi lần vá một lời gọi mà không hỏi
     * "còn lời gọi nào nữa không". Ở đây danh sách nằm một chỗ, và một test đối chiếu nó
     * với `schema.prisma` — thêm bảng trỏ tới khách hàng mà quên khai là gãy build.
     */
    const now = new Date();
    const client = this.prisma as unknown as Record<
      string,
      { count: (a: { where: Record<string, unknown> }) => Promise<number> }
    >;

    const counted = await Promise.all(
      CUSTOMER_BLOCKING_REFERENCES.map(async (ref) => {
        const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
        const n = await client[model]!.count({
          where: { [ref.column]: customerId, ...ref.activeWhere(now) },
        });
        return { ref, n };
      }),
    );

    /* Tham chiếu theo NHÂN THÂN — sổ đăng ký thứ hai, cùng cách sinh ra như sổ theo khách
     * hàng. Trước 27/08/2026 chỗ này hỏi tay đúng MỘT câu ("đã được an táng chưa"), và vì
     * hỏi tay nên nó là mục duy nhất trong lời từ chối không chỉ được đích danh mộ nào. */
    const countedPerson =
      personId === null
        ? []
        : await Promise.all(
            PERSON_BLOCKING_REFERENCES.map(async (ref) => {
              const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
              const n = await client[model]!.count({ where: ref.where(personId, now) });
              return { ref, n };
            }),
          );

    const deceased =
      personId === null
        ? null
        : await this.prisma.deceasedPerson.findUnique({
            where: { personId },
            select: { id: true },
          });

    /* Lời từ chối phải chỉ ĐÍCH DANH thứ đang chặn, không chỉ đếm. "còn 2 hợp đồng" bảo
     * có việc phải làm; "còn 2 hợp đồng (HD1, HD2)" bảo làm ở đâu. */
    const finder = client as unknown as Record<
      string,
      { findMany: (a: unknown) => Promise<unknown[]> }
    >;
    /* Một hàm dựng câu cho CẢ HAI sổ. Trước đây chỉ sổ khách hàng đi qua đường này, còn
     * mục "đã được an táng" được `push` thẳng vào mảng — nên nó bỏ qua luôn bước gọi
     * `identify`. Hai đường dựng câu là hai chất lượng câu khác nhau, và cái bị bỏ quên
     * luôn là cái viết tay. */
    const describe = async (
      base: string,
      n: number,
      identify: undefined | ((c: typeof finder, id: string, now: Date) => Promise<string[]>),
      id: string,
    ): Promise<string> => {
      if (identify === undefined) return base;
      const labels = await identify(finder, id, now);
      const shown = labels.slice(0, 3).join(', ');
      const more = n > labels.length ? `, +${n - labels.length}` : '';
      return shown === '' ? base : `${base} (${shown}${more})`;
    };

    const blockers = [
      ...(await Promise.all(
        counted
          .filter((c) => c.n > 0)
          .map((c) => describe(c.ref.message(c.n), c.n, c.ref.identify, customerId)),
      )),
      ...(await Promise.all(
        countedPerson
          .filter((c) => c.n > 0)
          .map((c) => describe(c.ref.message(c.n), c.n, c.ref.identify, personId!)),
      )),
    ];

    if (blockers.length > 0) {
      throw new ConflictException(
        `Không xoá được — khách hàng ${blockers.join(', ')}. Dọn các mục này trước, hoặc giữ hồ sơ lại.`,
      );
    }

    /* Đếm quan hệ để BÁO, không để chặn: quan hệ nhân thân nằm ở cả hồ sơ người kia, nên
     * xoá người này tất yếu rút họ khỏi cây gia đình của người kia. Nói ra con số thay vì
     * lặng lẽ xoá. */
    const relationships =
      personId === null
        ? 0
        : await this.prisma.familyRelationship.count({
            where: { OR: [{ sourcePersonId: personId }, { targetPersonId: personId }] },
          });

    /* Dòng LỊCH SỬ trỏ tới khách hàng này (quyền đã thu hồi/sang tên, phiếu giữ chỗ đã
     * huỷ hoặc hết hạn) không chặn xoá — nhưng để lại thì chúng thành con trỏ treo, vì sáu
     * bảng đó không có khoá ngoại. Xoá cùng và ĐẾM để báo. */
    const [staleRights, staleHolds] = await Promise.all([
      this.prisma.graveUsageRight.count({ where: { holderCustomerId: customerId } }),
      this.prisma.graveHold.count({ where: { customerId } }),
    ]);

    /* ĐẾM hai đường ghi mới để audit kể được, chứ không chỉ để trả về.
     *
     * Cả hai đều động vào dữ liệu mà người bấm nút KHÔNG nhìn thấy trên màn hình: hồ sơ an
     * táng đã huỷ của chính họ bị xoá, và hồ sơ an táng đã huỷ CỦA NGƯỜI KHÁC bị gỡ mất con
     * trỏ chủ mộ. Một lần ghi không ai đếm là một lần ghi không ai rà lại được. */
    let detached = 0;
    let cancelledBurials = 0;

    await this.prisma.$transaction(async (tx) => {
      /* Xoá theo cũng SINH RA từ sổ đăng ký, cùng nguồn với nhánh chặn. Trước đây chỗ này
       * gọi tay từng bảng, nên `CUSTOMER_CASCADE_REFERENCES` khai ra mà chỉ có test dùng —
       * một sổ đăng ký không ai đọc thì không phải sổ đăng ký, chỉ là tài liệu. */
      const txc = tx as unknown as Record<
        string,
        { deleteMany: (a: { where: Record<string, unknown> }) => Promise<{ count: number }> }
      >;
      for (const ref of CUSTOMER_CASCADE_REFERENCES) {
        const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
        await txc[model]!.deleteMany({ where: { [ref.column]: customerId } });
      }

      /* GỠ con trỏ thay vì xoá dòng — nhóm thứ ba của sổ. Dòng thuộc về NGƯỜI KHÁC (hồ sơ
       * an táng đã huỷ của một người mất), nên xoá theo là xoá lịch sử của họ. */
      const txu = tx as unknown as Record<
        string,
        {
          updateMany: (a: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>;
        }
      >;
      for (const ref of CUSTOMER_DETACH_REFERENCES) {
        const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
        const r = await txu[model]!.updateMany({
          where: { [ref.column]: customerId },
          data: { [ref.column]: null },
        });
        detached += r.count;
      }

      /* Các bảng khoá theo NHÂN THÂN đi qua sổ đăng ký RIÊNG của chúng, và theo ĐÚNG thứ
       * tự khai ở đó — `burial_records` phải đi trước `deceased_persons` vì khoá ngoại
       * giữa hai bảng là `ON DELETE RESTRICT`. Trước đây bảy lời gọi này viết tay ở đây,
       * và chú thích cũ đã tự đoán đúng rằng đó là chỗ sẽ hỏng. */
      if (personId !== null) {
        for (const ref of PERSON_CASCADE_REFERENCES) {
          const model = ref.model.charAt(0).toLowerCase() + ref.model.slice(1);
          const r = await txc[model]!.deleteMany({ where: ref.where(personId) });
          if (ref.model === 'BurialRecord') cancelledBurials += r.count;
        }
      }
      await tx.customer.delete({ where: { id: customerId } });
      /* Xoá luôn Person: một hồ sơ nhân thân không gắn khách hàng nào chính là cái lệch
       * vừa phải đi vá bằng migration hôm nay. Đừng tạo thêm cái mới. */
      if (personId !== null) {
        await tx.person.delete({ where: { id: personId } });
      }
    });

    await this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action: 'CUSTOMER.DELETED',
      entityType: 'customer',
      entityId: customerId,
      beforeData: {
        customerCode: customer.customerCode,
        fullName: customer.person?.fullName ?? customer.orgName,
        deletedRelationships: relationships,
        deletedUsageRights: staleRights,
        deletedHolds: staleHolds,
        deletedDeceasedRecord: deceased !== null,
        deletedCancelledBurials: cancelledBurials,
        detachedBurialOwners: detached,
      },
    });
    return {
      deleted: true,
      deletedRelationships: relationships,
      deletedUsageRights: staleRights,
      deletedHolds: staleHolds,
      deletedCancelledBurials: cancelledBurials,
      detachedBurialOwners: detached,
    };
  }

  /* Danh sách khách hàng: TÌM tự do + LỌC theo tiêu chí, tất cả ở SERVER.
   *
   * VÌ SAO PHẢI Ở SERVER (chú thích cũ đã cảnh báo, nay là ràng buộc thật): truy vấn cắt ở
   * `limit` dòng. Lọc sau khi nhận về là lọc trên MỘT LÁT CẮT, nên "còn 3 người đã mất" có
   * thể ra 0 chỉ vì 50 khách còn sống đứng trước họ. Người dùng không có cách nào biết
   * mình vừa nhìn một câu trả lời sai.
   *
   * Trả về BAO NGOÀI (`items` + `total` + `limit` + `truncated`) chứ không trả mảng suông:
   * một danh sách bị cắt mà không nói là bị cắt là chỗ người dùng đếm rồi kết luận nhầm.
   * `total` đếm trên TOÀN BỘ tập đã lọc, không phải trên lát cắt.
   *
   * PHẠM VI: danh sách này bó theo phạm vi người gọi, tính THEO MÃ `crm.customer.search`.
   * Trước đây nó trả khách hàng của MỌI công ty cho bất kỳ ai đăng nhập — và một bộ lọc
   * "theo công ty" mà server tin thẳng giá trị client gửi lên thì chính là cái lỗ đó khoác
   * áo mới. HỆ QUẢ PHẢI BIẾT: `Customer.companyId` CHO PHÉP NULL, nên khách hàng chưa gán
   * công ty KHÔNG hiện với người gọi mức COMPANY/SITE. Đó là câu trả lời đúng ("không
   * thuộc công ty nào bạn phụ trách"), nhưng nó đổi thứ màn hình hiện so với trước.
   */
  async search(filters: CustomerFilters, caller: Caller) {
    const limit = clampLimit(filters.limit);

    /* Bó theo phạm vi TRƯỚC, rồi mới giao với công ty người dùng chọn. Giao chứ không
     * thay: client chọn công ty là để THU HẸP tầm nhìn của mình, không bao giờ để mở rộng. */
    const visible = await this.scope.visibleCompanyIdsFor(caller.userId, caller.permission);
    let companyIds: string[] | null = visible;
    if (notBlank(filters.companyId)) {
      // Ném 403 nếu công ty được chọn nằm ngoài phạm vi — không lặng lẽ trả rỗng.
      await this.scope.assertCompanyFor(caller.userId, caller.permission, filters.companyId);
      companyIds = [filters.companyId as string];
    }

    /* Hai trục "đứng tên mộ" và "theo nghĩa trang" KHÔNG viết được thành mệnh đề Prisma
     * lồng nhau: `Customer` và `GraveUsageRight` nối nhau bằng id LỎNG
     * (`holder_customer_id` không có khoá ngoại, không có `@relation`). Nên phải hỏi hai
     * lượt rồi giao tập id. Ghi rõ ở đây để lần sau không ai đi tìm một
     * `where: { usageRights: { some: ... } }` không hề tồn tại. */
    const ownership = await this.graveOwnershipWhere(filters, caller);

    const where: Prisma.CustomerWhereInput = {
      ...(companyIds === null ? {} : { companyId: { in: companyIds } }),
      ...lifeStatusWhere(filters.lifeStatus),
      ...(notBlank(filters.type) ? { type: filters.type } : {}),
      ...(notBlank(filters.status) ? { status: filters.status } : {}),
      ...(ownership === null ? {} : ownership),
      /* Thẻ nhãn viết được thành mệnh đề LỒNG NHAU — khác hẳn hai trục "đứng tên mộ" ở
       * trên, vốn phải hỏi hai lượt vì id lỏng. `CustomerTag.customerId` có khoá ngoại
       * THẬT và có `@relation`, nên `some` chạy được trong đúng một câu truy vấn.
       *
       * `...activeTag` là bắt buộc: thiếu nó thì thẻ đã GỠ vẫn lọt vào kết quả — tức là
       * hiện lại một cái nhãn mà ai đó đã cố ý bỏ đi. */
      ...(notBlank(filters.tagTypeId)
        ? { tags: { some: { tagTypeId: filters.tagTypeId as string, ...activeTag } } }
        : {}),
      ...freeTextWhere(filters.q ?? ''),
    };

    /* Đếm và lấy trang trong CÙNG một `where`. Hai mệnh đề khác nhau là hai câu trả lời
     * khác nhau cho cùng một câu hỏi — đúng lớp lỗi mà `common/lifecycle` sinh ra để dẹp,
     * chỉ khác là ở đây nó hiện thành "tổng 12" trên một bảng đang có 9 dòng. */
    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: {
          person: {
            select: {
              id: true,
              fullName: true,
              gender: true,
              nationalIdMasked: true,
              dateOfBirth: true,
              placeOfBirth: true,
              /* Sống hay đã mất suy từ SỰ TỒN TẠI của hồ sơ người mất, không phải từ một
               * cờ boolean riêng. Một cờ riêng là thứ có thể lệch với hồ sơ an táng; ở đây
               * hai câu trả lời không thể mâu thuẫn vì chúng là cùng một sự thật. */
              deceased: { select: { dateOfDeath: true } },
            },
          },
          /* Thẻ nhãn kèm luôn trong CÙNG truy vấn, không để giao diện hỏi từng dòng: 50
           * dòng là 50 lượt gọi, và người dùng nhìn một bảng nhấp nháy dần. Được phép làm
           * vậy ở đây vì `CustomerTag` có khoá ngoại thật tới `Customer` — khác hai trục
           * "đứng tên mộ" ngay trên, vốn nối bằng id lỏng nên phải hỏi hai lượt.
           *
           * `...activeTag`: thẻ đã gỡ KHÔNG được hiện lại. Đây là chỗ dễ quên nhất, và với
           * thẻ khách thì quên nghĩa là dán lại lên một người cái nhãn ai đó đã cố ý bỏ. */
          tags: {
            where: { ...activeTag },
            select: { tagTypeId: true, tagType: { select: { name: true, subject: true } } },
            orderBy: { assignedAt: 'asc' },
          },
        },
        orderBy: { customerCode: 'asc' },
        take: limit,
      }),
    ]);

    return {
      items: await this.decorateWithGraves(customers),
      total,
      limit,
      truncated: total > customers.length,
    };
  }

  /* Mệnh đề `where` trên `id` cho hai trục "đứng tên mộ" / "theo nghĩa trang".
   *
   * `null` = hai trục này không được dùng, không bó gì. Ngược lại luôn trả một mệnh đề —
   * kể cả `{ id: { in: [] } }`, và RỖNG phải giữ nguyên nghĩa "không ai thoả" chứ không
   * được rơi về "không lọc".
   */
  private async graveOwnershipWhere(
    filters: CustomerFilters,
    caller: Caller,
  ): Promise<Prisma.CustomerWhereInput | null> {
    const wantsOwnership = filters.graveOwner === 'yes' || filters.graveOwner === 'no';
    const cemeteryId = notBlank(filters.cemeteryId) ? (filters.cemeteryId as string) : null;
    if (!wantsOwnership && cemeteryId === null) {
      return null;
    }
    if (cemeteryId !== null) {
      await this.scope.assertSiteFor(caller.userId, caller.permission, cemeteryId);
    }

    /* "Chưa đứng tên mộ" + một nghĩa trang cụ thể là câu hỏi VÔ NGHĨA: "không đứng tên mộ
     * nào ở nghĩa trang A" gồm cả người đang đứng tên ba mộ ở nghĩa trang B. Chặn ở đây,
     * thay vì trả một tập lặng lẽ sai mà người dùng tưởng là đúng. */
    if (filters.graveOwner === 'no' && cemeteryId !== null) {
      throw new BadRequestException(
        'Không lọc đồng thời "chưa đứng tên mộ" và một nghĩa trang cụ thể — hai điều kiện này loại trừ nhau',
      );
    }

    /* CHỈ quyền sử dụng CÒN HIỆU LỰC. Người đã sang tên mộ cho con thì không còn "đang
     * đứng tên" — dùng `activeUsageRight` chứ không đếm cả lịch sử. */
    const rights = await this.prisma.graveUsageRight.findMany({
      where: { ...activeUsageRight },
      select: { holderCustomerId: true, gravePlotId: true },
    });
    let holders = rights;
    if (cemeteryId !== null) {
      const plots = await this.prisma.gravePlot.findMany({
        where: { cemeteryId, id: { in: rights.map((r) => r.gravePlotId) } },
        select: { id: true },
      });
      const inCemetery = new Set(plots.map((pl) => pl.id));
      holders = rights.filter((r) => inCemetery.has(r.gravePlotId));
    }
    const ids = [...new Set(holders.map((r) => r.holderCustomerId))];

    return filters.graveOwner === 'no' ? { id: { notIn: ids } } : { id: { in: ids } };
  }

  /* Gắn thêm những thứ bảng tổng hợp cần mà bản ghi `Customer` không tự có: phần mộ đang
   * ĐỨNG TÊN, NƠI AN NGHỈ, và còn sống hay đã mất. Một lượt cho cả trang, không phải mỗi
   * khách một lượt — 50 dòng mà mỗi dòng một lời gọi là 50 lượt cho một lần mở trang.
   *
   * HAI TRỤC MỘ, GIỮ RIÊNG — không gộp thành một cột "phần mộ":
   *
   *   - `gravePlotCodes` : mộ khách này ĐỨNG TÊN (chủ mộ)
   *   - `restingPlaces`  : mộ khách này NẰM TRONG (đã an táng)
   *
   * Hai câu hỏi khác nhau, và một người có thể ở cả hai, một trong hai, hay không cái nào.
   * Gộp lại chính là cách hồ sơ an táng đang chặn xoá khách hàng trở nên VÔ HÌNH trên màn
   * hình của họ (27/08/2026) — cùng lý do `CustomerRestingPlace` được tách khỏi
   * `CustomerPlot` ở tầng chi tiết. Chủ doanh nghiệp nêu đúng chỗ này: danh sách có cột
   * "phần mộ đứng tên" nên người ĐÃ MẤT luôn hiện "—", và việc vừa an táng không thấy đâu.
   */
  private async decorateWithGraves<T extends { id: string; person: unknown }>(customers: T[]) {
    if (customers.length === 0) {
      return [];
    }
    const rights = await this.prisma.graveUsageRight.findMany({
      where: { holderCustomerId: { in: customers.map((c) => c.id) }, ...activeUsageRight },
      select: { holderCustomerId: true, gravePlotId: true },
    });

    /* Nơi an nghỉ: `Customer.personId` -> `DeceasedPerson.personId` -> `BurialRecord`.
     * Lọc bằng `deceased: { personId: { in: ... } }` vì `BurialRecord.deceasedPersonId` trỏ
     * tới `DeceasedPerson`, KHÔNG trỏ thẳng tới `Person` — nhầm chỗ này thì truy vấn chạy
     * được mà luôn trả rỗng. */
    const personIds = customers
      .map((c) => (c.person as { id?: string } | null)?.id)
      .filter((id): id is string => typeof id === 'string');
    const burials =
      personIds.length === 0
        ? []
        : await this.prisma.burialRecord.findMany({
            where: { deceased: { personId: { in: personIds } }, ...activeBurial() },
            select: {
              gravePlotId: true,
              slotNumber: true,
              deceased: { select: { personId: true } },
            },
            orderBy: [{ slotNumber: 'asc' }, { createdAt: 'asc' }],
          });

    /* MỘT truy vấn mã mộ cho CẢ HAI trục. Hỏi hai lượt là hai lượt cho cùng một bảng, và
     * mã mộ của một phần mộ thì không phụ thuộc vào việc ai hỏi nó. */
    const plotIds = [
      ...new Set([...rights.map((r) => r.gravePlotId), ...burials.map((b) => b.gravePlotId)]),
    ];
    const plots =
      plotIds.length === 0
        ? []
        : await this.prisma.gravePlot.findMany({
            where: { id: { in: plotIds } },
            select: { id: true, plotCode: true },
          });
    const codeById = new Map(plots.map((pl) => [pl.id, pl.plotCode]));

    const ownedByCustomer = new Map<string, string[]>();
    for (const r of rights) {
      const list = ownedByCustomer.get(r.holderCustomerId) ?? [];
      const code = codeById.get(r.gravePlotId);
      if (code !== undefined) list.push(code);
      ownedByCustomer.set(r.holderCustomerId, list);
    }

    const restingByPerson = new Map<string, { plotCode: string; slotNumber: number | null }[]>();
    for (const b of burials) {
      const code = codeById.get(b.gravePlotId);
      if (code === undefined) continue;
      const key = b.deceased.personId;
      const list = restingByPerson.get(key) ?? [];
      list.push({ plotCode: code, slotNumber: b.slotNumber });
      restingByPerson.set(key, list);
    }

    return customers.map((c) => {
      const personId = (c.person as { id?: string } | null)?.id;
      return {
        ...c,
        gravePlotCodes: (ownedByCustomer.get(c.id) ?? []).sort(),
        /* Mảng, không phải một giá trị: một người CHỈ nên nằm ở một chỗ, và
         * `assertNotAlreadyBuried` ép đúng điều đó — nhưng dữ liệu cũ có thể đã lệch, và
         * một màn hình rút xuống "lấy cái đầu tiên" sẽ giấu đúng cái sai cần thấy. */
        restingPlaces: personId === undefined ? [] : (restingByPerson.get(personId) ?? []),
        isDeceased: (c.person as { deceased?: unknown } | null)?.deceased != null,
      };
    });
  }

  // Decrypt CCCD — every full view is audited (G0-A6). Fine-grained permission is a follow-up.
  /* PHẠM VI CỦA MỘT NHÂN THÂN, cho đường đọc CCCD đầy đủ.
   *
   * `Person` KHÔNG có `companyId` — nó là dữ liệu LIÊN CÔNG TY, đúng như chú thích ở
   * `createDeceased` đã nêu. Nên phải QUY qua bản ghi có neo, và quy theo thứ tự:
   *
   *   1. Hồ sơ khách hàng của chính người đó (`Customer.personId` là unique).
   *   2. Không có khách hàng thì hồ sơ AN TÁNG: người được an táng nằm ở một phần mộ cụ
   *      thể, và phần mộ có cả công ty lẫn nghĩa trang.
   *
   * Không quy được thì TỪ CHỐI. Đây là chỗ khác hẳn `createDeceased`: ở đó chặn hết là
   * chặn một việc GHI hợp lệ (ghi nhận một người đã mất), nên phải chờ quyết. Ở đây là
   * ĐỌC CCCD ĐẦY ĐỦ — thứ rò ra thì không thu lại được — nên mặc định phải là chặn.
   *
   * `Customer.companyId` CHO PHÉP NULL, nên "chỉ kiểm khi khác null" ở bước 1 chính là
   * fail-open: mọi khách chưa gán công ty sẽ thành cửa mở. Null ở bước 1 thì RƠI SANG
   * bước 2, không phải cho qua.
   */
  private async assertPersonInScope(personId: string, caller: Caller): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { personId },
      select: { companyId: true },
    });
    if (customer !== null && customer.companyId !== null) {
      await this.scope.assertCompanyFor(caller.userId, caller.permission, customer.companyId);
      return;
    }

    const burial = await this.prisma.burialRecord.findFirst({
      where: { deceasedPersonId: personId },
      select: { gravePlotId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (burial !== null) {
      const plot = await this.prisma.gravePlot.findUnique({
        where: { id: burial.gravePlotId },
        select: { companyId: true, cemeteryId: true },
      });
      if (plot !== null) {
        await this.scope.assertCompanyFor(caller.userId, caller.permission, plot.companyId);
        await this.scope.assertSiteFor(caller.userId, caller.permission, plot.cemeteryId);
        return;
      }
    }

    throw new ForbiddenException(
      'Không quy được nhân thân này về công ty hay nghĩa trang nào — không kiểm được phạm vi',
    );
  }

  /* Giải mã và trả CCCD ĐẦY ĐỦ.
   *
   * Tới 27/08/2026 hàm này không kiểm phạm vi dòng nào: gate `crm.person.view_sensitive`
   * trả lời "có được xem CCCD hay không", nên ai cầm mã đó đọc được CCCD của MỌI nhân thân
   * trong hệ chỉ cần biết id. Dữ liệu cá nhân theo NĐ 13/2023.
   */
  async revealNationalId(personId: string, caller: Caller) {
    const person = await this.prisma.person.findUnique({ where: { id: personId } });
    if (person === null || person.nationalIdCipher === null) {
      throw new NotFoundException('Không có dữ liệu CCCD');
    }
    /* Kiểm phạm vi TRƯỚC khi giải mã. Giải mã rồi mới chặn là đã đưa bản rõ vào bộ nhớ
     * tiến trình cho một người không được phép — và chỉ cần một lần lỡ trả về là xong. */
    await this.assertPersonInScope(personId, caller);
    const nationalId = this.pii.decrypt(person.nationalIdCipher);
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'PII.NATIONAL_ID_VIEWED',
      entityType: 'person',
      entityId: personId,
      result: 'SUCCESS',
    });
    return { personId, nationalId };
  }

  /* ---- Bảng phụ nhân thân ----
   *
   * Bốn nhóm dùng chung một khuôn: kiểm Person tồn tại, ghi dòng, phát audit. Audit là
   * BẮT BUỘC ở đây chứ không tuỳ chọn — đây là đường ghi dữ liệu cá nhân, và NĐ13 đòi
   * biết được ai đưa dữ liệu của một người vào hệ, lúc nào.
   */

  private async assertPerson(personId: string): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { id: true },
    });
    if (person === null) {
      throw new NotFoundException('Không tìm thấy nhân thân');
    }
  }

  /* Chỉ một mục được là "chính". Hạ cờ của các mục cũ TRONG CÙNG giao dịch — làm hai
   * bước rời nhau thì có khoảnh khắc hồ sơ có hai số chính, và màn hình nào đọc đúng lúc
   * đó sẽ hiện sai số liên lạc.
   */
  private async demoteOtherPrimaries(
    tx: Prisma.TransactionClient,
    table: 'personPhone' | 'personAddress' | 'personBankAccount',
    personId: string,
  ): Promise<void> {
    await (tx[table] as { updateMany: (a: unknown) => Promise<unknown> }).updateMany({
      where: { personId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  private auditSubRecord(
    actor: string | null,
    action: string,
    personId: string,
    entityId: string,
  ): Promise<unknown> {
    return this.audit.record({
      actorType: 'USER',
      actorId: actor,
      action,
      entityType: 'person',
      entityId: personId,
      afterData: { recordId: entityId },
    });
  }

  async addPhone(personId: string, dto: AddPersonPhoneDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personPhone', personId);
      }
      return tx.personPhone.create({
        data: {
          id: ulid(),
          personId,
          phone: dto.phone,
          kind: dto.kind ?? null,
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes ?? null,
        },
      });
    });
    await this.auditSubRecord(actor, 'PERSON.PHONE_ADDED', personId, row.id);
    return row;
  }

  async addAddress(personId: string, dto: AddPersonAddressDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personAddress', personId);
      }
      return tx.personAddress.create({
        data: {
          id: ulid(),
          personId,
          address: dto.address,
          kind: dto.kind ?? null,
          isPrimary: dto.isPrimary ?? false,
          notes: dto.notes ?? null,
        },
      });
    });
    await this.auditSubRecord(actor, 'PERSON.ADDRESS_ADDED', personId, row.id);
    return row;
  }

  async addEducation(personId: string, dto: AddPersonEducationDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.personEducation.create({
      data: {
        id: ulid(),
        personId,
        school: dto.school ?? null,
        major: dto.major ?? null,
        degree: dto.degree ?? null,
        graduationYear: dto.graduationYear ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.auditSubRecord(actor, 'PERSON.EDUCATION_ADDED', personId, row.id);
    return row;
  }

  async addBankAccount(personId: string, dto: AddPersonBankAccountDto, actor: string | null) {
    await this.assertPerson(personId);
    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await this.demoteOtherPrimaries(tx, 'personBankAccount', personId);
      }
      return tx.personBankAccount.create({
        data: {
          id: ulid(),
          personId,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          accountHolder: dto.accountHolder ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
    /* KHÔNG ghi số tài khoản vào afterData. Nhật ký kiểm toán là append-only và đọc được
     * bằng một mã quyền KHÁC với mã mở khoá số tài khoản — chép giá trị vào đó là mở một
     * cửa sau vòng qua `view_financial`. Ghi id là đủ để lần lại. */
    await this.auditSubRecord(actor, 'PERSON.BANK_ACCOUNT_ADDED', personId, row.id);
    return row;
  }

  /* Ngừng dùng thay vì xoá: hồ sơ nhân thân đã từng đúng thì vẫn phải đọc lại được khi
   * đối chiếu giấy tờ cũ. Cùng lý do với việc thu hồi quyền bằng cách đóng hiệu lực.
   */
  async deactivateSubRecord(
    kind: 'phones' | 'addresses' | 'education' | 'bank-accounts',
    personId: string,
    recordId: string,
    actor: string | null,
  ) {
    const map = {
      phones: { table: 'personPhone', action: 'PERSON.PHONE_DEACTIVATED' },
      addresses: { table: 'personAddress', action: 'PERSON.ADDRESS_DEACTIVATED' },
      education: { table: 'personEducation', action: 'PERSON.EDUCATION_DEACTIVATED' },
      'bank-accounts': {
        table: 'personBankAccount',
        action: 'PERSON.BANK_ACCOUNT_DEACTIVATED',
      },
    } as const;
    const { table, action } = map[kind];
    const client = this.prisma[table] as unknown as {
      findFirst: (a: unknown) => Promise<{ id: string } | null>;
      update: (a: unknown) => Promise<unknown>;
    };
    /* Tìm theo CẶP (id, personId), không chỉ theo id. Tìm theo id rồi tin đường dẫn là để
     * người gọi ngừng dùng bản ghi của hồ sơ khác — IDOR kinh điển. */
    const existing = await client.findFirst({ where: { id: recordId, personId } });
    if (existing === null) {
      throw new NotFoundException('Không tìm thấy mục này trong hồ sơ nhân thân');
    }
    const updated = await client.update({
      where: { id: recordId },
      data: { status: 'inactive', ...(kind === 'education' ? {} : { isPrimary: false }) },
    });
    await this.auditSubRecord(actor, action, personId, recordId);
    return updated;
  }

  /* Hồ sơ nhân thân đầy đủ — một lần gọi thay vì năm. Chỉ trả mục còn hiệu lực; muốn xem
   * cả mục đã ngừng thì đó là màn hình lịch sử, không phải màn hình tác nghiệp.
   */
  async getPersonProfile(personId: string) {
    const active = { where: activeSubRecord, orderBy: { createdAt: 'asc' } } as const;
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: {
        phones: active,
        addresses: active,
        education: active,
        bankAccounts: active,
      },
    });
    if (person === null) {
      throw new NotFoundException('Không tìm thấy nhân thân');
    }
    return person;
  }
}
