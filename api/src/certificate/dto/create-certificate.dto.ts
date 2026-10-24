import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsIn,
  Min,
  Max,
} from 'class-validator';

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
  pdfUrl?: string;
}
