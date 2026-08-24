import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { ContractsService } from './contracts.service';
import { AddPartyDto, CreateContractDto } from './contracts.dto';

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post()
  create(@Body() dto: CreateContractDto, @Req() req: Request) {
    return this.svc.create(dto, this.actor(req));
  }

  @Post(':id/parties')
  addParty(@Param('id') id: string, @Body() dto: AddPartyDto) {
    return this.svc.addParty(id, dto);
  }

  @Post(':id/verify')
  verify(@Param('id') id: string, @Req() req: Request) {
    return this.svc.verify(id, this.actor(req));
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @Req() req: Request) {
    return this.svc.activate(id, this.actor(req));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get()
  list(
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('gravePlotId') gravePlotId?: string,
  ) {
    return this.svc.list(companyId, status, gravePlotId);
  }
}
