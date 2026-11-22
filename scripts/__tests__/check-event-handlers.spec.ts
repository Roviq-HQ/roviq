import { describe, expect, it } from 'vitest';
import {
  type AppSources,
  checkApp,
  connectsJetStream,
  findHandlerClasses,
  findModuleControllers,
} from '../check-event-handlers';

const HANDLER = `
@Controller()
export class SectionHandler {
  @EventPattern(EVENT_PATTERNS.SECTION.deleted, { durable: 'x' })
  async onDeleted(@Payload() data: unknown) {}
}
export class Plain { run() {} }
`;

const MAIN_CONNECTED = `
const app = await NestFactory.create(AppModule);
connectJetStreamMicroservice(app, opts);
await app.startAllMicroservices();
`;

function app(moduleText: string, mainText: string | null = MAIN_CONNECTED): AppSources {
  return {
    mainPath: 'apps/x/src/main.ts',
    mainText,
    files: [
      { path: 'apps/x/src/section.handler.ts', text: HANDLER },
      { path: 'apps/x/src/section.module.ts', text: moduleText },
    ],
  };
}

describe('findHandlerClasses', () => {
  it('should find a class with an @EventPattern or @MessagePattern method and skip others', () => {
    const text = `${HANDLER}\nclass Rpc { @MessagePattern('a.b') handle() {} }`;

    expect(findHandlerClasses('f.ts', text)).toEqual([
      { className: 'SectionHandler', file: 'f.ts' },
      { className: 'Rpc', file: 'f.ts' },
    ]);
  });
});

describe('findModuleControllers', () => {
  it('should read only the controllers array of @Module', () => {
    const text = `@Module({ imports: [A], controllers: [B, C], providers: [D] }) export class M {}`;

    expect([...findModuleControllers('m.ts', text)]).toEqual(['B', 'C']);
  });
});

describe('connectsJetStream', () => {
  it('should detect the helper call and ignore a mention in a comment', () => {
    expect(connectsJetStream('main.ts', MAIN_CONNECTED)).toBe(true);
    expect(
      connectsJetStream('main.ts', '// connectJetStreamMicroservice(app, opts)\napp.listen(1);'),
    ).toBe(false);
  });

  it('should not accept a bare connectMicroservice call, which skips the error filter', () => {
    expect(
      connectsJetStream(
        'main.ts',
        'app.connectMicroservice({ strategy: new JetStreamServer(opts) });\nawait app.startAllMicroservices();',
      ),
    ).toBe(false);
  });
});

describe('checkApp', () => {
  it('should pass a handler that is a controller of an app with a connected transport', () => {
    expect(checkApp(app('@Module({ controllers: [SectionHandler] }) class M {}'))).toEqual([]);
  });

  it('should fail a handler registered as a provider', () => {
    expect(checkApp(app('@Module({ providers: [SectionHandler] }) class M {}'))).toEqual([
      {
        className: 'SectionHandler',
        file: 'apps/x/src/section.handler.ts',
        reason:
          'is not in any `controllers: [...]` of a module of this app (Nest only scans controllers for message patterns)',
      },
    ]);
  });

  it('should fail when main.ts connects the transport without the helper', () => {
    const violations = checkApp(
      app(
        '@Module({ controllers: [SectionHandler] }) class M {}',
        'app.connectMicroservice({ strategy: new JetStreamServer(opts) });',
      ),
    );

    expect(violations).toEqual([
      {
        className: 'SectionHandler',
        file: 'apps/x/src/section.handler.ts',
        reason:
          'has message-pattern handlers but apps/x/src/main.ts never calls connectJetStreamMicroservice()',
      },
    ]);
  });

  it('should fail when main.ts connects no microservice', () => {
    const violations = checkApp(
      app('@Module({ controllers: [SectionHandler] }) class M {}', 'await app.listen(3000);'),
    );

    expect(violations).toEqual([
      {
        className: 'SectionHandler',
        file: 'apps/x/src/section.handler.ts',
        reason:
          'has message-pattern handlers but apps/x/src/main.ts never calls connectJetStreamMicroservice()',
      },
    ]);
  });
});
