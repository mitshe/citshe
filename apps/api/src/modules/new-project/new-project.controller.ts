import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
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
import { UserId } from '../../shared/decorators/organization.decorator';
import { NewProjectService } from './new-project.service';

class NewProjectKeysDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  github: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  cloudflare?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  vercel?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  neon?: string;
}

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

class ValidateGithubDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  github: string;
}

class ImproveDescriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  description: string;
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
  @Type(() => NewProjectKeysDto)
  keys: NewProjectKeysDto;

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

  @Post('validate-github')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Pre-flight check the GitHub token before building (scopes/expiry)',
  })
  @ApiResponse({ status: 200, description: 'Validation verdict' })
  async validateGithub(@Body() dto: ValidateGithubDto) {
    return this.newProject.validateGithub(dto.github);
  }

  @Post('improve-description')
  @HttpCode(200)
  @ApiOperation({
    summary: "Rewrite the project description with AI (uses the user's AI key)",
  })
  @ApiResponse({ status: 200, description: 'Improved description' })
  async improveDescription(
    @UserId() userId: string,
    @Body() dto: ImproveDescriptionDto,
  ) {
    const description = await this.newProject.improveDescription(
      userId,
      dto.description,
    );
    return { description };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a portal + repo + build task atomically (all-or-nothing)',
  })
  @ApiResponse({ status: 201, description: 'Project created and building' })
  async create(@UserId() userId: string, @Body() dto: CreateNewProjectDto) {
    return this.newProject.create(userId, {
      name: dto.name,
      repoName: dto.repoName,
      keys: dto.keys,
      buildSpec: dto.buildSpec,
    });
  }
}
