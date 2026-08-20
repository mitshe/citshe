import { IsObject, IsString } from 'class-validator';
import { PluginType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectPluginDto {
  @IsString()
  @ApiProperty({ enum: ['CLOUDFLARE', 'NEON', 'GOOGLE_ADS'] })
  type: PluginType;

  @IsObject()
  @ApiProperty({ description: 'Provider config (encrypted at rest)' })
  config: Record<string, unknown>;
}
