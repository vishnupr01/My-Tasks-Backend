import { IsString, IsOptional, Length } from 'class-validator';

export class CreateTopicDto {
  @IsString()
  @Length(1, 150)
  title: string;

  @IsString()
  @IsOptional()
  description?: string;
}
