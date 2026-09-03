import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardFeesController } from './card-fees.controller';
import { CardFeesService } from './card-fees.service';

@Module({
  imports: [AuthModule],
  controllers: [CardsController, CardFeesController],
  providers: [CardsService, CardFeesService],
  exports: [CardsService, CardFeesService],
})
export class CardsModule {}
