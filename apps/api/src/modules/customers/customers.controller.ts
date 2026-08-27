import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf } from '../authorization/caller';
import { CustomersService } from './customers.service';
import {
  AddPersonAddressDto,
  AddPersonBankAccountDto,
  AddPersonEducationDto,
  AddPersonPhoneDto,
  CreateCustomerDto,
  CreatePersonDto,
  CreateRelationshipDto,
  SearchCustomersDto,
  UpdateCustomerDto,
} from './customers.dto';

/* Danh sách ĐÓNG các nhóm bảng phụ. Đặt ở đây thay vì rải chuỗi ở call site vì đoạn
 * đường dẫn `kind` đến thẳng từ client — không kiểm là để client tự chọn bảng nào.
 */
const SUB_RECORD_KINDS = ['phones', 'addresses', 'education', 'bank-accounts'] as const;
type SubRecordKind = (typeof SUB_RECORD_KINDS)[number];

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('crm')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('persons')
  @RequirePermission('crm.person.create')
  createPerson(@Body() dto: CreatePersonDto, @Req() req: Request) {
    return this.svc.createPerson(dto, this.actor(req));
  }

  @Post('customers')
  @RequirePermission('crm.customer.create')
  createCustomer(@Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.svc.createCustomer(dto, this.actor(req));
  }

  /* Danh sách + bộ lọc khách hàng. LỌC Ở SERVER, không ở giao diện.
   *
   * Nhận cả bộ lọc qua một DTO chứ không nhận từng `@Query` rời: DTO là chỗ danh sách giá
   * trị hợp lệ được ÉP (giá trị lạ → 400), còn `@Query('x') x?: string` thì nhận bất cứ
   * chuỗi gì và đẩy xuống service.
   */
  @Get('customers/search')
  @RequirePermission('crm.customer.search')
  search(@Query() filters: SearchCustomersDto, @Req() req: Request) {
    return this.svc.search(filters, callerOf(req));
  }

  /* PHẢI khai SAU `customers/search`. Express khớp route theo thứ tự đăng ký, nên
   * `customers/:id` đứng trước sẽ nuốt luôn `customers/search` và nhận chuỗi "search" làm
   * id — tìm kiếm trả 404 "Không tìm thấy khách hàng", một triệu chứng không dẫn tới
   * nguyên nhân.
   *
   * Gate bằng `crm.customer.view`; các trường nhạy cảm bên trong (CCCD, liên lạc, dân
   * tộc/tôn giáo, số tài khoản) vẫn do lớp che quyết định — route chỉ nói "được gọi hay
   * không", không nói "đọc được cột nào".
   */
  @Get('customers/:id')
  @RequirePermission('crm.customer.view')
  customerDetail(@Param('id') id: string) {
    return this.svc.getCustomerDetail(id);
  }

  /* Sửa và xoá khai SAU `customers/:id` cho gọn nhóm, nhưng chúng dùng động từ HTTP khác
   * nên không đụng thứ tự khớp route — Express khớp theo (động từ, đường dẫn). */
  @Patch('customers/:id')
  @RequirePermission('crm.customer.update')
  updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @Req() req: Request) {
    return this.svc.updateCustomer(id, dto, this.actor(req));
  }

  /* Xoá HẲN. Service từ chối khi còn bất kỳ nghiệp vụ nào trỏ tới, và câu từ chối liệt kê
   * đúng cái đang chặn — người dùng cần biết phải dọn gì, không phải biết mình thất bại. */
  @Delete('customers/:id')
  @RequirePermission('crm.customer.delete')
  deleteCustomer(@Param('id') id: string, @Req() req: Request) {
    return this.svc.deleteCustomer(id, this.actor(req));
  }

  @Post('relationships')
  @RequirePermission('crm.relationship.create')
  createRelationship(@Body() dto: CreateRelationshipDto, @Req() req: Request) {
    return this.svc.createRelationship(dto, this.actor(req));
  }

  @Post('relationships/:id/end')
  @RequirePermission('crm.relationship.cancel')
  endRelationship(@Param('id') id: string, @Req() req: Request) {
    return this.svc.endRelationship(id, this.actor(req));
  }

  @Get('persons/:id/relationships')
  @RequirePermission('crm.relationship.view')
  personRelationships(@Param('id') id: string) {
    return this.svc.getPersonRelationships(id);
  }

  @Get('persons/:id/national-id')
  @RequirePermission('crm.person.view_sensitive')
  revealNationalId(@Param('id') id: string, @Req() req: Request) {
    return this.svc.revealNationalId(id, callerOf(req));
  }

  /* ---- Bảng phụ nhân thân ----
   *
   * Đọc gate bằng `crm.person.view`, ghi gate bằng `crm.person.update`. Số tài khoản KHÔNG
   * cần mã route riêng: route quyết định "có được gọi không", còn "đọc được cột nào" là
   * việc của lớp che — `accountNumber` mở bằng `crm.person.view_financial`. Cùng mô hình
   * với CCCD: xem được nhân thân không có nghĩa là xem được CCCD.
   */

  @Get('persons/:id/profile')
  @RequirePermission('crm.person.view')
  profile(@Param('id') id: string) {
    return this.svc.getPersonProfile(id);
  }

  @Post('persons/:id/phones')
  @RequirePermission('crm.person.update')
  addPhone(@Param('id') id: string, @Body() dto: AddPersonPhoneDto, @Req() req: Request) {
    return this.svc.addPhone(id, dto, this.actor(req));
  }

  @Post('persons/:id/addresses')
  @RequirePermission('crm.person.update')
  addAddress(@Param('id') id: string, @Body() dto: AddPersonAddressDto, @Req() req: Request) {
    return this.svc.addAddress(id, dto, this.actor(req));
  }

  @Post('persons/:id/education')
  @RequirePermission('crm.person.update')
  addEducation(@Param('id') id: string, @Body() dto: AddPersonEducationDto, @Req() req: Request) {
    return this.svc.addEducation(id, dto, this.actor(req));
  }

  @Post('persons/:id/bank-accounts')
  @RequirePermission('crm.person.update')
  addBankAccount(
    @Param('id') id: string,
    @Body() dto: AddPersonBankAccountDto,
    @Req() req: Request,
  ) {
    return this.svc.addBankAccount(id, dto, this.actor(req));
  }

  /* Một route cho cả bốn nhóm, phân biệt bằng đoạn đường dẫn `kind` đã được @IsIn chặn ở
   * tầng service qua bảng tra. Bốn route giống hệt nhau chỉ khác một chữ là bốn chỗ để
   * quên gắn decorator — mà quên gắn ở đây là route chết, không phải cửa mở.
   */
  @Post('persons/:id/:kind/:recordId/deactivate')
  @RequirePermission('crm.person.update')
  deactivateSubRecord(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('recordId') recordId: string,
    @Req() req: Request,
  ) {
    if (!SUB_RECORD_KINDS.includes(kind as SubRecordKind)) {
      throw new BadRequestException(`Nhóm "${kind}" không hợp lệ`);
    }
    return this.svc.deactivateSubRecord(kind as SubRecordKind, id, recordId, this.actor(req));
  }
}
