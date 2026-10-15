// Mirrors esbuild's `loader: { '.svg': 'text' }` for modules imported directly by tests.
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(`
import { readFile } from 'node:fs/promises';
export async function load(url, context, next) {
  if (url.startsWith('file:') && url.endsWith('.svg')) {
    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(await readFile(new URL(url), 'utf8')) + ';' };
  }
  return next(url, context);
}`)}`);
