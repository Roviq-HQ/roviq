import { ObjectType } from '@nestjs/graphql';
import { Paginated } from '@roviq/nestjs-graphql';
import { AuditLog } from './audit-log.model';

@ObjectType()
export class AuditLogConnection extends Paginated(AuditLog) {}
