import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateAccessRequestDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  email: string;
}
