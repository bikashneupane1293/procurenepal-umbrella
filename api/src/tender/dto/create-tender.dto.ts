import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsBoolean,
  Min,
  Max,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// One required key activity, e.g. Asphalt concrete — m3 — 1200 (in a single fiscal year)
export class TenderKeyActivityDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  @Min(0)
  quantity: number;
}

// Optional overrides of the default PPMO rule values for this tender
export class TenderCriteriaDto {
  @IsNumber() @Min(0) @Max(10) @IsOptional() turnoverMultiplier?: number;
  @IsInt() @Min(1) @Max(10) @IsOptional() turnoverBestYears?: number;
  @IsIn(['AVAILABLE_YEARS', 'FIXED']) @IsOptional() turnoverDivisor?: string;
  @IsInt() @Min(1) @Max(20) @IsOptional() lookbackYears?: number;
  @IsNumber() @Min(0) @Max(200) @IsOptional() similarContractPercent?: number;
  @IsInt() @Min(1) @Max(10) @IsOptional() similarContractCount?: number;
  @IsBoolean() @IsOptional() applyJvShareToSimilar?: boolean;
  @IsNumber() @Min(0) @Max(20) @IsOptional() bidCapacityMultiplier?: number;
  @IsNumber() @Min(0) @Max(200) @IsOptional() bidCapacityPercent?: number;
  @IsInt() @Min(1) @Max(50) @IsOptional() maxRunningContracts?: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() jvMinEachPercent?: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() jvMinLeadPercent?: number;
  @IsInt() @Min(2) @Max(5) @IsOptional() jvMaxPartners?: number;
  @IsIn(['ONE_PARTNER', 'EACH_AND_ONE']) @IsOptional() jvSimilarRule?: string;
  @IsIn(['COMBINED', 'ONE_PARTNER']) @IsOptional() jvKeyActivityRule?: string;
  @IsBoolean() @IsOptional() countUnverified?: boolean;
  @IsIn(['AVERAGE', 'LOWEST']) @IsOptional() awardMethod?: string;
  @IsNumber() @Min(0) @Max(100) @IsOptional() floorPercentBelowEstimate?: number;
}

export class CreateTenderDto {
  @IsString()
  @IsNotEmpty()
  ifbNumber: string;

  @IsString()
  @IsNotEmpty()
  projectTitle: string;

  @IsString()
  @IsOptional()
  procuringEntity?: string;

  @IsDateString()
  @IsOptional()
  publicationDate?: string;

  @IsDateString()
  @IsNotEmpty()
  deadlineDate: string;

  @IsString()
  @IsIn(['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE'])
  @IsOptional()
  projectType?: string;

  /** Cost estimate (V), excluding VAT */
  @IsNumber()
  @Min(0)
  @IsOptional()
  boqAmount?: number;

  /** Contract period (T) in months */
  @IsInt()
  @Min(1)
  @Max(240)
  @IsOptional()
  contractPeriodMonths?: number;

  /** Required average annual turnover as stated in the IFB (leave empty to calculate) */
  @IsNumber()
  @Min(0)
  @IsOptional()
  reqTurnover?: number;

  /** Required bid capacity as stated in the IFB (leave empty to calculate) */
  @IsNumber()
  @Min(0)
  @IsOptional()
  reqBidCapacity?: number;

  /** Required value of one similar contract as stated in the IFB (leave empty to calculate) */
  @IsNumber()
  @Min(0)
  @IsOptional()
  reqSimilarValue?: number;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  reqSimilarCount?: number;

  @IsString()
  @IsOptional()
  similarDescription?: string;

  /** Project types accepted as "similar" (empty = same as projectType) */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  reqProjectTypes?: string[];

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TenderKeyActivityDto)
  @IsOptional()
  keyActivityReqs?: TenderKeyActivityDto[];

  /** Legacy value-based key activity */
  @IsString()
  @IsOptional()
  reqActivity?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reqMinProduction?: number;

  @ValidateNested()
  @Type(() => TenderCriteriaDto)
  @IsOptional()
  criteria?: TenderCriteriaDto;

  @IsBoolean()
  @IsOptional()
  isComplexWork?: boolean;

  @IsIn(['AVERAGE', 'LOWEST'])
  @IsOptional()
  awardMethod?: string;

  @IsIn(['PPMO-LEGACY', 'PPMO-2083-INTERIM', 'PPMO-2083-ACT'])
  @IsOptional()
  ruleSetId?: string;

  @IsIn(['active', 'submitted', 'won', 'lost', 'cancelled', 'archived'])
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  /** Bid security amount stated in the IFB (NPR) — copied to new bid records */
  @IsNumber()
  @Min(0)
  @IsOptional()
  bidSecurityAmount?: number;

  /** Bid validity in days from the deadline (e.g. 90) — sets the bid validity expiry of new bid records */
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  bidValidityDays?: number;

  @IsString()
  @IsOptional()
  source?: string;
}
