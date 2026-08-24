import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/shared/auth';
import { UserId } from '../../../shared/decorators/organization.decorator';
import { CliService } from '../services/cli.service';
import {
  SessionImportService,
  ImportSessionInput,
} from '../services/session-import.service';

/**
 * The citshe CLI API. Two auth modes:
 *  - CLI endpoints (`/me`, `/sessions`, `/sessions/import`) take a `ctk_`
 *    personal access token (user-scoped, all orgs) via Bearer.
 *  - Token management (`/tokens`) is called from the PANEL and uses the normal
 *    user AuthGuard.
 */
@ApiTags('CLI')
@Controller('api/v1/cli')
export class CliController {
  constructor(
    private readonly cli: CliService,
    private readonly sessionImport: SessionImportService,
  ) {}

  private async ctx(authorization: string | undefined) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Missing CLI token');
    return this.cli.resolveToken(token);
  }

  // ─── CLI (ctk_ token) ───────────────────────────────────────────

  @Get('me')
  @ApiOperation({ summary: 'Who am I + my organizations (CLI token)' })
  async me(@Headers('authorization') authorization?: string) {
    return this.cli.me(await this.ctx(authorization));
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Sessions across all my orgs (CLI token)' })
  async sessions(@Headers('authorization') authorization?: string) {
    const sessions = await this.cli.sessions(await this.ctx(authorization));
    return { sessions };
  }

  @Post('sessions/import')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Import a local Claude Code session (CLI token)' })
  async import(
    @Body() body: ImportSessionInput,
    @Headers('authorization') authorization?: string,
  ) {
    const ctx = await this.ctx(authorization);
    return this.sessionImport.importSession(ctx, body);
  }

  // ─── Token management (panel, user AuthGuard) ───────────────────

  @Post('tokens')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Create a CLI token (shown once)' })
  async createToken(@UserId() userId: string, @Body() body: { name?: string }) {
    return this.cli.createToken(userId, body?.name || 'CLI token');
  }

  @Get('tokens')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List my CLI tokens' })
  async listTokens(@UserId() userId: string) {
    const tokens = await this.cli.listTokens(userId);
    return { tokens };
  }

  @Delete('tokens/:id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a CLI token' })
  async deleteToken(@UserId() userId: string, @Param('id') id: string) {
    return this.cli.deleteToken(userId, id);
  }
}
