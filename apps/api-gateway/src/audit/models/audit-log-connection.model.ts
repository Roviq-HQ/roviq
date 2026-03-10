import { ObjectType } from '@nestjs/graphql';
import { Paginated } from '../../common/pagination';
import { AuditLog } from './audit-log.model';

@ObjectType()
export class AuditLogConnection extends Paginated(AuditLog) {}
