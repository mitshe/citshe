import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsArray,
  ArrayMaxSize,
  MinLength,
  MaxLength,
  IsInt,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskStatus, DeliveryMode } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  priority?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  repositoryId?: string;

  @IsEnum(DeliveryMode)
  @IsOptional()
  deliveryMode?: DeliveryMode;
}

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10000)
  description?: string;

  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  priority?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(100)
  repositoryId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  assigneeId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  dueDate?: string;

  @IsEnum(DeliveryMode)
  @IsOptional()
  deliveryMode?: DeliveryMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  queueOrder?: number;

  @IsObject()
  @IsOptional()
  result?: Record<string, unknown>;
}

export class TaskFilterDto {
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @IsString()
  @IsOptional()
  repositoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class TaskResponseDto {
  @ApiProperty({ description: 'Unique task identifier' })
  id: string;

  @ApiProperty({ description: 'Organization ID' })
  organizationId: string;

  @ApiPropertyOptional({ description: 'Repository ID', nullable: true })
  repositoryId: string | null;

  @ApiProperty({ description: 'Task title' })
  title: string;

  @ApiPropertyOptional({ description: 'Task description', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Task status', enum: TaskStatus })
  status: TaskStatus;

  @ApiPropertyOptional({ description: 'Task priority', nullable: true })
  priority: string | null;

  @ApiProperty({ description: 'Free-form labels', type: [String] })
  labels: string[];

  @ApiPropertyOptional({ description: 'Task result data', nullable: true })
  result: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Agent processing logs', nullable: true })
  agentLogs: Record<string, unknown>[] | null;

  @ApiProperty({ description: 'User ID who created the task' })
  createdBy: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

// Wrapper response DTOs for API responses
export class TaskWrapperResponseDto {
  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;
}

export class TaskWithMessageResponseDto {
  @ApiProperty({ type: TaskResponseDto })
  task: TaskResponseDto;

  @ApiProperty({ description: 'Response message' })
  message: string;
}

export class TaskListResponseDto {
  @ApiProperty({ type: [TaskResponseDto], description: 'List of tasks' })
  data: TaskResponseDto[];

  @ApiProperty({ description: 'Total number of tasks' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;
}
