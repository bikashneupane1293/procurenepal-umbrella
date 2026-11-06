import { PartialType } from '@nestjs/swagger';
import { CreateTenderDto } from './create-tender.dto';

// Every field optional — send only what changes
export class UpdateTenderDto extends PartialType(CreateTenderDto) {}
