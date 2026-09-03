import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CatalogSentryService } from '../modules/authorization/catalog-sentry.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly catalogSentry: CatalogSentryService) {}

  /* `status` KHÔNG phụ thuộc vào lệch danh mục quyền — CỐ Ý, và đây là chỗ dễ làm hỏng nhất.
   * Endpoint này có thể đang nối bộ cân tải: cho `status` đổi theo lệch nghĩa là một mã thừa
   * thuần mỹ phẩm sẽ rút instance khỏi vòng phục vụ, tức người gác tự gây ra đúng cái sự cố nó
   * sinh ra để tránh. Lệch đi ra bằng một TRƯỜNG RIÊNG, và chỉ là SỐ ĐẾM: `/health` là route
   * `@Public`, không được phát tên mã quyền cho người chưa đăng nhập.
   *
   * Thêm TRƯỜNG chứ không thêm ROUTE: `authz-invariants` khẳng định danh sách route công khai
   * đúng bằng ba mục, nên một `GET /health/authz` sẽ làm đỏ ratchet đó mà chẳng được gì. */
  @Get()
  @Public()
  check(): {
    status: string;
    uptime: number;
    timestamp: string;
    authzCatalog: ReturnType<CatalogSentryService['summary']>;
  } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      authzCatalog: this.catalogSentry.summary(),
    };
  }
}
