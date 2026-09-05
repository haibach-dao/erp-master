import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';
import type { CreateCardSignerDto, UpdateCardSignerDto } from './cards.dto';

/** Vai duy nhất được ký thẻ mộ. Anh Bách chốt 05/09/2026: người ký LÀ người quản lý nghĩa trang. */
const SIGNER_ROLE = 'QL_NGHIA_TRANG';

/* NGƯỜI KÝ THẺ MỘ — danh mục THEO NGHĨA TRANG (anh Bách chốt 05/09/2026).
 *
 * Người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là chủ mộ, tên lấy thẳng từ hồ sơ
 * khách nên không đi qua đây.
 *
 * ĐÂY LÀ BẢN THAY cho thiết kế 03/09/2026 (danh mục TOÀN HỆ, nhận `actorId` chứ không nhận
 * `Caller`, và có một dòng miễn trừ trong `NO_RECORD_SCOPE` với lý do "bảng không có
 * companyId nên không có gì để bó"). Lý do đó đã HẾT ĐÚNG: bảng nay có `cemeteryId`, tức là
 * có bản ghi đích và có trục để bó. Nên service nhận `Caller` và bó phạm vi thật, còn dòng
 * miễn trừ kia bị gỡ. Một dòng miễn trừ sống lâu hơn lý do sinh ra nó là một cái lỗ.
 *
 * Luật "người ký phải đang giữ vai QL_NGHIA_TRANG ở CHÍNH nghĩa trang đó" KHÔNG viết được
 * thành ràng buộc CSDL — `authz` và `cemetery` là hai schema, và vai có `validTo` nên một
 * dòng hợp lệ hôm nay tự hết hợp lệ ngày mai mà không ai UPDATE nó. Vì thế nó được kiểm
 * HAI LẦN: lúc GHI (từ chối thẳng) và lúc ĐỌC (`eligible` + `reason`, để người đã mất vai
 * vẫn hiện ra kèm lý do thay vì lặng lẽ biến mất khỏi danh sách).
 */
@Injectable()
export class CardSignersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /* Trả CẢ người đã ngừng dùng.
   *
   * Trang quản trị cần thấy họ để tra lại; màn hình cấp thẻ tự lọc `Active` nên người đã
   * nghỉ không lọt vào ô chọn. Một route, và chỗ lọc nằm ở nơi biết mình cần gì.
   *
   * KHÔNG sắp theo `status`. Bản đầu có `{ status: 'asc' }` để đẩy `Active` lên trước, và
   * ratchet lọc trạng thái đã bắt đúng: thứ tự ấy chỉ đúng nhờ 'Active' tình cờ đứng trước
   * 'Retired' trong bảng chữ cái. Thêm một trạng thái bắt đầu bằng chữ sớm hơn là thứ tự
   * lặng lẽ đảo, không có gì đỏ. Người mặc định lên đầu, còn lại theo tên.
   */
  async list(caller: Caller, cemeteryId?: string) {
    /* Bó theo TỪNG MÃ QUYỀN, không theo mức rộng nhất của người gọi — `caller.permission` do
     * `PermissionGuard` đặt, controller không gõ tay. */
    if (cemeteryId !== undefined) {
      await this.scope.assertSiteFor(caller.userId, caller.permission, cemeteryId);
    }
    const visibleSites = await this.scope.listSiteFilterFor(caller.userId, caller.permission);

    const where: Prisma.CardSignerWhereInput = {};
    if (cemeteryId !== undefined) {
      where.cemeteryId = cemeteryId;
    } else if (visibleSites !== null) {
      /* Người ở mức SITE chỉ thấy người ký của nghĩa trang mình phủ. Dòng CŨ (`cemeteryId`
       * NULL, đã `Retired` bởi migration 05/09) không thuộc nghĩa trang nào nên KHÔNG lọt
       * vào đây — đúng: nó là rác lịch sử, giữ để tra chứ không phải để chọn. */
      where.cemeteryId = { in: visibleSites };
    }

    const rows = await this.prisma.cardSigner.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { fullName: 'asc' }],
    });

    /* Kiểm LẠI tư cách lúc đọc. Một người được thêm hợp lệ tháng trước có thể đã hết vai
     * hôm nay — không lệnh UPDATE nào chạm vào dòng này, nên CSDL không thể biết. Trả cờ ra
     * ngoài thay vì lọc bỏ: nút bị chặn phải NÓI LÝ DO, không lặng lẽ biến mất. */
    return Promise.all(
      rows.map(async (row) => {
        const check = await this.eligibility(row.userId, row.cemeteryId);
        return { ...row, eligible: check.ok, ineligibleReason: check.ok ? null : check.reason };
      }),
    );
  }

  async create(dto: CreateCardSignerDto, caller: Caller) {
    await this.scope.assertSiteFor(caller.userId, caller.permission, dto.cemeteryId);

    const cemetery = await this.prisma.cemetery.findUnique({ where: { id: dto.cemeteryId } });
    if (cemetery === null) {
      throw new NotFoundException('Không tìm thấy nghĩa trang này');
    }

    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (user === null) {
      throw new NotFoundException('Không tìm thấy tài khoản nhân viên này');
    }

    /* HỌ TÊN và CHỨC DANH là hai thứ DUY NHẤT in lên tờ thẻ. Thiếu một trong hai thì dòng
     * người ký này in ra một ô chữ ký trống — nên chặn ở đây, và chỉ ĐÚNG đường đi sửa. */
    if (isBlank(user.fullName) || isBlank(user.title)) {
      throw new ConflictException(
        `Tài khoản ${user.email} chưa có đủ họ tên và chức danh. Hai thứ đó in thẳng lên tờ thẻ, nên phải điền vào hồ sơ nhân viên trước khi đưa người này vào danh mục người ký.`,
      );
    }

    const check = await this.eligibility(dto.userId, dto.cemeteryId);
    if (!check.ok) {
      throw new ConflictException(`${check.reason} (nghĩa trang ${cemetery.name})`);
    }

    /* Ghi qua `client` mà `withDefaultCleared` đưa xuống, KHÔNG qua `this.prisma`. Khi đang
     * đặt mặc định thì `client` là client giao dịch; gọi `this.prisma` ở đây là lặng lẽ ra
     * ngoài giao dịch — xem chú thích của `withDefaultCleared`. */
    const created = await this.withDefaultCleared(
      dto.isDefault === true,
      dto.cemeteryId,
      (client) =>
        this.wrapDuplicate(() =>
          client.cardSigner.create({
            data: {
              id: ulid(),
              userId: dto.userId,
              cemeteryId: dto.cemeteryId,
              /* CHÉP từ hồ sơ nhân viên, không nhận chuỗi người dùng gõ — đây chính là điều
               * anh Bách yêu cầu: "họ và tên và chức danh lấy trong danh sách nhân viên".
               * Chép chứ không join mỗi lần đọc: tờ giấy khách cầm ghi gì thì dòng này phải
               * giữ đúng cái đó, kể cả khi người ấy sau này đổi chức danh. */
              fullName: user.fullName!.trim(),
              title: user.title!.trim(),
              isDefault: dto.isDefault === true,
              createdBy: caller.userId,
            },
          }),
        ),
    );
    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CARD_SIGNER.CREATED',
      entityType: 'card_signer',
      entityId: created.id,
      afterData: created,
    });
    return created;
  }

  async update(id: string, dto: UpdateCardSignerDto, caller: Caller) {
    const before = await this.prisma.cardSigner.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy người ký này');
    }
    /* Bó phạm vi NGAY SAU phép tìm bản ghi và TRƯỚC mọi phép kiểm trạng thái — cùng thứ tự
     * đã dựng cho `contracts.verify` 27/08/2026. Kiểm trạng thái trước thì câu lỗi đã kể cho
     * người ngoài phạm vi biết dòng này tồn tại và đang ở trạng thái nào. */
    await this.scope.assertSiteFor(caller.userId, caller.permission, before.cemeteryId);

    const data: Prisma.CardSignerUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    /* NGỪNG DÙNG người đang là mặc định thì BỎ CỜ luôn trong cùng lệnh.
     *
     * Không làm vậy thì CHECK ở CSDL từ chối, và người dùng nhận một câu lỗi ràng buộc mà
     * họ không gây ra và không sửa được — họ chỉ bấm "Ngừng dùng". Đây là chỗ service phải
     * hiểu ý người dùng thay vì chuyển nguyên lỗi CSDL ra màn hình. */
    if (dto.status === 'Retired' && dto.isDefault === undefined) {
      data.isDefault = false;
    }

    /* CHẶN "đã ngừng dùng mà vẫn là mặc định" NGAY Ở ĐÂY, trước khi chạm CSDL.
     *
     * Để lọt xuống thì `card_signers_default_active_check` từ chối, mà lỗi CHECK không phải
     * P2002 nên `wrapDuplicate` ném nguyên — người dùng nhận 500 kèm một câu tiếng Anh của
     * Postgres. Cùng lý do với đoạn tự bỏ cờ ở trên: lỗi CSDL không được ra tới màn hình.
     *
     * Phải xét TRẠNG THÁI SAU KHI SỬA chứ không chỉ `dto.status`. Bẫy là PATCH chỉ gửi
     * `{ isDefault: true }` lên một dòng VỐN ĐÃ `Retired`: không có `status` trong dto nên
     * mọi phép kiểm nhìn vào riêng `dto.status` đều cho qua, rồi vỡ ở CSDL. */
    const statusAfter = dto.status ?? before.status;
    const defaultAfter = data.isDefault === undefined ? before.isDefault : data.isDefault === true;
    if (statusAfter === 'Retired' && defaultAfter) {
      throw new BadRequestException(
        'Người đã ngừng dùng thì không thể là người ký mặc định. Muốn đặt làm mặc định thì bật lại trạng thái đang dùng trước.',
      );
    }

    /* BẬT LẠI hoặc ĐẶT MẶC ĐỊNH thì phải còn tư cách. Không kiểm ở đây thì một người đã rời
     * ghế quản lý nghĩa trang vẫn được đặt làm người ký mặc định chỉ bằng một lệnh PATCH —
     * tức là đường vòng qua đúng cái luật vừa dựng. Dòng đang `Active` mà chỉ đổi cờ khác
     * thì không kiểm lại: không làm nó rộng thêm. */
    const becomesUsable =
      (statusAfter === 'Active' && before.status !== 'Active') ||
      (defaultAfter && !before.isDefault);
    if (becomesUsable) {
      const check = await this.eligibility(before.userId, before.cemeteryId);
      if (!check.ok) {
        throw new ConflictException(check.reason);
      }
    }

    const updated = await this.withDefaultCleared(
      data.isDefault === true,
      before.cemeteryId,
      (client) => this.wrapDuplicate(() => client.cardSigner.update({ where: { id }, data })),
      id,
    );

    await this.audit.record({
      actorType: 'USER',
      actorId: caller.userId,
      action: 'CARD_SIGNER.UPDATED',
      entityType: 'card_signer',
      entityId: id,
      beforeData: before,
      afterData: updated,
    });
    return updated;
  }

  /* "Người này có đang quản lý nghĩa trang kia không?" — GIAO của hai trục, không phải tổng.
   *
   * Giữ vai KHÔNG tự cấp nghĩa trang nào (`ScopeAssignment` ghi rõ điều đó), nên phải hỏi cả
   * hai bảng. Và cả hai đều có cửa sổ hiệu lực `validFrom`/`validTo`: một phân công đã hết
   * hạn thì THÔI TỒN TẠI, không cần ai nhớ đi thu hồi — đó là toàn bộ lý do có `validTo`.
   * Bỏ qua cửa sổ đó nghĩa là người hết nhiệm kỳ hôm qua vẫn ký được thẻ hôm nay.
   *
   * Trả LÝ DO chứ không trả boolean: chỗ gọi cần in ra cho người dùng đọc, và "không đủ tư
   * cách" mà không nói thiếu cái gì thì người ta không biết đi sửa ở đâu — sửa vai và sửa
   * phân công nghĩa trang là hai màn hình khác nhau.
   */
  private async eligibility(
    userId: string | null,
    cemeteryId: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (userId === null || cemeteryId === null) {
      return {
        ok: false,
        reason:
          'Dòng người ký này có từ trước khi danh mục gắn vào tài khoản và nghĩa trang, nên không dùng lại được. Thêm người ký mới.',
      };
    }
    const now = new Date();
    /* CỐ Ý KHÔNG dùng `stillValid()` của `common/lifecycle/active.ts`, dù nếp nhà là dùng
     * mảnh chung. Mảnh đó viết `validTo: { gte: now }`, còn `PermissionsService.activeAssignments`
     * — thứ THỰC SỰ quyết định người này có vào được hay không — viết `gt`. Hai bên lệch
     * nhau đúng một khoảnh khắc, và nếu lấy `gte` thì có một lằn ranh mà danh mục nói "được
     * ký" trong khi tầng quyền nói "không". Câu hỏi ở đây là câu hỏi về QUYỀN, nên bám theo
     * tầng quyền.
     *
     * Đây là một lệch có thật giữa hai định nghĩa trong repo, không phải chỗ này bịa ra: nếu
     * hợp nhất `stillValid` và `activeAssignments` về một bản thì xoá luôn chú thích này và
     * dùng mảnh chung. */
    const inForce = { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };

    const [holdsRole, coversSite] = await Promise.all([
      this.prisma.roleAssignment.findFirst({
        where: { userId, role: { code: SIGNER_ROLE }, ...inForce },
        select: { id: true },
      }),
      this.prisma.scopeAssignment.findFirst({
        where: { userId, cemeteryId, ...inForce },
        select: { id: true },
      }),
    ]);

    if (holdsRole === null) {
      return {
        ok: false,
        reason: `Người này không giữ vai Quản lý nghĩa trang (${SIGNER_ROLE}) nên không ký thẻ mộ được. Cấp vai ở Tổ chức › Gán vai.`,
      };
    }
    if (coversSite === null) {
      return {
        ok: false,
        reason:
          'Người này giữ vai Quản lý nghĩa trang nhưng chưa được phân công nghĩa trang này. Giữ vai không tự cấp nghĩa trang — phân công ở Tổ chức › Phạm vi nghĩa trang.',
      };
    }
    return { ok: true };
  }

  /* Đặt một người làm mặc định = BỎ cờ của người cũ Ở CÙNG NGHĨA TRANG rồi mới đặt, TRONG
   * MỘT GIAO DỊCH.
   *
   * Partial unique index ở CSDL chỉ cho tồn tại một dòng `is_default = true` MỖI NGHĨA
   * TRANG, nên hai bước này mà nằm ngoài giao dịch thì có một khoảnh khắc nghĩa trang đó
   * không ai là mặc định — và nếu bước hai hỏng, hệ ở lại trạng thái đó vĩnh viễn mà không
   * ai biết.
   *
   * `cemeteryId` LÀ BẮT BUỘC ở đây và là điểm khác lớn nhất so với bản 03/09: bản cũ bỏ cờ
   * của MỌI dòng mặc định trong hệ. Giữ nguyên hành vi đó sau khi danh mục tách theo nghĩa
   * trang thì đặt người ký cho nghĩa trang A sẽ lặng lẽ bỏ mặc định của nghĩa trang B —
   * một nghĩa trang không liên quan tự mất người ký mặc định, và không có gì báo.
   *
   * VÌ THẾ `run` NHẬN CLIENT làm tham số, và người gọi BẮT BUỘC ghi qua client đó. Bản đầu
   * bỏ qua tham số `tx` của `$transaction` rồi gọi thẳng `this.prisma` ở cả hai bước: mở
   * giao dịch nhưng không có lệnh nào chạy trong đó, tức là mất trắng thứ vừa dựng ra để
   * bảo vệ.
   *
   * Nhánh không đặt mặc định truyền thẳng `this.prisma`: chỉ có một lệnh nên không cần
   * giao dịch, và `PrismaService` (kế thừa `PrismaClient`) gán được vào `TransactionClient`.
   *
   * `exceptId` để lệnh cập nhật chính nó không tự bỏ cờ của mình.
   */
  private async withDefaultCleared<T>(
    clear: boolean,
    cemeteryId: string | null,
    run: (client: Prisma.TransactionClient) => Promise<T>,
    exceptId?: string,
  ): Promise<T> {
    if (!clear) {
      return run(this.prisma);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.cardSigner.updateMany({
        where: {
          isDefault: true,
          cemeteryId,
          ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
        },
        data: { isDefault: false },
      });
      return run(tx);
    });
  }

  /* Dịch lỗi trùng của CSDL thành câu người đọc hiểu — NHƯNG PHẢI ĐÚNG INDEX NÀO.
   *
   * Bảng có HAI unique index và cả hai đều ra `P2002`:
   *   · `card_signers_active_user_site` — một người chỉ có MỘT dòng đang dùng ở một nghĩa
   *     trang. (Bản 03/09 là `card_signers_active_name_title`, chống hai dòng in ra giống
   *     hệt nhau; nay danh tính là TÀI KHOẢN nên trùng tên không còn là câu hỏi.)
   *   · `card_signers_one_default_per_site` — mỗi nghĩa trang nhiều nhất một người mặc
   *     định; vỡ khi hai quản trị cùng bấm "Đặt mặc định" trên hai dòng KHÁC NHAU cùng lúc.
   * Bản đầu gán mọi P2002 cho index thứ nhất, nên ca thứ hai báo "trùng họ tên" cho hai
   * người tên khác hẳn nhau — người dùng đi sửa tên, còn nguyên nhân thật thì không ai thấy.
   *
   * Không nhận ra index thì NÉM NGUYÊN lỗi gốc. Đoán bừa nguyên nhân chính là lớp lỗi đang
   * sửa; một câu tiếng Anh khó đọc vẫn hơn một câu tiếng Việt chỉ sai đường.
   */
  private async wrapDuplicate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = duplicateTarget(err);
        if (target.includes('card_signers_active_user_site')) {
          throw new ConflictException(
            'Người này đã có trong danh mục người ký của nghĩa trang này rồi.',
          );
        }
        if (target.includes('card_signers_one_default_per_site')) {
          throw new ConflictException(
            'Vừa có người khác được đặt làm người ký mặc định của nghĩa trang này cùng lúc. Mỗi nghĩa trang chỉ giữ một người mặc định, mời mở lại danh sách rồi đặt lại.',
          );
        }
      }
      throw err;
    }
  }
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/* `meta.target` của P2002 lúc là một chuỗi, lúc là mảng chuỗi, lúc không có gì — tuỳ driver
 * và phiên bản Prisma. Gộp về MỘT chuỗi rồi mới đối chiếu tên index, để chỗ gọi không phải
 * đoán hình dạng; đoán sai thì rơi vào nhánh "không nhận ra" và mất câu tiếng Việt. */
function duplicateTarget(err: Prisma.PrismaClientKnownRequestError): string {
  const target: unknown = err.meta?.target;
  if (typeof target === 'string') {
    return target;
  }
  if (Array.isArray(target)) {
    return target.filter((part): part is string => typeof part === 'string').join(',');
  }
  return '';
}
