import { Module } from '@nestjs/common';
import { PluginsController } from './controllers/plugins.controller';
import { PluginsService } from './services/plugins.service';

@Module({
  controllers: [PluginsController],
  providers: [PluginsService],
  exports: [PluginsService],
})
export class PluginsModule {}
