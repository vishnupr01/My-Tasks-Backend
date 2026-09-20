import { IsString, IsBoolean, IsOptional, Length, IsIn } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @Length(2, 40)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  // TEXT (default) = the chat channels that already existed. CODE adds a
  // shared editor alongside that same chat. Fixed at creation time --
  // changing it later would leave a channel owning a document nothing
  // renders, so it's deliberately not editable yet.
  @IsIn(['TEXT', 'CODE'])
  @IsOptional()
  kind?: 'TEXT' | 'CODE';
}
