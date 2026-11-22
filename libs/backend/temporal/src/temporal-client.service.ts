import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection, type WorkflowStartOptions } from '@temporalio/client';

/**
 * The gateway's one Temporal client. The gRPC channel opens on the first call and is reused
 * by every later one, instead of a connection per request.
 */
@Injectable()
export class TemporalClientService implements OnModuleDestroy {
  private readonly connection: Connection;
  private readonly client: Client;

  constructor(config: ConfigService) {
    this.connection = Connection.lazy({
      address: config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233'),
    });
    this.client = new Client({ connection: this.connection });
  }

  /** Starts a workflow by its registered type name and returns its run id. */
  async startWorkflow(workflowType: string, options: WorkflowStartOptions): Promise<string> {
    const handle = await this.client.workflow.start(workflowType, options);
    return handle.firstExecutionRunId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
