import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessException, ErrorCode } from '@roviq/common-types';

const FONT_DIR = join(__dirname, '..', 'assets', 'fonts');

/** Font families the templates may name, in fallback order; one bundled font file each. */
export const PDF_FONT_FAMILIES = ['Noto Sans', 'Noto Sans Devanagari'] as const;

// Typst draws a box for a glyph no font has and reports nothing, so text in a script
// without a bundled font is refused before rendering.
const RENDERABLE_TEXT =
  /^[\p{Script=Latin}\p{Script=Devanagari}\p{Script=Common}\p{Script=Inherited}]*$/u;

export type PdfData = { readonly [key: string]: PdfValue };
type PdfValue = string | number | boolean | null | readonly PdfValue[] | PdfData;

export interface PdfRenderInput {
  /** Typst source owned by this codebase. It reads its values with `json("/data.json")`. */
  template: string;
  /** Values only: they reach the template as JSON, never as Typst source. */
  data: PdfData;
  /** Binary files the template may load, by absolute Typst path (e.g. `/qr.svg`). */
  files?: Readonly<Record<string, Buffer>>;
}

function assertRenderable(value: PdfValue, path: string): void {
  if (typeof value === 'string') {
    if (!RENDERABLE_TEXT.test(value)) {
      throw new BusinessException(
        ErrorCode.PDF_UNSUPPORTED_SCRIPT,
        `"${path}" uses a script the PDF fonts do not cover`,
      );
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertRenderable(item, `${path}[${index}]`);
    });
    return;
  }
  for (const [key, item] of Object.entries(value)) assertRenderable(item, `${path}.${key}`);
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly workspace = mkdtempSync(join(tmpdir(), 'roviq-pdf-'));
  private compiler: NodeCompiler | null = null;

  /** Throws PDF_UNSUPPORTED_SCRIPT when a value uses a script no bundled font covers. */
  assertRenderable(data: PdfData): void {
    assertRenderable(data, 'data');
  }

  /** Renders one PDF. Synchronous in the compiler, so shadow files of two renders never mix. */
  render(input: PdfRenderInput): Buffer {
    assertRenderable(input.data, 'data');
    const compiler = this.getCompiler();
    const shadows: Record<string, Buffer> = {
      '/data.json': Buffer.from(JSON.stringify(input.data)),
      ...input.files,
    };
    const mapped = Object.keys(shadows).map((path) => join(this.workspace, path));
    try {
      for (const [path, body] of Object.entries(shadows)) {
        compiler.mapShadow(join(this.workspace, path), body);
      }
      const compiled = compiler.compile({ mainFileContent: input.template });
      const errors = compiled.takeDiagnostics();
      if (errors || !compiled.result) {
        this.logger.error(`Typst compile failed: ${JSON.stringify(errors?.shortDiagnostics)}`);
        throw new Error('PDF template failed to compile');
      }
      return compiler.pdf(compiled.result);
    } finally {
      for (const path of mapped) compiler.unmapShadow(path);
      // Keeps the compiler's memory flat across many one-off documents.
      compiler.evictCache(10);
    }
  }

  private getCompiler(): NodeCompiler {
    this.compiler ??= NodeCompiler.create({
      workspace: this.workspace,
      fontArgs: [{ fontPaths: [FONT_DIR] }],
    });
    return this.compiler;
  }
}
