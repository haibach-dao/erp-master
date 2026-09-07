import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Secrets/expiry are passed per sign/verify call in AuthService (separate access/refresh secrets).
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService],
  exports: [AuthService],
})
export class AuthModule {}
