import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { AuditQueryService } from './audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';

// Read-only audit query. Requires authentication; fine-grained audit.view permission
// enforcement (PolicyEvaluator + loaded grants) is a follow-up once grants are seeded.
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
