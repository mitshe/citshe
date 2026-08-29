import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IntegrationsService } from '../services/integrations.service';
import { GithubAppService } from '../../../infrastructure/adapters/git-provider/github-app.service';
import { CreateIntegrationDto } from '../dto/integration.dto';
import { AuthGuard } from '@/shared/auth';
import { OrganizationId } from '../../../shared/decorators/organization.decorator';

@ApiTags('Integrations')
@ApiBearerAuth('bearer')
@Controller('api/v1/integrations')
@UseGuards(AuthGuard)
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly githubApp: GithubAppService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List connected integrations' })
  async list(@OrganizationId() organizationId: string) {
    const integrations = await this.integrations.findAll(organizationId);
    // Tell the UI whether GitHub App SSO is available so it can hide the button
    // when the App isn't configured (PAT-only mode).
    return {
      integrations,
      githubApp: { available: this.githubApp.isConfigured() },
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an integration' })
  async get(@OrganizationId() organizationId: string, @Param('id') id: string) {
    const integration = await this.integrations.findOne(organizationId, id);
    return { integration };
  }

  @Post()
  @ApiOperation({ summary: 'Connect an integration with a token (PAT)' })
  @ApiResponse({ status: 201, description: 'Integration connected' })
  async create(
    @OrganizationId() organizationId: string,
    @Body() dto: CreateIntegrationDto,
  ) {
    const integration = await this.integrations.create(organizationId, dto);
    return { integration };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect an integration' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.integrations.remove(organizationId, id);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test a config before connecting' })
  @HttpCode(HttpStatus.OK)
  async testConfig(@Body() dto: CreateIntegrationDto) {
    return this.integrations.testConfig(dto);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test an existing integration' })
  @HttpCode(HttpStatus.OK)
  async test(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.integrations.test(organizationId, id);
  }

  @Get('github/app/start')
  @ApiOperation({
    summary: 'Begin GitHub App install (SSO). Returns install URL.',
  })
  startGithubApp(@OrganizationId() organizationId: string) {
    if (!this.githubApp.isConfigured()) {
      throw new BadRequestException(
        'GitHub App SSO is not configured on this server. Use a token instead.',
      );
    }
    const url = this.githubApp.buildInstallUrl(organizationId);
    return { url };
  }
}
