import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from '@/infrastructure/queue/queues';
import { SchedulesController } from './controllers/schedules.controller';
import { SchedulesService } from './services/schedules.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.SCHEDULES })],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
