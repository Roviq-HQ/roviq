import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Client,
  Connection,
  defaultGrpcRetryOptions,
  makeGrpcRetryInterceptor,
  type Workflow,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
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
  private closing = false;
  private readonly underWay = new Set<Promise<unknown>>();

  constructor(config: ConfigService) {
    const retry = defaultGrpcRetryOptions();
    this.connection = Connection.lazy({
      address: config.get<string>('TEMPORAL_ADDRESS', 'localhost:7233'),
      // The client's own retries, which stop once the app is shutting down.
      interceptors: [
        makeGrpcRetryInterceptor({
          ...retry,
          retryableDecider: (attempt, status) =>
            !this.closing && retry.retryableDecider(attempt, status),
        }),
      ],
    });
    this.client = new Client({ connection: this.connection });
  }

  /**
   * Runs one client call so that shutdown can wait for it. A call the server does not answer
   * retries on a timer; a retry that fires after the connection closed throws from that timer,
   * where nothing can catch it. Shutdown therefore stops further retries, waits for the calls
   * under way to end, and only then closes.
   */
  private call<T>(fn: () => Promise<T>): Promise<T> {
    const running = fn();
    this.underWay.add(running);
    const done = (): void => {
      this.underWay.delete(running);
    };
    running.then(done, done);
    return running;
  }

  /** Starts a workflow by its registered type name and returns its run id. */
  async startWorkflow(workflowType: string, options: WorkflowStartOptions): Promise<string> {
    const handle = await this.call(() => this.client.workflow.start(workflowType, options));
    return handle.firstExecutionRunId;
  }

  /**
   * Starts a workflow unless one with the same id was ever started (running or closed).
   * Returns false for that duplicate, so a redelivered event that derives its workflow id
   * from the event starts nothing twice.
   */
  async startWorkflowOnce(workflowType: string, options: WorkflowStartOptions): Promise<boolean> {
    try {
      await this.call(() =>
        this.client.workflow.start(workflowType, {
          ...options,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        }),
      );
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
    const handle = await this.call(() =>
      this.client.workflow.signalWithStart<Workflow, [unknown]>(workflowType, options),
    );
    return handle.signaledRunId;
  }

  /**
   * Signals the running workflow with this id. Returns false when no such workflow exists or it
   * has already closed: a late signal is expected (a report after the flow ended), not an error.
   */
  async signal(workflowId: string, signalName: string, args: unknown[]): Promise<boolean> {
    try {
      await this.call(() => this.client.workflow.getHandle(workflowId).signal(signalName, ...args));
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) return false;
      throw err;
    }
  }

  // After HTTP and the JetStream microservice stopped: their handlers start workflows.
  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.underWay]);
    await this.connection.close();
  }
}
