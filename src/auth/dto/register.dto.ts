import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  // Normalized so login (see LoginDto) always matches regardless of the
  // case a browser/keyboard happened to send.
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  email: string;

  @Matches(/^[a-z0-9._]{3,20}$/, {
    message: 'username must be 3-20 characters: lowercase letters, numbers, "." or "_"',
  })
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  inviteCode?: string;
}
