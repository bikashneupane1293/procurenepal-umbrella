import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  IsDateString,
  IsBoolean,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// One row of the Key Activities table
export class KeyActivityDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsString()
  @IsNotEmpty()
  fiscalYear: string;

  @IsNumber()
  @Min(0)
  quantity: number;
}

export class CreateCertificateDto {
  @IsString()
  @IsNotEmpty()
  projectName: string;

  @IsString()
  @IsOptional()
  certificateId?: string;

  @IsString()
  @IsOptional()
  employerName?: string;

  @IsNumber()
  @Min(0)
  contractAmount: number;

  @IsNumber()
  @IsOptional()
  finalAmount?: number;

  @IsNumber()
  @IsOptional()
  priceAdjustment?: number;

  @IsString()
  @IsNotEmpty()
  fiscalYear: string;

  @IsString()
  @IsIn(['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE'])
  projectType: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  activities?: string[];

  @IsString()
  @IsOptional()
  @IsIn(['unverified', 'verified'])
  verificationStatus?: string;

  @IsString()
  @IsOptional()
  @IsIn(['in_progress', 'completed', 'substantially_completed'])
  completionStatus?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  jvShare?: number;

  @IsString()
  @IsOptional()
  jvName?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  completionDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyActivityDto)
  @IsOptional()
  keyActivities?: KeyActivityDto[];

  @IsString()
  @IsOptional()
  pdfUrl?: string;

  /** Running contracts only: value of work still to be done (excl. VAT) — used for FIN-5 / bid capacity */
  @IsNumber()
  @Min(0)
  @IsOptional()
  outstandingAmount?: number;

  /** Running contracts only: false = excluded from the five-contract limit (e.g. not an open-bid contract) */
  @IsBoolean()
  @IsOptional()
  isOpenBid?: boolean;
}
