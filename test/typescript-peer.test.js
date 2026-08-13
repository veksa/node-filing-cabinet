import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { fixtures } from './helpers.js';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = fixtures('ts');

/**
 * Resolves a partial in a child process, with `typescript` either hidden or replaced by a
 * stub that carries a version but none of the compiler API, the way TypeScript 7 behaves.
 *
 * @param {{ hideTypeScript?: boolean, typeScriptVersion?: string }} options
 * @returns {string}
 */
function resolveInChildProcess(options) {
  const preamble = options.hideTypeScript ?
    `Module._resolveFilename = function(request, ...rest) {
       if (request === 'typescript') {
         throw Object.assign(new Error("Cannot find module 'typescript'"), { code: 'MODULE_NOT_FOUND' });
       }

       return originalResolve.call(this, request, ...rest);
     };` :
    `Module._load = function(request, ...rest) {
       if (request === 'typescript') return { version: '${options.typeScriptVersion}' };
       return originalLoad.call(this, request, ...rest);
     };`;

  const source = `
    import Module from 'node:module';
    const originalResolve = Module._resolveFilename;
    const originalLoad = Module._load;
    ${preamble}

    const { default: cabinet } = await import('./index.js');

    try {
      cabinet({
        partial: './foo',
        filename: ${JSON.stringify(path.join(directory, 'index.ts'))},
        directory: ${JSON.stringify(directory)}
      });
      console.log('no-error');
    } catch (error) {
      console.log(JSON.stringify({ code: error.code, message: error.message, cause: error.cause?.message }));
    }
  `;

  return execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: rootDir,
    encoding: 'utf8'
  }).trim();
}

describe('typescript peer dependency', () => {
  it('throws an actionable error when typescript is not installed', () => {
    const error = JSON.parse(resolveInChildProcess({ hideTypeScript: true }));

    expect(error.code).toBe('ERR_TYPESCRIPT_UNAVAILABLE');
    expect(error.message).toContain('requires the "typescript" peer dependency');
  });

  it('rewrites the failure when the installed typescript has no compiler API', () => {
    const error = JSON.parse(resolveInChildProcess({ typeScriptVersion: '7.0.2' }));

    expect(error.code).toBe('ERR_TYPESCRIPT_UNAVAILABLE');
    expect(error.message).toContain('typescript@7.0.2 does not provide the compiler API');
    expect(error.message).toContain('createCompilerHost');
    expect(error.cause).toContain('createCompilerHost');
  });
});
