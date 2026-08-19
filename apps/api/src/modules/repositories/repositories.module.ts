import { Module } from '@nestjs/common';
import { RepositoriesController } from './controllers/repositories.controller';
import { RepositoriesService } from './services/repositories.service';
import { RepoAnalysisService } from './services/repo-analysis.service';

@Module({
  controllers: [RepositoriesController],
  providers: [RepositoriesService, RepoAnalysisService],
  exports: [RepositoriesService, RepoAnalysisService],
})
export class RepositoriesModule {}
