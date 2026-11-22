import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

// Preloaded by the from-source dev servers after `@swc-node/register`. tsc's node16 resolution
// lets a relative `./x.js` name the source `./x.ts` (required in `import()` of CJS files);
// Node's resolver does not, so map it the same way when only the `.ts` file exists.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith('file:') && /^\.\.?\/.*\.js$/.test(specifier)) {
      const tsSpecifier = `${specifier.slice(0, -3)}.ts`;
      const jsPath = fileURLToPath(new URL(specifier, context.parentURL));
      const tsPath = fileURLToPath(new URL(tsSpecifier, context.parentURL));
      if (!existsSync(jsPath) && existsSync(tsPath)) return nextResolve(tsSpecifier, context);
    }
    return nextResolve(specifier, context);
  },
});
