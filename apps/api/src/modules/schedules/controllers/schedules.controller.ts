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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/shared/auth';
import {
  OrganizationId,
  UserId,
} from '../../../shared/decorators/organization.decorator';
import { ApiRateLimit } from '../../../shared/decorators/throttle.decorator';
import { SchedulesService } from '../services/schedules.service';
import { CreateScheduleDto, UpdateScheduleDto } from '../dto/schedule.dto';

@ApiTags('Schedules')
@ApiBearerAuth('bearer')
@Controller('api/v1/schedules')
@UseGuards(AuthGuard)
@ApiRateLimit()
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @ApiOperation({ summary: 'List schedules' })
  async list(@OrganizationId() organizationId: string) {
    const schedules = await this.schedules.findAll(organizationId);
    return { schedules };
  }

  @Post()
  @ApiOperation({ summary: 'Create a schedule' })
  async create(
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
    @Body() dto: CreateScheduleDto,
  ) {
    const schedule = await this.schedules.create(organizationId, userId, dto);
    return { schedule };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a schedule' })
  async update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    const schedule = await this.schedules.update(organizationId, id, dto);
    return { schedule };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a schedule' })
  async remove(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.schedules.remove(organizationId, id);
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run a schedule now' })
  @HttpCode(HttpStatus.OK)
  async runNow(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.schedules.runNow(organizationId, id);
  }
}
