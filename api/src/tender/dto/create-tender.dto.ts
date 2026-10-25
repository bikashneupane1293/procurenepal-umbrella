import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsArray,
  IsDateString,
  IsIn,
  Min,
} from 'class-validator';

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

  @IsNumber()
  @Min(0)
  @IsOptional()
  boqAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reqTurnover?: number;

  @IsString()
  @IsOptional()
  reqActivity?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  reqProjectTypes?: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  reqMinProduction?: number;

  @IsString()
  @IsOptional()
  source?: string;
}
