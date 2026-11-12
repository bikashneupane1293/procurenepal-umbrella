import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ACCOUNT_TYPES, COMMISSION_BASES } from '../bank.constants';

export class CreateBankDto {
  @IsString() @IsNotEmpty() @MaxLength(64) companyId!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsIn(ACCOUNT_TYPES as unknown as string[]) accountType?: string;
  @IsOptional() @IsNumber() @Min(0) bgLimit?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) defaultMarginPct?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) defaultCommissionPct?: number | null;
  @IsOptional() @IsIn(COMMISSION_BASES as unknown as string[]) commissionBasis?: string;
  @IsOptional() @IsString() @MaxLength(80) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @ValidateIf((o) => !!o.email) @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateBankDto extends PartialType(CreateBankDto) {}
