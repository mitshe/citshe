import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PluginType } from '@prisma/client';
import { PluginsService } from '../services/plugins.service';
import { ConnectPluginDto } from '../dto/plugin.dto';
import { AuthGuard } from '@/shared/auth';
import { OrganizationId } from '../../../shared/decorators/organization.decorator';

@ApiTags('Plugins')
@ApiBearerAuth('bearer')
@Controller('api/v1/plugins')
@UseGuards(AuthGuard)
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  @ApiOperation({ summary: 'List connected stack plugins' })
  async list(@OrganizationId() organizationId: string) {
    const plugins = await this.plugins.findAll(organizationId);
    return { plugins };
  }

  @Post()
  @ApiOperation({ summary: 'Connect a stack plugin' })
  @ApiResponse({ status: 201, description: 'Plugin connected' })
  async connect(
    @OrganizationId() organizationId: string,
    @Body() dto: ConnectPluginDto,
  ) {
    const plugin = await this.plugins.connect(organizationId, dto);
    return { plugin };
  }

  @Post('test')
  @ApiOperation({ summary: 'Test a config before connecting' })
  @HttpCode(HttpStatus.OK)
  async testConfig(@Body() dto: ConnectPluginDto) {
    return this.plugins.testConfig(dto);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test an existing plugin' })
  @HttpCode(HttpStatus.OK)
  async test(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.plugins.testExisting(organizationId, id);
  }

  @Get(':type/status')
  @ApiOperation({ summary: 'Live normalized status for a plugin type' })
  async status(
    @OrganizationId() organizationId: string,
    @Param('type') type: string,
  ) {
    const status = await this.plugins.getStatus(
      organizationId,
      type.toUpperCase() as PluginType,
    );
    return { status };
  }

  @Get(':type/resources')
  @ApiOperation({ summary: 'Resources the plugin can see, + current selection' })
  async resources(
    @OrganizationId() organizationId: string,
    @Param('type') type: string,
  ) {
    return this.plugins.listResources(
      organizationId,
      type.toUpperCase() as PluginType,
    );
  }

  @Put(':type/config')
  @ApiOperation({ summary: 'Merge a partial config (e.g. selection) into a plugin' })
  @HttpCode(HttpStatus.OK)
  async updateConfig(
    @OrganizationId() organizationId: string,
    @Param('type') type: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plugins.updateConfig(
      organizationId,
      type.toUpperCase() as PluginType,
      body,
    );
  }

  @Get('previews')
  @ApiOperation({ summary: 'Recent preview deployments (optionally for a repo)' })
  async previews(
    @OrganizationId() organizationId: string,
    @Query('repo') repo?: string,
  ) {
    const previews = await this.plugins.listPreviews(organizationId, repo);
    return { previews };
  }

  @Post(':type/action')
  @ApiOperation({ summary: 'Run a plugin write-action (redeploy, add subdomain…)' })
  @HttpCode(HttpStatus.OK)
  async action(
    @OrganizationId() organizationId: string,
    @Param('type') type: string,
    @Body() body: { actionId: string; input?: Record<string, unknown> },
  ) {
    return this.plugins.runAction(
      organizationId,
      type.toUpperCase() as PluginType,
      body.actionId,
      body.input,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect a plugin' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.plugins.remove(organizationId, id);
  }
}
