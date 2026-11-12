import { PartialType } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { COMMISSION_BASES, GUARANTEE_STATUSES, GUARANTEE_TYPES } from '../bank.constants';

export class CreateGuaranteeDto {
  @IsString() @IsNotEmpty() @MaxLength(64) companyId!: string;
  @IsOptional() @IsString() @MaxLength(64) bankId?: string | null;
  /** required when no bankId is given */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(120) branch?: string;
  @IsIn(GUARANTEE_TYPES as unknown as string[]) type!: string;
  @IsOptional() @IsString() @MaxLength(80) guaranteeNo?: string;
  @IsOptional() @IsString() @MaxLength(64) bidId?: string | null;
  @IsOptional() @IsString() @MaxLength(64) tenderId?: string | null;
  @IsOptional() @IsString() @MaxLength(64) projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) beneficiary?: string;
  @IsOptional() @IsString() @MaxLength(300) purpose?: string;
  @IsNumber() @Min(1) amount!: number;
  @IsOptional() @IsDateString() issueDate?: string | null;
  @IsOptional() @IsDateString() expiryDate?: string | null;
  @IsOptional() @IsDateString() claimExpiryDate?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) marginPct?: number | null;
  @IsOptional() @IsNumber() @Min(0) marginAmount?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) commissionPct?: number | null;
  @IsOptional() @IsIn(COMMISSION_BASES as unknown as string[]) commissionBasis?: string | null;
  @IsOptional() @IsNumber() @Min(0) commissionAmount?: number | null;
  @IsOptional() @IsIn(GUARANTEE_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsDateString() releaseDate?: string | null;
  @IsOptional() @IsString() @MaxLength(120) releaseRef?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class UpdateGuaranteeDto extends PartialType(CreateGuaranteeDto) {}
