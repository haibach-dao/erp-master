import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { AuditQueryService } from './audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';

// Read-only audit query, gated on `audit.event.view`. Reading the audit log is itself
// an event worth recording (doc 16 §D.8) — that self-audit is not wired yet.
@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('audit-events')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.event.view')
  list(@Query() query: AuditQueryDto) {
    return this.auditQuery.query(query);
  }
}
