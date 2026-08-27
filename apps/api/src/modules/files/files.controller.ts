import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { FilesService } from './files.service';
import { ConfirmUploadDto, PresignUploadDto } from './files.dto';

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  /* `presign` và `confirm` chỉ cần USER ID: presign tạo file MỚI (chưa có bản ghi nào để
   * quy phạm vi), còn confirm vốn đã chặn chỉ người tải lên — hẹp hơn phạm vi. Hai đường
   * ĐỌC thì cần cả mã quyền, nên dùng `caller`. */
  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Post('presign-upload')
  @RequirePermission('file.object.upload')
  presign(@Body() dto: PresignUploadDto, @Req() req: Request) {
    return this.svc.presignUpload(dto, this.actor(req));
  }

  @Post(':id/confirm')
  @RequirePermission('file.object.confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmUploadDto, @Req() req: Request) {
    return this.svc.confirmUpload(id, dto, this.actor(req));
  }

  @Get(':id/download-url')
  @RequirePermission('file.object.download')
  downloadUrl(@Param('id') id: string, @Req() req: Request) {
    return this.svc.getDownloadUrl(id, this.caller(req));
  }

  @Get(':id')
  @RequirePermission('file.object.view')
  meta(@Param('id') id: string, @Req() req: Request) {
    return this.svc.getMeta(id, this.caller(req));
  }
}
