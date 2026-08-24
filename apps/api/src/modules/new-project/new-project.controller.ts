import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthGuard } from '@/shared/auth';
import { OrganizationId } from '../../shared/decorators/organization.decorator';
import { UserId } from '../../shared/decorators/organization.decorator';
import { NewProjectService } from './new-project.service';

class NewProjectBuildSpecDto {
  @IsIn(['scratch', 'refresh'])
  mode: 'scratch' | 'refresh';

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  prompt: string;

  @IsUrl({ require_protocol: true })
  @IsOptional()
  @MaxLength(2048)
  sourceUrl?: string;

  @IsIn(['private', 'public'])
  visibility: 'private' | 'public';

  @IsIn(['next', 'astro', 'astro-svelte'])
  @IsOptional()
  stackHint?: 'next' | 'astro' | 'astro-svelte';

  @IsIn(['cloudflare', 'vercel'])
  @IsOptional()
  hostingHint?: 'cloudflare' | 'vercel';
}

class CreateNewProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'Repo name may only contain letters, digits, ., - and _',
  })
  repoName: string;

  @IsObject()
  @ValidateNested()
  @Type(() => NewProjectBuildSpecDto)
  buildSpec: NewProjectBuildSpecDto;
}

@ApiTags('New Project')
@ApiBearerAuth('bearer')
@Controller('api/v1/new-project')
@UseGuards(AuthGuard)
export class NewProjectController {
  constructor(private readonly newProject: NewProjectService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a portal + repo + build task atomically (all-or-nothing)',
  })
  @ApiResponse({ status: 201, description: 'Project created and building' })
  async create(
    @OrganizationId() organizationId: string,
    @UserId() userId: string,
    @Body() dto: CreateNewProjectDto,
  ) {
    return this.newProject.create(organizationId, userId, {
      name: dto.name,
      repoName: dto.repoName,
      buildSpec: dto.buildSpec,
    });
  }
}
