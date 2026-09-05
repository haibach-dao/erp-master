import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CARD_FEE_WAIVE_REASONS } from './cards.constants';

/* Miễn phí — dùng chung cho cấp thẻ và in lại.
 *
 * `waiveReason` là danh sách ĐÓNG, không phải chuỗi tự do như `printReason` ngay dưới. Hai
 * trường trông giống nhau nhưng khác hẳn về hậu quả: `printReason` chỉ để đọc lại về sau,
 * còn `waiveReason` quyết định có mất tiền hay không. Một ô cho người ở quầy tự gõ là một ô
 * để gõ chữ cho khỏi mất tiền.
 *
 * Chú ý `main.ts` bật `ValidationPipe({ whitelist: true })`: trường không khai ở đây bị vứt
 * ÂM THẦM, không lỗi, không log. Nên gõ sai tên trường ở client nghĩa là "không miễn" chứ
 * không phải một thông báo lỗi.
 */
class WaiveFields {
  @ApiPropertyOptional({ description: 'Miễn phí lần cấp này' })
  @IsOptional()
  @IsBoolean()
  waive?: boolean;

  @ApiPropertyOptional({ enum: CARD_FEE_WAIVE_REASONS, description: 'Bắt buộc khi waive=true' })
  @IsOptional()
  @IsIn(CARD_FEE_WAIVE_REASONS)
  waiveReason?: string;
}

export class ReprintCardDto extends WaiveFields {}

/* Ban hành một dòng biểu phí. Bảng append-only nên KHÔNG có DTO sửa — đổi giá là ban hành
 * dòng mới với `effectiveFrom` mới.
 *
 * Tiền nhận `number` nguyên đồng (nếp `CreateGraveTypeDto.referencePrice`), rồi service quy
 * sang `Prisma.Decimal`. Nhận chuỗi ở đây thì mỗi client tự chọn cách viết "200000" hay
 * "200.000" và service phải đoán.
 */
export class CreateCardFeeScheduleDto {
  @ApiProperty() @IsString() companyId!: string;

  @ApiProperty({ description: 'Tiền cấp giấy lần đầu — VND (integer đồng), giá PHẲNG' })
  @IsInt()
  @Min(0)
  firstIssueFee!: number;

  @ApiProperty({ description: 'Đơn giá MỘT cốt cho mỗi lần in lại — VND (integer đồng)' })
  @IsInt()
  @Min(0)
  reprintFeePerRemains!: number;

  @ApiProperty({ description: 'Ngày bắt đầu hiệu lực (ISO 8601)' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'Số quyết định / văn bản hiệu lực làm căn cứ' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  decisionRef?: string;
}

export class IssueCardDto extends WaiveFields {
  @ApiPropertyOptional({ description: 'Lý do cấp: cấp lần đầu, đổi thông tin, mất thẻ...' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  printReason?: string;

  /* Tên và chức danh người ký in ở ô chữ ký bên phải. Nhận từ client vì người ký là quyết
   * định của đơn vị tại thời điểm cấp (hệ cũ mặc định "PHÓ GIÁM ĐỐC"), không phải thuộc
   * tính suy ra được từ dữ liệu. Ghi vào nhật ký để về sau đối chứng được thẻ giấy.
   */
  @ApiPropertyOptional({ description: 'Tên người ký trên thẻ' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  approvedBy?: string;

  @ApiPropertyOptional({ description: 'Chức danh người ký, mặc định PHÓ GIÁM ĐỐC' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  approvedTitle?: string;
}

/* NGƯỜI KÝ THẺ MỘ — danh mục toàn hệ.
 *
 * `IssueCardDto` phía trên vẫn nhận `approvedBy`/`approvedTitle` dạng CHUỖI, không nhận id
 * người ký — cố ý. Tờ giấy khách cầm ghi tên gì thì nhật ký phải đọc ra đúng tên đó, kể cả
 * khi người ấy sau này đổi chức danh hoặc nghỉ. Danh mục này chỉ để CHỌN cho nhanh và cho
 * khỏi gõ sai, không phải để tra ngược.
 */
/* KHÔNG nhận họ tên và chức danh dạng chuỗi nữa — anh Bách chốt 05/09/2026: "họ và tên và
 * chức danh lấy trong danh sách nhân viên". Hai thứ đó được CHÉP từ hồ sơ tài khoản trong
 * service. Còn nhận chuỗi ở đây thì luật mới chỉ là một gợi ý của giao diện: một lời gọi
 * API thẳng vẫn gõ được tên bất kỳ, kể cả tên người không làm ở công ty. */
export class CreateCardSignerDto {
  @ApiProperty({ description: 'Tài khoản nhân viên sẽ ký — phải đang giữ vai QL_NGHIA_TRANG' })
  @IsString()
  @MaxLength(40)
  userId!: string;

  @ApiProperty({ description: 'Nghĩa trang người này phụ trách' })
  @IsString()
  @MaxLength(40)
  cemeteryId!: string;

  @ApiPropertyOptional({
    description: 'Chọn sẵn ở màn hình cấp thẻ. Mỗi NGHĨA TRANG một người mặc định.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

/* CHỈ đổi được trạng thái và cờ mặc định.
 *
 * Họ tên và chức danh KHÔNG sửa tại chỗ: chúng được chép từ hồ sơ nhân viên lúc tạo, và mở
 * đường sửa ở đây là mở lại đúng cái ô gõ tay vừa đóng. Sai thì theo nếp copy-based — ngừng
 * dùng dòng cũ, sửa hồ sơ nhân viên, thêm dòng mới. Dòng cũ phải ở lại để tra được tên đã
 * in trên những tờ thẻ đã cấp. */
export class UpdateCardSignerDto {
  @ApiPropertyOptional({ enum: ['Active', 'Retired'] })
  @IsOptional()
  @IsIn(['Active', 'Retired'])
  status?: 'Active' | 'Retired';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
