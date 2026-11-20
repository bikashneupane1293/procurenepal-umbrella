import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class InviteStaffDto {
  /** an email address, or a personal ID like U-8H3K2M */
  @IsString() @MinLength(3) @MaxLength(200)
  target!: string;

  @IsOptional() @IsString()
  role?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];

  @IsOptional() @IsString() @MaxLength(80)
  customTitle?: string;

  @IsOptional() @IsString() @MaxLength(120)
  fullName?: string;
}

export class ApproveRequestDto {
  @IsOptional() @IsString()
  role?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];

  @IsOptional() @IsString() @MaxLength(80)
  customTitle?: string;
}

export class JoinOrgDto {
  @IsString() @MinLength(3) @MaxLength(20)
  orgCode!: string;
}
