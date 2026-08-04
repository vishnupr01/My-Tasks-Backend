import { IsString, IsOptional } from 'class-validator';

// Exactly one of userId/roleId must be set -- checked explicitly in the
// service (clean 400 error) rather than relying on the DB's CHECK constraint
// to catch it (which would surface as a raw, uglier database error).
export class GrantChannelAccessDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  roleId?: string;
}
