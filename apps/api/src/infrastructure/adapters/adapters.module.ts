import { Global, Module } from '@nestjs/common';
import { AdapterFactoryService } from './adapter-factory.service';
import { GithubAppService } from './git-provider/github-app.service';
import { PrismaModule } from '../persistence/prisma/prisma.module';
import { SharedModule } from '../../shared/shared.module';

@Global()
@Module({
  imports: [PrismaModule, SharedModule],
  providers: [AdapterFactoryService, GithubAppService],
  exports: [AdapterFactoryService, GithubAppService],
})
export class AdaptersModule {}
