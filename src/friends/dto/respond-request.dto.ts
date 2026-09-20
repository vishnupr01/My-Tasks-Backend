import { IsIn } from 'class-validator';

export class RespondRequestDto {
  @IsIn(['ACCEPTED', 'DECLINED'])
  status: 'ACCEPTED' | 'DECLINED';
}
