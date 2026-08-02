import { IsIn } from 'class-validator';

export class DecideAccessRequestDto {
  @IsIn(['APPROVED', 'DECLINED'])
  status: 'APPROVED' | 'DECLINED';
}
