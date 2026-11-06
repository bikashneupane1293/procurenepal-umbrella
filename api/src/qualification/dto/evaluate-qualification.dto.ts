import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsBoolean,
  IsIn,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------- Legacy quick-check requirements (POST /qualification/evaluate) ----------
export class TenderRequirementsDto {
  @IsNumber()
  @IsOptional()
  requiredTurnover?: number;

  @IsString()
  @IsOptional()
  requiredActivity?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedProjectTypes?: string[];

  @IsNumber()
  @IsOptional()
  minimumActivityProduction?: number;

  // New (optional) quick-check fields
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimateAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  requiredBidCapacity?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  requiredSimilarValue?: number;
}

export class EvaluateQualificationDto {
  @IsString()
  @IsNotEmpty()
  companyId: string;

  /** If given, the saved tender's requirements are used (and requirements is ignored) */
  @IsString()
  @IsOptional()
  tenderId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenderRequirementsDto)
  requirements?: TenderRequirementsDto;
}

// ---------- JV evaluation ----------
export class JvPartnerDto {
  @IsString()
  @IsNotEmpty()
  companyId: string;

  @IsNumber()
  @Min(1)
  @Max(99)
  share: number;

  @IsBoolean()
  @IsOptional()
  isLead?: boolean;
}

export class EvaluateJvDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => JvPartnerDto)
  partners: JvPartnerDto[];
}

// ---------- Audited annual turnover ----------
export class AnnualTurnoverItemDto {
  @IsString()
  @Matches(/^\d{4}\/\d{2}$/, { message: 'fiscalYear must look like 2081/82' })
  fiscalYear: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsIn(['audited', 'provisional'])
  @IsOptional()
  source?: string;
}

export class ReplaceTurnoversDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AnnualTurnoverItemDto)
  items: AnnualTurnoverItemDto[];
}
