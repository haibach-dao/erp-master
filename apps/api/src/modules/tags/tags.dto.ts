import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CUSTOMER_TAG_SUBJECTS, TAG_TYPE_STATUSES } from './tags.constants';

/* Mã thẻ — chữ thường, số, gạch ngang. KHÔNG hoa, không dấu cách, không dấu tiếng Việt.
 *
 * Đây là chỗ chặn cái mục ruỗng mà anh Bách đã chọn tránh khi chọn "danh mục có kiểm soát":
 * gõ tự do thì `VIP` / `vip` / `V.I.P` / `Vip ` là bốn thẻ khác nhau và lọc sẽ trượt ba
 * nhóm. Ràng buộc này khiến chúng không cùng tồn tại được; `@unique` trên `code` lo phần
 * còn lại.
 *
 * Tên hiển thị thì tự do có dấu — đó là thứ người đọc.
 */
const CODE_RULE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class TagTypeBase {
  @ApiProperty({ description: 'Mã thẻ: chữ thường, số, gạch ngang. VD: can-sua-bia' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(CODE_RULE, {
    message: 'Mã thẻ chỉ gồm chữ thường, số và gạch ngang (VD: can-sua-bia)',
  })
  code!: string;

  @ApiProperty({ description: 'Tên hiển thị, có dấu' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'Giải thích khi nào dùng thẻ này' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

/* Thẻ MỘ không có `subject`, và đó không phải bỏ sót: thẻ mộ nói về một VẬT. "Bia nứt",
 * "nền lún" không thể trở thành một nhận định về ai, nên không có gì phải rào. */
export class CreateGravePlotTagTypeDto extends TagTypeBase {}

export class CreateCustomerTagTypeDto extends TagTypeBase {
  /* BẮT BUỘC, và chỉ hai giá trị. Xem khối chú thích ở `tags.constants.ts` — đây là lớp rào
   * thứ hai (lớp một là hai bảng tách nhau), không phải một trường phân loại cho đẹp. */
  @ApiProperty({ enum: CUSTOMER_TAG_SUBJECTS, description: 'Thẻ này nói về HỒ SƠ hay GIAO DỊCH' })
  @IsIn(CUSTOMER_TAG_SUBJECTS)
  subject!: string;
}

/* Sửa dòng danh mục: đổi TÊN, GIẢI THÍCH và NGỪNG DÙNG được. Ba thứ KHÔNG đổi được:
 *
 *   `code`    — thứ người dùng gõ vào bộ lọc và dán vào tài liệu. Đổi là làm hỏng mọi chỗ
 *               đang trỏ tới. Muốn mã khác thì ngừng dùng thẻ cũ, mở thẻ mới.
 *   `subject` — đổi nó là đổi bản chất thẻ, và mọi khách đang mang thẻ đó đột nhiên bị gán
 *               một loại nhận định khác mà không ai rà lại.
 *   danh mục  — một thẻ mộ không "chuyển" thành thẻ khách được; đó là hai bảng.
 */
export class UpdateTagTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;

  @ApiPropertyOptional({ enum: TAG_TYPE_STATUSES })
  @IsOptional()
  @IsIn(TAG_TYPE_STATUSES)
  status?: string;
}

export class AssignTagDto {
  @ApiProperty() @IsString() @MinLength(1) tagTypeId!: string;
}

export class RemoveTagDto {
  /* Vì sao gỡ — "đã sửa xong", "gắn nhầm". Chữ tự do và CHỈ ĐỂ ĐỌC LẠI, không lọc theo nó:
   * đúng luật của repo, danh sách đóng ở đâu quyết định điều gì, chữ tự do ở đâu chỉ để
   * người sau đọc hiểu. */
  @ApiPropertyOptional({ description: 'Lý do gỡ thẻ' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
