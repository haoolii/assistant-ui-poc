import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class RunAgentInputDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string;

  @IsString()
  @IsNotEmpty()
  runId!: string;

  @IsOptional()
  @IsString()
  protocolVersion?: string;

  @IsOptional()
  @IsString()
  parentRunId?: string;

  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;

  @IsArray()
  @IsObject({ each: true })
  messages!: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  tools?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  context?: Record<string, unknown>[];

  @IsOptional()
  forwardedProps?: unknown;

  @IsOptional()
  @IsArray()
  resume?: Record<string, unknown>[];
}

export class CancelRunDto {
  @IsString()
  @IsNotEmpty()
  threadId!: string;
}
