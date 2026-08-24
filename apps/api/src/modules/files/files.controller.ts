import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { FilesService } from './files.service';
import { ConfirmUploadDto, PresignUploadDto } from './files.dto';

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  @Post('presign-upload')
  presign(@Body() dto: PresignUploadDto, @Req() req: Request) {
    return this.svc.presignUpload(dto, req.user?.userId ?? null);
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmUploadDto) {
    return this.svc.confirmUpload(id, dto);
  }

  @Get(':id/download-url')
  downloadUrl(@Param('id') id: string, @Req() req: Request) {
    return this.svc.getDownloadUrl(id, req.user?.userId ?? null);
  }

  @Get(':id')
  meta(@Param('id') id: string) {
    return this.svc.getMeta(id);
  }
}
