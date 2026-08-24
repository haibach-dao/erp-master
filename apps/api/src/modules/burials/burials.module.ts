import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { BurialsController } from './burials.controller';
import { BurialsService } from './burials.service';

@Module({
  imports: [AuthModule],
  controllers: [BurialsController],
  providers: [BurialsService],
  exports: [BurialsService],
})
export class BurialsModule {}
