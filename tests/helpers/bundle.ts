import { buildSync, type BuildOptions } from 'esbuild';
const { i18nFixtureSource } = await import(new URL('../../scripts/i18n-fixture.mjs', import.meta.url).href) as {
  i18nFixtureSource(language?: string): string;
};

/** Bundles an entry point with the same asset loaders as scripts/build.mjs. */
export function bundleEntry(entry: string, options: BuildOptions = {}): string {
  const bundle = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'iife', target: 'chrome120',
    loader: { '.svg': 'text' }, ...options }).outputFiles![0]!.text;
  return `globalThis.chrome ??= {}; globalThis.chrome.i18n ??= ${i18nFixtureSource()};\n${bundle}`;
}
