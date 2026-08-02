import { IsEmail } from 'class-validator';

export class CreateAccessRequestDto {
  @IsEmail()
  email: string;
}
