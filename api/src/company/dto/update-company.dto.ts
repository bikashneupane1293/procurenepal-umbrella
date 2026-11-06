import { PartialType } from '@nestjs/swagger';
import { CreateCompanyDto } from './create-company.dto';

// Every field optional — send only what changes
export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}
