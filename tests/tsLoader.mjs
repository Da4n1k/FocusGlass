import { register } from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const tsModuleUrl = pathToFileURL(require.resolve('typescript')).href;

const hooksSource = `
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from ${JSON.stringify(tsModuleUrl)};

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.mjs') &&
    !specifier.endsWith('.cjs') &&
    !specifier.endsWith('.ts') &&
    !specifier.endsWith('.tsx') &&
    !specifier.endsWith('.json')
  ) {
    const candidateUrl = new URL(specifier + '.ts', context.parentURL);
    if (candidateUrl.protocol === 'file:' && existsSync(fileURLToPath(candidateUrl))) {
      return { url: candidateUrl.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        esModuleInterop: true,
      },
    });
    return {
      format: 'module',
      source: transpiled.outputText,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
`;

register(
  `data:text/javascript;charset=utf-8,${encodeURIComponent(hooksSource)}`,
  import.meta.url
);
