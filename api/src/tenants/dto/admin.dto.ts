import { IsArray, IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

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

  /** Optional: the exact modules Super Admin chose for this workspace (replaces the plan's default list). */
  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];

  /** Task 10: MONTHLY | YEARLY — when given, the price is looked up from the pricing catalog. */
  @IsOptional() @IsIn(['MONTHLY', 'YEARLY'])
  billingPeriod?: string;

  /** Task 10: promotion code to apply; rejected with the reason if it can't be used. */
  @IsOptional() @IsString()
  promoCode?: string;
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

  /** Optional: the exact modules Super Admin chose (replaces the plan's default list). */
  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];
}

/** Super Admin sets exactly which modules one workspace gets, or resets it to its plan's default. */
export class SetModulesDto {
  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];

  /** true = remove Super Admin's per-workspace choice and go back to the plan's default list. */
  @IsOptional() @IsBoolean()
  usePlanDefault?: boolean;
}
