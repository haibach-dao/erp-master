import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule], // for JwtAuthGuard -> AuthService
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
