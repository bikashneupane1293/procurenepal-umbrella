import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { BID_DECISIONS, BID_STATUSES, SECURITY_TYPES } from '../bid.constants';

export class JvPartnerItemDto {
  @IsString() @IsNotEmpty() companyId: string;
  @IsNumber() @Min(1) @Max(99) share: number;
  @IsBoolean() @IsOptional() isLead?: boolean;
}

export class ChecklistItemDto {
  @IsString() @IsNotEmpty() @MaxLength(60) key: string;
  @IsString() @IsNotEmpty() @MaxLength(200) label: string;
  @IsBoolean() done: boolean;
  @IsString() @IsOptional() @MaxLength(300) note?: string;
}

export class CreateBidDto {
  @IsString() @IsNotEmpty() tenderId: string;
  /** Bidding company (the lead partner for a JV) */
  @IsString() @IsNotEmpty() companyId: string;
  @IsIn(['SINGLE', 'JV']) @IsOptional() bidderType?: string;
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => JvPartnerItemDto) @IsOptional()
  jvPartners?: JvPartnerItemDto[];
  @IsIn(BID_DECISIONS as unknown as string[]) @IsOptional() decision?: string;
  @IsString() @IsOptional() @MaxLength(1000) decisionReason?: string;
  @IsIn(BID_STATUSES as unknown as string[]) @IsOptional() status?: string;
  /** Bid price, excluding VAT */
  @IsNumber() @Min(0) @IsOptional() bidAmount?: number;
  @IsDateString() @IsOptional() submittedAt?: string;
  @IsDateString() @IsOptional() openingDate?: string;
  @IsInt() @Min(1) @Max(500) @IsOptional() rank?: number;
  @IsNumber() @Min(0) @IsOptional() bidSecurityAmount?: number;
  @IsIn(SECURITY_TYPES as unknown as string[]) @IsOptional() bidSecurityType?: string;
  @IsString() @IsOptional() @MaxLength(120) bidSecurityBank?: string;
  @IsString() @IsOptional() @MaxLength(80) bidSecurityRef?: string;
  @IsDateString() @IsOptional() bidSecurityIssueDate?: string;
  @IsDateString() @IsOptional() bidSecurityExpiry?: string;
  @IsDateString() @IsOptional() bidValidityExpiry?: string;
  @IsDateString() @IsOptional() intentionDate?: string;
  @IsDateString() @IsOptional() awardDate?: string;
  @IsDateString() @IsOptional() contractSignDate?: string;
  @IsNumber() @Min(0) @IsOptional() contractAmount?: number;
  @IsNumber() @Min(0) @IsOptional() performanceSecurityAmount?: number;
  @IsDateString() @IsOptional() performanceSecurityExpiry?: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) @IsOptional()
  checklist?: ChecklistItemDto[];
  @IsString() @IsOptional() @MaxLength(2000) notes?: string;
}

/** tenderId / companyId cannot be changed after creation */
export class UpdateBidDto extends PartialType(CreateBidDto) {}
