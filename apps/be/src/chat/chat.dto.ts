import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { ChatRoomStatus } from './chat.models';

export class CreateChatRoomDto {}

export class ChatRoomPageQuery {
  @IsOptional()
  @IsString()
  cursor?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class MessagePageQuery {
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @IsString()
  cursor?: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class UpdateChatRoomDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsIn(['regular', 'archived'])
  status?: ChatRoomStatus;
}
