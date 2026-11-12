import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { MAX_BOQ_ITEMS, PROJECT_STATUSES } from '../project.constants';

export class CreateProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(64) companyId!: string;
  @IsOptional() @IsString() @MaxLength(64) tenderId?: string | null;
  /** blank = next free code (P-001, P-002 …) */
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsString() @IsNotEmpty() @MaxLength(300) name!: string;
  @IsOptional() @IsString() @MaxLength(200) client?: string | null;
  @IsOptional() @IsString() @MaxLength(200) location?: string | null;
  @IsOptional() @IsString() @MaxLength(80) contractNo?: string | null;
  @IsOptional() @IsString() @MaxLength(40) projectType?: string | null;
  @IsOptional() @IsNumber() @Min(0) contractAmount?: number | null;
  @IsOptional() @IsDateString() contractSignDate?: string | null;
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(240) contractPeriodMonths?: number | null;
  @IsOptional() @IsDateString() intendedCompletionDate?: string | null;
  @IsOptional() @IsDateString() revisedCompletionDate?: string | null;
  @IsOptional() @IsDateString() actualCompletionDate?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) defectLiabilityMonths?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) advancePct?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(100) retentionPct?: number | null;
  @IsOptional() @IsString() @MaxLength(120) projectManager?: string | null;
  @IsOptional() @IsString() @MaxLength(120) clientEngineer?: string | null;
  @IsOptional() @IsIn(PROJECT_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class BoqItemDto {
  @IsOptional() @IsString() @MaxLength(40) itemNo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) section?: string | null;
  @IsString() @IsNotEmpty() @MaxLength(4000) description!: string;
  @IsOptional() @IsString() @MaxLength(30) unit?: string | null;
  @IsOptional() @IsNumber() @Min(0) quantity?: number | null;
  @IsOptional() @IsNumber() @Min(0) rate?: number | null;
  @IsOptional() @IsNumber() @Min(0) amount?: number | null;
  @IsOptional() @IsBoolean() isHeading?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}
export class SaveBoqDto {
  @IsArray() @ArrayMaxSize(MAX_BOQ_ITEMS) @ValidateNested({ each: true }) @Type(() => BoqItemDto) items!: BoqItemDto[];
  /** replace = the uploaded list becomes the BOQ; append = added after the existing lines */
  @IsOptional() @IsIn(['replace', 'append']) mode?: 'replace' | 'append';
}
