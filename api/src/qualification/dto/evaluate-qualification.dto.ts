import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
} from 'class-validator';

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
}

export class EvaluateQualificationDto {
  @IsString()
  @IsNotEmpty()
  companyId: string;

  @IsOptional()
  requirements?: TenderRequirementsDto;
}
