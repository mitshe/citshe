import { IsObject, IsOptional, IsString } from 'class-validator';
import { IntegrationType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateIntegrationDto {
  @IsString()
  @ApiProperty({ enum: ['GITHUB'], description: 'Integration type' })
  type: IntegrationType;

  // For GitHub this is { accessToken } (PAT) or { mode:'app', installationId }.
  @IsObject()
  @ApiProperty({ description: 'Provider config (encrypted at rest)' })
  config: Record<string, unknown>;
}

export class UpdateIntegrationDto {
  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Provider config to merge/replace' })
  config?: Record<string, unknown>;
}

export class IntegrationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() type: IntegrationType;
  @ApiProperty() status: string;
  @ApiProperty() organizationId: string;
  @ApiPropertyOptional({ nullable: true }) lastSyncAt: string | null;
  @ApiPropertyOptional({ nullable: true }) errorMessage: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
