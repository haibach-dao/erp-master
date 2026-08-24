import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, CreatePersonDto, CreateRelationshipDto } from './customers.dto';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('crm')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('persons')
  createPerson(@Body() dto: CreatePersonDto, @Req() req: Request) {
    return this.svc.createPerson(dto, this.actor(req));
  }

  @Post('customers')
  createCustomer(@Body() dto: CreateCustomerDto, @Req() req: Request) {
    return this.svc.createCustomer(dto, this.actor(req));
  }

  @Get('customers/search')
  search(@Query('q') q: string) {
    return this.svc.search(q ?? '');
  }

  @Post('relationships')
  createRelationship(@Body() dto: CreateRelationshipDto, @Req() req: Request) {
    return this.svc.createRelationship(dto, this.actor(req));
  }

  @Post('relationships/:id/end')
  endRelationship(@Param('id') id: string, @Req() req: Request) {
    return this.svc.endRelationship(id, this.actor(req));
  }

  @Get('persons/:id/relationships')
  personRelationships(@Param('id') id: string) {
    return this.svc.getPersonRelationships(id);
  }

  @Get('persons/:id/national-id')
  revealNationalId(@Param('id') id: string, @Req() req: Request) {
    return this.svc.revealNationalId(id, this.actor(req));
  }
}
