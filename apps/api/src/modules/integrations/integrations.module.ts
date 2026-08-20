import { Module } from '@nestjs/common';
import { IntegrationsController } from './controllers/integrations.controller';
import { GithubAppCallbackController } from './controllers/github-app-callback.controller';
import { IntegrationsService } from './services/integrations.service';

@Module({
  controllers: [IntegrationsController, GithubAppCallbackController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
