import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Chặn một truy vấn lỡ tay kéo cả bảng về. Danh bạ để CHỌN người, không phải để trích xuất. */
const MAX_ROWS = 200;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /* Trả ĐÚNG bốn trường. Không trả `passwordHash`, không trả `mfaEnabled`, không dùng
   * `select: undefined` rồi lọc ở tầng trên — trường nhạy cảm không được rời khỏi CSDL rồi
   * mới bị bỏ đi, vì một ngày nào đó ai đó sẽ log cái object ấy.
   *
   * Bỏ `status = 'system'`: ghế máy `system-worker@erp.local` không đăng nhập được (bị chặn
   * ở `login()` và passwordHash không phải hash hợp lệ) nên nó không bao giờ là ứng viên
   * cho một việc của con người — hiện ra chỉ tổ mời người ta chọn nhầm.
   */
  async list(filters: { roleCode?: string | undefined; cemeteryId?: string | undefined }) {
    const now = new Date();
    const inForce = { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };

    const where: Prisma.UserWhereInput = { status: { not: 'system' } };

    /* Hai bộ lọc CẮT NHAU, không cộng lại — đúng luật "quyền hiệu dụng là GIAO của hai trục,
     * không bao giờ là tổng" mà `ScopeAssignment` ghi ngay trong schema. Lọc theo vai trả về
     * người có thể làm việc đó ở ĐÂU ĐÓ; lọc theo nghĩa trang trả về người phủ nơi này. Chỉ
     * người thoả CẢ HAI mới thực sự làm được việc ở đây.
     *
     * Cả hai đều xét CỬA SỔ HIỆU LỰC. Bỏ qua nó thì người hết nhiệm kỳ hôm qua vẫn hiện ra
     * trong ô chọn hôm nay — và `validTo` sinh ra chính là để không ai phải nhớ đi thu hồi.
     *
     * Truy vấn theo id thay vì `some` lồng nhau vì `RoleAssignment` KHÔNG có quan hệ Prisma
     * ngược về `User` (cố ý: "No FK to iam.users"). Hai câu hỏi nhỏ rồi giao tập id ở đây
     * rẻ hơn nhiều một lần join chéo schema — và trung thực hơn: nó nói thẳng ra rằng hai
     * bảng này không nối với nhau.
     */
    const idSets: string[][] = [];
    if (filters.roleCode !== undefined && filters.roleCode !== '') {
      const rows = await this.prisma.roleAssignment.findMany({
        where: { role: { code: filters.roleCode }, ...inForce },
        select: { userId: true },
      });
      idSets.push(rows.map((r) => r.userId));
    }
    if (filters.cemeteryId !== undefined && filters.cemeteryId !== '') {
      const rows = await this.prisma.scopeAssignment.findMany({
        where: { cemeteryId: filters.cemeteryId, ...inForce },
        select: { userId: true },
      });
      idSets.push(rows.map((r) => r.userId));
    }
    if (idSets.length > 0) {
      const allowed = idSets.reduce((acc, ids) => acc.filter((id) => ids.includes(id)));
      /* Giao rỗng phải ra DANH SÁCH RỖNG, không phải "bỏ bộ lọc". `{ in: [] }` của Prisma
       * đúng là không khớp gì — nhưng viết rõ ra đây để không ai "tối ưu" nó thành bỏ mệnh
       * đề `in` khi mảng rỗng, và biến một câu trả lời "không có ai" thành cả bảng. */
      where.id = { in: allowed };
    }

    return this.prisma.user.findMany({
      where,
      select: { id: true, email: true, fullName: true, title: true, status: true },
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
      take: MAX_ROWS,
    });
  }

  /* ĐIỀN HỌ TÊN và CHỨC DANH cho một tài khoản.
   *
   * Đây là đường GHI duy nhất cho hai cột đó, và nó BẮT BUỘC phải tồn tại: migration 05/09
   * thêm hai cột ở dạng NULL và không backfill được (không ai biết tên thật của những tài
   * khoản đã có), trong khi `CardSignersService.create` TỪ CHỐI người chưa đủ hai thứ đó với
   * câu "phải điền vào hồ sơ nhân viên trước". Không có route này thì câu ấy chỉ người ta
   * tới một màn hình không tồn tại, và danh mục người ký KHÔNG THÊM ĐƯỢC AI trên một hệ chưa
   * seed — tức là cả tính năng đứng im mà không có gì báo.
   *
   * KHÔNG đụng `email`, `passwordHash`, `status`, `mfaEnabled`: đổi email là đổi danh tính
   * đăng nhập, đổi status là khoá/mở tài khoản. Hai việc đó nặng hơn hẳn "sửa tên hiển thị"
   * và phải có đường riêng, có phép kiểm riêng — gộp vào đây là cho người giữ danh mục thẻ
   * mộ khoá được tài khoản người khác.
   *
   * Trả về ĐÚNG bộ trường như `list`, không trả cả bản ghi: `passwordHash` không được rời
   * khỏi CSDL, kể cả trong một object mà chỗ gọi "chắc chắn không log".
   */
  async update(id: string, dto: { fullName?: string; title?: string }) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (before === null) {
      throw new NotFoundException('Không tìm thấy tài khoản này');
    }
    const data: { fullName?: string; title?: string } = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.title !== undefined) data.title = dto.title.trim();

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, fullName: true, title: true, status: true },
    });
  }
}
