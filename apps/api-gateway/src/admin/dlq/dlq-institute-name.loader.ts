import { Injectable, Scope } from '@nestjs/common';
import type { I18nContent } from '@roviq/database';
import DataLoader from 'dataloader';
import { DlqService } from '../../dlq/dlq.service';

/** Institute names for one page of dead-lettered messages: one query per request. */
@Injectable({ scope: Scope.REQUEST })
export class DlqInstituteNameLoader {
  readonly byId = new DataLoader<string, I18nContent | null>(async (ids) => {
    const names = await this.dlq.instituteNames([...new Set(ids)]);
    return ids.map((id) => names.get(id) ?? null);
  });

  constructor(private readonly dlq: DlqService) {}
}
