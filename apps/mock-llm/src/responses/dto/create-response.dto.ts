import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class InputMessageDto {
  @IsIn(['developer', 'system', 'user', 'assistant'])
  role!: 'developer' | 'system' | 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class CreateResponseDto {
  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InputMessageDto)
  input!: InputMessageDto[];

  @IsBoolean()
  stream!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_output_tokens?: number;
}
