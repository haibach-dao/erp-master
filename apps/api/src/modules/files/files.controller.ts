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

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('presign-upload')
  presign(@Body() dto: PresignUploadDto, @Req() req: Request) {
    return this.svc.presignUpload(dto, this.actor(req));
  }

  @Post(':id/confirm')
  confirm(@Param('id') id: string, @Body() dto: ConfirmUploadDto, @Req() req: Request) {
    return this.svc.confirmUpload(id, dto, this.actor(req));
  }

  @Get(':id/download-url')
  downloadUrl(@Param('id') id: string, @Req() req: Request) {
    return this.svc.getDownloadUrl(id, this.actor(req));
  }

  @Get(':id')
  meta(@Param('id') id: string, @Req() req: Request) {
    return this.svc.getMeta(id, this.actor(req));
  }
}
