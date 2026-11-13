import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ASSIGNABLE_ROLES } from '../module-registry';

// At least 8 characters with a letter and a number
const PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsIn(ASSIGNABLE_ROLES)
  role: string;

  // Optional on purpose (Task 5): leave it out and the new user gets an activation
  // link to set their own password; fill it in to activate the account immediately.
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD, { message: 'Password must be at least 8 characters with a letter and a number' })
  @IsOptional()
  password?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  modules?: string[];

  // Task 5: a free-text title shown instead of the system role name, e.g. "Site Supervisor - Butwal"
  @IsString()
  @MaxLength(60)
  @IsOptional()
  customTitle?: string;
}

export class UpdateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  fullName?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  @IsIn(ASSIGNABLE_ROLES)
  @IsOptional()
  role?: string;

  @IsString()
  @Matches(PASSWORD, { message: 'Password must be at least 8 characters with a letter and a number' })
  @IsOptional()
  password?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  modules?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @MaxLength(60)
  @IsOptional()
  customTitle?: string;
}

export class TenantModulesDto {
  // validated in the service against the registry: { bolpatra: true, fleet: false }
  @IsOptional()
  modules?: Record<string, boolean>;
}

export class TenantItemsDto {
  // validated in the service: { 'project.milestones': true, 'bank.lc': false }
  @IsOptional()
  items?: Record<string, boolean>;
}
