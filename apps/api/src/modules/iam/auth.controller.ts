import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RevealFields } from '../../common/masking/mask.decorator';

// Credential endpoints are rate limited per IP ('auth' throttler, app.module.ts):
// without it, /auth/login is an unmetered password oracle. logout/me are cheap and
// already require a valid token, but share the controller-level guard.
@ApiTags('auth')
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  /* Email trả về ở đây là email người gọi VỪA TỰ NHẬP để đăng nhập, không phải dữ liệu
   * cá nhân của người khác. Không miễn thì response trả `***` — đúng luật nhưng vô nghĩa. */
  @RevealFields('email')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });
  }

  @Post('refresh')
  @Public()
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request): Promise<void> {
    if (req.user === undefined) {
      throw new UnauthorizedException();
    }
    await this.auth.logout(req.user.sid);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  /* Email ở đây là email của CHÍNH người đang gọi, không phải dữ liệu cá nhân của người
   * khác. Sổ trường nhạy cảm khớp theo tên nên nó sẽ che — miễn cho đúng route này. */
  @RevealFields('email')
  me(@Req() req: Request) {
    if (req.user === undefined) {
      throw new UnauthorizedException();
    }
    return this.auth.me(req.user.userId);
  }
}
