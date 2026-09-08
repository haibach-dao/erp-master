import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardFeesController } from './card-fees.controller';
import { CardFeesService } from './card-fees.service';
import { CardSignersController } from './card-signers.controller';
import { CardSignersService } from './card-signers.service';
import { CardApprovalsController } from './card-approvals.controller';
import { CardApprovalsService } from './card-approvals.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CardsController,
    CardFeesController,
    CardSignersController,
    CardApprovalsController,
  ],
  providers: [CardsService, CardFeesService, CardSignersService, CardApprovalsService],
  exports: [CardsService, CardFeesService, CardSignersService, CardApprovalsService],
})
export class CardsModule {}
