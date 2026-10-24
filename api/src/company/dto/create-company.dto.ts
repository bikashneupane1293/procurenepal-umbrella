import { IsString, IsNotEmpty, IsOptional, IsDateString } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsString()
  @IsOptional()
  panVat?: string;

  @IsString()
  @IsOptional()
  licenseClass?: string;

  @IsDateString()
  @IsOptional()
  licenseExpiry?: string;

  @IsString()
  @IsOptional()
  address?: string;
}
