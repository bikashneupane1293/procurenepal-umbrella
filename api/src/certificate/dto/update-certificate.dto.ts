import { PartialType } from '@nestjs/swagger';
import { CreateCertificateDto } from './create-certificate.dto';

// Every field optional — send only what changes
export class UpdateCertificateDto extends PartialType(CreateCertificateDto) {}
