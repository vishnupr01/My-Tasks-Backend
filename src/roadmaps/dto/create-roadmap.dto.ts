import { IsString, IsOptional, Length } from 'class-validator';

export class CreateRoadmapDto {
  @IsString()
  @Length(2, 60)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}
