import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/* Cắt khoảng trắng hai đầu TRƯỚC khi kiểm.
 *
 * `@IsNotEmpty` không cắt gì cả, nên thiếu bước này thì `'   '` là một giá trị hợp lệ — và
 * nó đi thẳng vào cột `company_id` như một công ty có thật. Hậu quả giống hệt chuỗi rỗng
 * (`notBlank` bắt được, nhưng `=== null` thì không), chỉ khác là nhìn mắt thường không thấy.
 */
const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

export class CreatePersonDto {
  @ApiProperty() @IsString() @MinLength(1) fullName!: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'UNKNOWN'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'UNKNOWN'])
  gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dateOfBirth?: string;
  @ApiPropertyOptional({ description: 'CCCD — stored encrypted + hashed, shown masked' })
  @IsOptional()
  @IsString()
  nationalId?: string;

  @ApiPropertyOptional({ description: 'Ngày cấp CCCD' })
  @IsOptional()
  @IsISO8601()
  nationalIdIssuedOn?: string;

  @ApiPropertyOptional({ description: 'Nơi cấp CCCD' })
  @IsOptional()
  @IsString()
  nationalIdIssuedPlace?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ description: 'Địa chỉ thường trú' })
  @IsOptional()
  @IsString()
  permanentAddress?: string;
  @ApiPropertyOptional({ description: 'Địa chỉ liên hệ' })
  @IsOptional()
  @IsString()
  contactAddress?: string;

  @ApiPropertyOptional({ description: 'Nơi sinh — dữ liệu cá nhân cơ bản NĐ13 Điều 2.3' })
  @IsOptional()
  @IsString()
  placeOfBirth?: string;

  /* Dân tộc / tôn giáo: để văn bản tự do, KHÔNG ép danh mục đóng. Danh mục 54 dân tộc là
   * chuyện nhà nước có thể sửa, và tôn giáo thì không có danh sách đóng nào đúng cho mọi
   * người — ép enum ở đây là buộc người nhập phải nói dối khi không khớp. */
  @ApiPropertyOptional({ description: 'Dân tộc — dữ liệu nhạy cảm NĐ13 Điều 2.4' })
  @IsOptional()
  @IsString()
  ethnicity?: string;

  @ApiPropertyOptional({ description: 'Tôn giáo — dữ liệu nhạy cảm NĐ13 Điều 2.4' })
  @IsOptional()
  @IsString()
  religion?: string;
}

export class CreateCustomerDto {
  @ApiProperty({ enum: ['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'] })
  @IsIn(['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'])
  type!: string;

  @ApiPropertyOptional({ description: 'Existing Person id (individual customers)' })
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional({ description: 'Inline person for INDIVIDUAL if personId not given' })
  @IsOptional()
  person?: CreatePersonDto;

  @ApiPropertyOptional() @IsOptional() @IsString() orgName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  /* CÔNG TY CHỦ QUẢN — BẮT BUỘC (anh Bách chốt 09/09/2026).
   *
   * ÉP Ở ĐÂY, KHÔNG Ở CSDL. Quyết định 27/08/2026 của chính anh Bách là GIỮ cột
   * `cemetery.customers.company_id` CHO PHÉP NULL, nên không có migration nào đổi cột thành
   * NOT NULL và không thêm CHECK. Hai quyết định không đá nhau: cột vẫn nhận NULL cho những
   * dòng lịch sử, nhưng từ hôm nay không đường ghi nào sinh thêm dòng như thế.
   *
   * VÌ SAO BẮT BUỘC. `companyId` là NEO PHẠM VI của cả hồ sơ: `search` bó theo nó,
   * `deleteCustomer` bó theo nó, biểu phí cấp thẻ tra theo nó. Hồ sơ không có công ty thì
   * rơi ra ngoài MỌI hàng rào đó — không hiện với người mức COMPANY, không xoá được, không
   * tính được phí. Tới trước lượt này form web KHÔNG hề gửi trường này, nên mọi khách tạo
   * từ giao diện đều ra đời trong đúng trạng thái đó.
   *
   * `@IsNotEmpty` chứ không chỉ `@IsString`: `''` là chuỗi hợp lệ, và nó lưu được nguyên
   * chữ rỗng — một hồ sơ trông như đã có công ty với mọi phép so `=== null`.
   */
  @ApiProperty({ description: 'Công ty chủ quản hồ sơ — BẮT BUỘC, là neo phạm vi của hồ sơ' })
  @trim
  @IsString({ message: 'Công ty không hợp lệ' })
  @IsNotEmpty({ message: 'Phải chọn công ty chủ quản cho hồ sơ khách hàng' })
  companyId!: string;
}

export class CreateRelationshipDto {
  @ApiProperty() @IsString() sourcePersonId!: string;
  @ApiProperty() @IsString() targetPersonId!: string;
  @ApiProperty({ description: 'relationship_types.code, e.g. SPOUSE/PARENT/CHILD/SIBLING' })
  @IsString()
  relationshipType!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() effectiveFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() verificationSource?: string;
}

/* ---- Bảng phụ nhân thân ----
 *
 * Bốn DTO dưới đây cố ý KHÔNG nhận `personId` trong thân yêu cầu: person id lấy từ đường
 * dẫn. Nhận trong thân là để client tự chọn ghi vào hồ sơ nào — đúng hình dạng của lỗi
 * IDOR, và guard phạm vi ở tầng trên sẽ không thấy gì bất thường.
 */

export class AddPersonPhoneDto {
  @ApiProperty() @IsString() @MinLength(1) phone!: string;
  @ApiPropertyOptional({ description: 'MOBILE | HOME | WORK | RELATIVE — nhãn tự do' })
  @IsOptional()
  @IsString()
  kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AddPersonAddressDto {
  @ApiProperty() @IsString() @MinLength(1) address!: string;
  @ApiPropertyOptional({ description: 'TEMPORARY | WORK | HOMETOWN | OTHER' })
  @IsOptional()
  @IsString()
  kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AddPersonEducationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() school?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() major?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() degree?: string;
  @ApiPropertyOptional({ description: 'Năm tốt nghiệp' })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2200)
  graduationYear?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class AddPersonBankAccountDto {
  @ApiProperty({ description: 'Mã ngân hàng, ví dụ VCB' })
  @IsString()
  @MinLength(1)
  bankCode!: string;
  @ApiProperty({ description: 'Số tài khoản — che bằng crm.person.view_financial' })
  @IsString()
  @MinLength(1)
  accountNumber!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() accountHolder?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
}

/* Sửa hồ sơ khách hàng.
 *
 * MỌI trường đều tuỳ chọn, và service phân biệt "không gửi" với "gửi chuỗi rỗng":
 * không gửi = giữ nguyên, chuỗi rỗng = XOÁ giá trị. Không phân biệt được hai thứ đó thì
 * không có cách nào xoá một giá trị đã nhập sai.
 */
export class UpdatePersonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationalId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationalIdIssuedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nationalIdIssuedPlace?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() permanentAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() placeOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ethnicity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() religion?: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ enum: ['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'] })
  @IsOptional()
  @IsIn(['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'])
  type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orgName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;

  /* ĐỔI CÔNG TY CHỦ QUẢN — đường sửa mở ra 09/09/2026 cùng lượt với ô bắt buộc lúc tạo.
   *
   * PHẢI KHAI Ở ĐÂY thì mới đi xuống được. `main.ts` dựng `ValidationPipe` với
   * `whitelist: true`, nên trường nào DTO không khai sẽ bị VỨT IM LẶNG: màn hình gửi đúng,
   * API trả 200, cột không đổi, và không có một dòng lỗi nào. Đó chính là trạng thái của
   * `companyId` trên đường này cho tới hôm nay — cộng thêm việc `updateCustomer` cũng không
   * ghi cột đó, nên câu chặn ở `deleteCustomer` ("gán công ty cho hồ sơ trước khi xoá") chỉ
   * sang một cái ô KHÔNG TỒN TẠI.
   *
   * TUỲ CHỌN, không bắt buộc: không gửi = giữ nguyên. Ép bắt buộc ở đường sửa là bắt người
   * chỉ muốn đổi số điện thoại phải nhắc lại công ty mỗi lần — và một trường bị nhắc lại
   * máy móc là chỗ người ta chọn nhầm.
   *
   * NHƯNG rỗng KHÔNG theo nếp "rỗng = xoá giá trị" của mấy trường trên: gỡ công ty ra là
   * dựng lại đúng hồ sơ mồ côi mà lượt này sinh ra để dẹp. Service từ chối, ở đó câu báo
   * lỗi nói được đúng lý do nghiệp vụ.
   */
  @ApiPropertyOptional({
    description: 'Đổi công ty chủ quản. Không gửi = giữ nguyên; gửi rỗng bị TỪ CHỐI.',
  })
  @IsOptional()
  @trim
  @IsString({ message: 'Công ty không hợp lệ' })
  companyId?: string;

  @ApiPropertyOptional() @IsOptional() person?: UpdatePersonDto;
}

/* Bộ lọc danh sách khách hàng — đọc từ QUERY STRING.
 *
 * Query string đến từ client dưới dạng CHUỖI, kể cả `limit`. Nên có `@Type(() => Number)`
 * cho `limit`: thiếu nó thì `@IsInt()` từ chối `"50"` và bộ lọc gãy ngay lần bấm đầu tiên.
 *
 * Mọi trục có tập giá trị hữu hạn đều dùng `@IsIn` với DANH SÁCH ĐÓNG. Giá trị lạ bị TỪ
 * CHỐI (400), không bị bỏ qua âm thầm — bỏ qua âm thầm là cách một bộ lọc gõ sai trả về
 * đúng dữ liệu chưa lọc mà người dùng tưởng là đã lọc.
 */
export class SearchCustomersDto {
  @ApiPropertyOptional({ description: 'Tìm tự do: mã KH, họ tên, điện thoại, email, tên tổ chức' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['all', 'alive', 'deceased'] })
  @IsOptional()
  @IsIn(['all', 'alive', 'deceased'])
  lifeStatus?: 'all' | 'alive' | 'deceased';

  @ApiPropertyOptional({ enum: ['all', 'yes', 'no'], description: 'Đang đứng tên phần mộ' })
  @IsOptional()
  @IsIn(['all', 'yes', 'no'])
  graveOwner?: 'all' | 'yes' | 'no';

  @ApiPropertyOptional({ description: 'Đứng tên mộ ở nghĩa trang này' })
  @IsOptional()
  @IsString()
  cemeteryId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() companyId?: string;

  /* Lọc theo MỘT thẻ nhãn. Đợt 1 cố ý chỉ một: "chọn hai thẻ" nghĩa là có CẢ HAI hay có ÍT
   * NHẤT MỘT — hai mệnh đề Prisma khác hẳn, hai kết quả khác nhau trên cùng dữ liệu, và
   * chưa ai trả lời. Một thẻ là hoãn câu đó một cách sòng phẳng. */
  @ApiPropertyOptional({ description: 'Đang mang thẻ nhãn này (id dòng danh mục)' })
  @IsOptional()
  @IsString()
  tagTypeId?: string;

  @ApiPropertyOptional({ enum: ['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'] })
  @IsOptional()
  @IsIn(['INDIVIDUAL', 'ORGANIZATION', 'AGENT', 'PROSPECT'])
  type?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
