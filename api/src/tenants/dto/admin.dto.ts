import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

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

/**
 * Super Admin creates a brand-new workspace directly from the Admin Panel (Task 8:
 * organization-setup onboarding) — instead of the organization owner self-registering.
 * The owner is created PENDING with an activation link, same as the Owner inviting a
 * teammate (AccessService.createUser) — there is still no email service, so Super Admin
 * copies the link and sends it to the new owner themselves.
 */
export class CreateTenantDto {
  @MinLength(2)
  @IsString()
  tenantName!: string;

  @MinLength(2)
  @IsString()
  ownerName!: string;

  @IsEmail()
  ownerEmail!: string;

  @IsOptional() @IsString()
  ownerPhone?: string;

  @IsOptional() @IsIn(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'])
  plan?: string;
}
