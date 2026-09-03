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
import type { CreateCardSignerDto, UpdateCardSignerDto } from './cards.dto';

/* NGƯỜI KÝ THẺ MỘ — danh mục TOÀN HỆ (anh Bách chốt 03/09/2026).
 *
 * Người của INDEVCO ký ở ô BÊN PHẢI tờ thẻ. Ô bên trái là chủ mộ, tên lấy thẳng từ hồ sơ
 * khách nên không đi qua đây.
 *
 * Nhận `actorId: string | null` chứ KHÔNG nhận `Caller` — cùng nếp với danh mục thẻ nhãn ở
 * `tags.service.ts`. Bảng không có `companyId` nên không có phạm vi nào để bó; rào duy nhất
 * là mã quyền `config.card_signer.update` (S3) ở tầng route. Nhận `Caller` vào đây sẽ làm
 * ratchet `scope-check-invariants` đòi một phép kiểm phạm vi không tồn tại, và cách người ta
 * làm cho nó im là ghi một dòng miễn trừ — tức là làm hỏng chính cái lưới.
 */
@Injectable()
export class CardSignersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* Trả CẢ người đã ngừng dùng.
   *
   * Trang quản trị cần thấy họ để bật lại; màn hình cấp thẻ tự lọc `Active` nên người đã
   * nghỉ không lọt vào ô chọn. Một route, và chỗ lọc nằm ở nơi biết mình cần gì.
   *
   * KHÔNG sắp theo `status`. Bản đầu có `{ status: 'asc' }` để đẩy `Active` lên trước, và
   * ratchet lọc trạng thái đã bắt đúng: thứ tự ấy chỉ đúng nhờ 'Active' tình cờ đứng trước
   * 'Retired' trong bảng chữ cái. Thêm một trạng thái bắt đầu bằng chữ sớm hơn là thứ tự
   * lặng lẽ đảo, không có gì đỏ. Người mặc định lên đầu, còn lại theo tên.
   */
  async list() {
    return this.prisma.cardSigner.findMany({
      orderBy: [{ isDefault: 'desc' }, { fullName: 'asc' }],
    });
  }

  async create(dto: CreateCardSignerDto, actorId: string | null) {
    /* Ghi qua `client` mà `withDefaultCleared` đưa xuống, KHÔNG qua `this.prisma`. Khi đang
     * đặt mặc định thì `client` là client giao dịch; gọi `this.prisma` ở đây là lặng lẽ ra
     * ngoài giao dịch — xem chú thích của `withDefaultCleared`. */
    const created = await this.withDefaultCleared(dto.isDefault === true, (client) =>
      this.wrapDuplicate(() =>
        client.cardSigner.create({
          data: {
            id: ulid(),
            fullName: dto.fullName.trim(),
            title: dto.title.trim(),
            isDefault: dto.isDefault === true,
            createdBy: actorId,
          },
        }),
      ),
    );
    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'CARD_SIGNER.CREATED',
      entityType: 'card_signer',
      entityId: created.id,
      afterData: created,
    });
    return created;
  }

  async update(id: string, dto: UpdateCardSignerDto, actorId: string | null) {
    const before = await this.prisma.cardSigner.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy người ký này');
    }

    const data: Prisma.CardSignerUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.title !== undefined) data.title = dto.title.trim();
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

    const clearOthers = data.isDefault === true;
    const updated = await this.withDefaultCleared(
      clearOthers,
      (client) => this.wrapDuplicate(() => client.cardSigner.update({ where: { id }, data })),
      id,
    );

    await this.audit.record({
      actorType: 'USER',
      actorId,
      action: 'CARD_SIGNER.UPDATED',
      entityType: 'card_signer',
      entityId: id,
      beforeData: before,
      afterData: updated,
    });
    return updated;
  }

  /* Đặt một người làm mặc định = BỎ cờ của người cũ rồi mới đặt, TRONG MỘT GIAO DỊCH.
   *
   * Partial unique index ở CSDL chỉ cho tồn tại một dòng `is_default = true`, nên hai bước
   * này mà nằm ngoài giao dịch thì có một khoảnh khắc không ai là mặc định — và nếu bước
   * hai hỏng, hệ ở lại trạng thái đó vĩnh viễn mà không ai biết.
   *
   * VÌ THẾ `run` NHẬN CLIENT làm tham số, và người gọi BẮT BUỘC ghi qua client đó. Bản đầu
   * bỏ qua tham số `tx` của `$transaction` rồi gọi thẳng `this.prisma` ở cả hai bước: mở
   * giao dịch nhưng không có lệnh nào chạy trong đó, tức là mất trắng thứ vừa dựng ra để
   * bảo vệ. Đường vỡ có thật: thêm người mặc định trùng tên + chức danh với một người đang
   * dùng thì `updateMany` commit ngay và bỏ cờ của người mặc định cũ, rồi `create` ném
   * P2002 — hệ ở lại trạng thái KHÔNG CÒN AI LÀ MẶC ĐỊNH, đúng cái mà giao dịch phải chặn.
   *
   * Nhánh không đặt mặc định truyền thẳng `this.prisma`: chỉ có một lệnh nên không cần
   * giao dịch, và `PrismaService` (kế thừa `PrismaClient`) gán được vào `TransactionClient`.
   *
   * `exceptId` để lệnh cập nhật chính nó không tự bỏ cờ của mình.
   */
  private async withDefaultCleared<T>(
    clear: boolean,
    run: (client: Prisma.TransactionClient) => Promise<T>,
    exceptId?: string,
  ): Promise<T> {
    if (!clear) {
      return run(this.prisma);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.cardSigner.updateMany({
        where: { isDefault: true, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
        data: { isDefault: false },
      });
      return run(tx);
    });
  }

  /* Dịch lỗi trùng của CSDL thành câu người đọc hiểu — NHƯNG PHẢI ĐÚNG INDEX NÀO.
   *
   * Bảng có HAI unique index và cả hai đều ra `P2002`:
   *   · `card_signers_active_name_title` — chặn hai người đang dùng trùng cả họ tên lẫn
   *     chức danh; trên tờ thẻ chỉ in ra hai thứ đó nên hai dòng như vậy không phân biệt được.
   *   · `card_signers_one_default` — toàn hệ nhiều nhất một người mặc định; vỡ khi hai quản
   *     trị cùng bấm "Đặt mặc định" trên hai dòng KHÁC NHAU cùng lúc.
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
        if (target.includes('card_signers_active_name_title')) {
          throw new ConflictException(
            'Đã có người ký đang dùng trùng cả họ tên lẫn chức danh. Trên tờ thẻ hai dòng này in ra giống hệt nhau nên không phân biệt được.',
          );
        }
        if (target.includes('card_signers_one_default')) {
          throw new ConflictException(
            'Vừa có người khác được đặt làm người ký mặc định cùng lúc. Toàn hệ chỉ giữ một người mặc định, mời mở lại danh sách rồi đặt lại.',
          );
        }
      }
      throw err;
    }
  }
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
