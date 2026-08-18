import { Global, Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { SessionTools } from './tools/session.tools';
import { TaskTools } from './tools/task.tools';
import { RepositoryTools } from './tools/repository.tools';
import { SkillTools } from './tools/skill.tools';
import { TasksModule } from '../tasks/tasks.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { SkillsModule } from '../skills/skills.module';

@Global()
@Module({
  imports: [TasksModule, RepositoriesModule, SkillsModule],
  providers: [
    McpService,
    SessionTools,
    TaskTools,
    RepositoryTools,
    SkillTools,
  ],
  exports: [McpService],
})
export class McpModule {}
