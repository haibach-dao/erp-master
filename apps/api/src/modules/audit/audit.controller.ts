import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { MaskUnless } from '../../common/masking/mask.decorator';
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
  @MaskUnless(
    { field: 'beforeData', permission: 'audit.event.view_sensitive' },
    { field: 'afterData', permission: 'audit.event.view_sensitive' },
  )
  list(@Query() query: AuditQueryDto) {
    return this.auditQuery.query(query);
  }

  /* Giá trị có thật trong nhật ký, cho các ô chọn của bộ lọc. Cùng mã gate với việc đọc
   * nhật ký: ai đọc được nhật ký thì đọc được danh sách người/hành động trong đó — che
   * cái này mà mở cái kia là vô nghĩa. */
  @Get('facets')
  @RequirePermission('audit.event.view')
  facets() {
    return this.auditQuery.facets();
  }
}
