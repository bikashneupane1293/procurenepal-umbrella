import { IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class SetPlanDto {
  @IsIn(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
  plan!: string;

  @IsOptional() @IsIn(['ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'TRIALING'])
  status?: string;

  @IsOptional() @IsString()
  expiresAt?: string;

  @IsOptional() @IsString()
  paymentMethod?: string;

  @IsOptional() @IsString()
  paymentRef?: string;

  @IsOptional() @IsNumber()
  amountNPR?: number;

  @IsOptional() @IsString()
  note?: string;
}

export class ToggleTenantDto {
  @IsBoolean()
  isActive!: boolean;
}
