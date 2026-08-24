import { Global, Module } from '@nestjs/common';
import { CliController } from './controllers/cli.controller';
import { CliService } from './services/cli.service';
import { SessionImportService } from './services/session-import.service';

// Global so the WebSocket gateway can resolve `ctk_` tokens for CLI attach.
// SessionsModule / WebSocketModule are @Global, so SessionsService,
// SessionContainerService and EventsGateway are injectable here without an
// explicit import.
@Global()
@Module({
  controllers: [CliController],
  providers: [CliService, SessionImportService],
  exports: [CliService],
})
export class CliModule {}
