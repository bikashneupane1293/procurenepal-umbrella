import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CertificateItem {
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @IsString()
  @IsNotEmpty()
  fiscalYear: string;
}

export class CalculateTurnoverDto {
  @IsArray()
  @IsNotEmpty()
  certificates: CertificateItem[];

  @IsNumber()
  @IsOptional()
  companyId?: number; // If we want to save it to a company
}
