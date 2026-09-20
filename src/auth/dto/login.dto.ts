import { IsEmail, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  // Emails are looked up with an exact match -- normalizing case here means
  // a mobile keyboard auto-capitalizing the first letter (a real, common
  // behavior on some browsers/keyboards) doesn't turn into a false
  // "invalid credentials" for an otherwise-correct password.
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  email: string;

  @IsString()
  password: string;
}
