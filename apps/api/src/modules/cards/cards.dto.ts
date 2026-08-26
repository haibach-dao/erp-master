import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class IssueCardDto {
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
