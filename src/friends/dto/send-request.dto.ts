import { IsString } from 'class-validator';

export class SendRequestDto {
  @IsString()
  receiverId: string;
}
