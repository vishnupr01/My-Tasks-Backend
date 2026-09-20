import { IsString, IsOptional, IsIn, IsInt, Min, Length } from 'class-validator';

// Text is optional -- a message can be attachment-only. The "must have
// content or an attachment" rule is enforced in FriendsService.sendMessage,
// since it's a cross-field check class-validator doesn't express cleanly.
export class SendDirectMessageDto {
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  content?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'file'])
  attachmentType?: string;

  @IsOptional()
  @IsString()
  attachmentName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  attachmentDuration?: number;
}
