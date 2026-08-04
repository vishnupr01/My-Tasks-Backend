import { IsString, IsBoolean, IsOptional, Length } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @Length(2, 40)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;
}
