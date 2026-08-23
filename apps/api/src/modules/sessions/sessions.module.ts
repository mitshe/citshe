import { Global, Module } from '@nestjs/common';
import { SessionsController } from './controllers/sessions.controller';
import { SessionsService } from './services/sessions.service';
import { SessionContainerService } from './services/session-container.service';
import { TerminalManagerService } from './services/terminal-manager.service';
import { SkillsModule } from '../skills/skills.module';
import { PluginsModule } from '../plugins/plugins.module';

@Global()
@Module({
  imports: [SkillsModule, PluginsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionContainerService, TerminalManagerService],
  exports: [SessionsService, SessionContainerService, TerminalManagerService],
})
export class SessionsModule {}
