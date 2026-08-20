import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../services/integrations.service';
import { GithubAppService } from '../../../infrastructure/adapters/git-provider/github-app.service';

/**
 * Unauthenticated because GitHub redirects the user's browser here after they
 * install the App — no bearer token is available. Trust is established by the
 * signed `state` we issued in /integrations/github/app/start, which carries the
 * organization id and cannot be forged without our secret.
 */
@ApiExcludeController()
@Controller('api/v1/integrations/github/app')
export class GithubAppCallbackController {
  private readonly logger = new Logger(GithubAppCallbackController.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly githubApp: GithubAppService,
    private readonly config: ConfigService,
  ) {}

  @Get('callback')
  async callback(
    @Query('installation_id') installationId: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const appUrl =
      this.config.get<string>('APP_URL') || 'http://localhost:3000';

    try {
      const organizationId = this.githubApp.verifyState(state);
      if (!organizationId || !installationId) {
        throw new Error('Missing organization or installation id');
      }
      await this.integrations.saveGithubAppInstallation(
        organizationId,
        installationId,
      );
      return res.redirect(`${appUrl}/repos?connected=github`);
    } catch (err) {
      this.logger.warn(`GitHub App callback failed: ${(err as Error).message}`);
      return res.redirect(`${appUrl}/repos?connected=error`);
    }
  }
}
