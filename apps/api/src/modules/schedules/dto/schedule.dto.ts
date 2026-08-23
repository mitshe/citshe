import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryMode } from '@prisma/client';

const DELIVERY_MODES: DeliveryMode[] = ['PR', 'DIRECT_PUSH'];

export class CreateScheduleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ description: 'Instruction for the created task' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  prompt!: string;

  @ApiProperty({ description: '5-field cron expression, e.g. "0 8 * * 1"' })
  @IsString()
  @IsNotEmpty()
  cron!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repositoryId?: string;

  @ApiPropertyOptional({ enum: DELIVERY_MODES })
  @IsOptional()
  @IsIn(DELIVERY_MODES)
  deliveryMode?: DeliveryMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  prompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cron?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  repositoryId?: string | null;

  @ApiPropertyOptional({ enum: DELIVERY_MODES })
  @IsOptional()
  @IsIn(DELIVERY_MODES)
  deliveryMode?: DeliveryMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
