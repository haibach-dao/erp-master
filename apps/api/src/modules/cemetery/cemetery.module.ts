import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { CemeteryController } from './cemetery.controller';
import { CemeteryService } from './cemetery.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard -> AuthService
  controllers: [CemeteryController],
  providers: [CemeteryService],
  exports: [CemeteryService],
})
export class CemeteryModule {}
