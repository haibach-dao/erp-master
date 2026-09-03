import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { GRAVE_PLOT_STATUSES } from './cemetery.constants';

export class CreateCompanyDto {
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
}

export class CreateCemeteryDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
}

export class CreateGraveTypeDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) code!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) defaultCapacity?: number;
  @ApiPropertyOptional({ description: 'VND (integer đồng)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  referencePrice?: number;
}

export class CreateGravePlotDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;
  @ApiProperty() @IsString() @MinLength(1) cemeteryId!: string;
  @ApiProperty() @IsString() @MinLength(1) graveTypeId!: string;
  @ApiProperty() @IsString() @MinLength(1) plotCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subzone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() block?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() row?: string;
  @ApiPropertyOptional({ description: 'Override capacity; null uses grave type default' })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacityOverride?: number;
}

/* Số cốt của LOẠI mộ. Một dòng ở đây đổi sức chứa hiệu dụng của mọi phần mộ chưa có ghi
 * đè riêng — và từ 02/09/2026 nó là cơ số nhân của tiền in lại thẻ. Vì thế nó là DTO
 * riêng, route riêng, mã quyền riêng, chứ không phải một trường tuỳ chọn nhét vào một
 * `UpdateGraveTypeDto` chung chung nơi nó lẫn giữa việc đổi tên với đổi mã. */
export class SetGraveTypeCapacityDto {
  @ApiProperty({ description: 'Số cốt mặc định của loại mộ' })
  @IsInt()
  @Min(1)
  defaultCapacity!: number;
}

/* Số cốt GHI ĐÈ của một phần mộ cụ thể — mộ xây khác chuẩn của loại.
 *
 * Nhận `null` TƯỜNG MINH, và đó là điểm phải để ý: `null` nghĩa là "thôi ghi đè, quay về
 * mặc định của loại mộ", một ý định khác hẳn với "không gửi trường này". Đừng mượn luật
 * "chuỗi rỗng nghĩa là xoá" mà PATCH khách hàng đang dùng — đây là số, và chuỗi rỗng
 * quy về 0 thì thành mộ 0 cốt. */
export class SetGravePlotCapacityDto {
  @ApiProperty({
    nullable: true,
    description: 'Số cốt riêng của phần mộ; null để dùng mặc định của loại mộ',
  })
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  capacityOverride!: number | null;
}

/* Bộ lọc danh sách lô mộ.
 *
 * Trước 03/09/2026 ba tham số này đến thẳng từ `@Query()` rời, và `status` là chuỗi THÔ gán
 * vào `where` không qua một `@IsIn` nào — client gửi gì cũng lọt xuống truy vấn. Thêm trục
 * thẻ nhãn mà giữ nguyên nếp đó là nhân bản đúng lỗi ấy, nên gom vào DTO ở đây.
 */
export class ListGravePlotsDto {
  @ApiProperty() @IsString() @MinLength(1) companyId!: string;

  @ApiPropertyOptional({ enum: GRAVE_PLOT_STATUSES })
  @IsOptional()
  @IsIn(GRAVE_PLOT_STATUSES)
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() cemeteryId?: string;

  /* Một thẻ mỗi lần ở đợt 1 — xem lý do ở `SearchCustomersDto.tagTypeId`. */
  @ApiPropertyOptional({ description: 'Đang mang thẻ nhãn này (id dòng danh mục)' })
  @IsOptional()
  @IsString()
  tagTypeId?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: GRAVE_PLOT_STATUSES })
  @IsIn(GRAVE_PLOT_STATUSES)
  toStatus!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

/* Toạ độ sơ đồ mặt bằng. Hệ CỤC BỘ theo từng nghĩa trang, đơn vị mét — không phải kinh/vĩ
 * độ, nên không ràng buộc [-180,180]. Cho phép null tường minh để gỡ một mộ khỏi sơ đồ mà
 * không phải xoá bản ghi.
 */
export class SetPlotPositionDto {
  @ApiPropertyOptional({ description: 'Toạ độ X cục bộ (mét); null để gỡ khỏi sơ đồ' })
  @IsOptional()
  @IsNumber()
  mapX?: number | null;

  @ApiPropertyOptional({ description: 'Toạ độ Y cục bộ (mét); null để gỡ khỏi sơ đồ' })
  @IsOptional()
  @IsNumber()
  mapY?: number | null;
}

export class AssignUsageRightDto {
  @ApiProperty() @IsString() @MinLength(1) gravePlotId!: string;
  @ApiProperty() @IsString() @MinLength(1) holderCustomerId!: string;
  @ApiPropertyOptional({ description: 'Ngày bắt đầu đứng tên; mặc định hôm nay' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
  @ApiPropertyOptional({ description: 'Vì sao gán tay, không qua hợp đồng' })
  @IsOptional()
  @IsString()
  note?: string;
}

/* Thu hồi và sang tên đều BẮT BUỘC có lý do.
 *
 * Bắt buộc ở DTO chứ không ở cột CSDL: bản ghi cũ không mang lý do, và ép NOT NULL là
 * phải bịa lý do cho chúng. Ở đây thì mọi lần thao tác TỪ NAY đều phải nói vì sao — hai
 * việc này tước quyền của một người, nên "vì sao" không được để trống.
 */
export class ReleaseUsageRightDto {
  @ApiProperty({ description: 'Vì sao thu hồi' })
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class TransferUsageRightDto {
  @ApiProperty({ description: 'Khách hàng nhận sang tên — phải còn sống' })
  @IsString()
  @MinLength(1)
  toCustomerId!: string;

  @ApiProperty({ description: 'Vì sao sang tên: thừa kế, chuyển nhượng, sửa sai...' })
  @IsString()
  @MinLength(3)
  reason!: string;

  @ApiPropertyOptional({ description: 'Ngày chủ mới bắt đầu đứng tên; mặc định hôm nay' })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;
}
