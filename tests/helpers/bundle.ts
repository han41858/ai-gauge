import { buildSync, type BuildOptions } from 'esbuild';

/** Bundles an entry point with the same asset loaders as scripts/build.mjs. */
export function bundleEntry(entry: string, options: BuildOptions = {}): string {
  return buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'chrome120',
    loader: { '.svg': 'text' }, ...options }).outputFiles![0]!.text;
}
