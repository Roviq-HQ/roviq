import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Connection,
  type Workflow,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  type WorkflowSignalWithStartOptionsWithArgs,
  type WorkflowStartOptions,
} from '@temporalio/client';

/**
 * The app's one Temporal client. The gRPC channel opens on the first call and is reused
 * by every later one, instead of a connection per request.
 */
@Injectable()
export class TemporalClientService implements OnApplicationShutdown {
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

  /**
   * Starts a workflow unless one with the same id was ever started (running or closed).
   * Returns false for that duplicate, so a redelivered event that derives its workflow id
   * from the event starts nothing twice.
   */
  async startWorkflowOnce(workflowType: string, options: WorkflowStartOptions): Promise<boolean> {
    try {
      await this.client.workflow.start(workflowType, {
        ...options,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      });
      return true;
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) return false;
      throw err;
    }
  }

  /** Signals the running workflow with this id, starting it first when none runs. */
  async signalWithStart(
    workflowType: string,
    options: WorkflowSignalWithStartOptionsWithArgs<[unknown]> & { args: unknown[] },
  ): Promise<string> {
    const handle = await this.client.workflow.signalWithStart<Workflow, [unknown]>(
      workflowType,
      options,
    );
    return handle.signaledRunId;
  }

  // After HTTP and the JetStream microservice stopped: their handlers start workflows.
  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
