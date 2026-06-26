import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { Priority, Status } from './create-task.dto';

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority;

  @IsEnum(Status)
  @IsOptional()
  status?: Status;

  @IsDateString()
  @IsOptional()
  dueDate?: string;
}
