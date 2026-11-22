import type { INestApplication, INestMicroservice } from '@nestjs/common';
import { type MicroserviceOptions, NestMicroservice } from '@nestjs/microservices';
import type { JetStreamServerOptions } from '../interfaces/jetstream.options';
import { JetStreamServer } from './jetstream.server';
import { RethrowRpcExceptionFilter } from './rethrow-rpc-exception.filter';

/**
 * The one way an app connects the JetStream transport. `inheritAppConfig` stays off: HTTP guards,
 * filters and interceptors read a request that an event delivery does not have.
 */
export function connectJetStreamMicroservice(
  app: INestApplication,
  options: JetStreamServerOptions,
): INestMicroservice {
  // Without deferInitialization Nest builds every handler's exception chain inside
  // connectMicroservice, before a global filter can be added, and the filter is silently ignored.
  const microservice = app.connectMicroservice<MicroserviceOptions>(
    { strategy: new JetStreamServer(options) },
    { inheritAppConfig: false, deferInitialization: true },
  );
  if (!(microservice instanceof NestMicroservice)) {
    throw new Error('connectMicroservice did not return a NestMicroservice');
  }
  microservice.useGlobalFilters(new RethrowRpcExceptionFilter());
  // The rest of Nest's non-deferred path; listen() would otherwise re-run every module init hook.
  microservice.registerListeners();
  microservice.setIsInitialized(true);
  microservice.setIsInitHookCalled(true);
  return microservice;
}
