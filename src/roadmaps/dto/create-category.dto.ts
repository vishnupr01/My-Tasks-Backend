import { IsString, Length } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 60)
  name: string;
}
