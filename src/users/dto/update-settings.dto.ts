import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsBoolean()
  @IsOptional()
  notificationsEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  notificationSoundEnabled?: boolean;
}
