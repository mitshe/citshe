import { Global, Module } from '@nestjs/common';
import { CliController } from './controllers/cli.controller';
import { CliService } from './services/cli.service';

// Global so the WebSocket gateway can resolve `ctk_` tokens for CLI attach.
@Global()
@Module({
  controllers: [CliController],
  providers: [CliService],
  exports: [CliService],
})
export class CliModule {}
