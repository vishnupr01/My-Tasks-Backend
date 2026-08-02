import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail()
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
