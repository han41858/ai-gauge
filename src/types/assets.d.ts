// Bundled as text by esbuild (`loader: { '.svg': 'text' }`) and by the test loader.
declare module '*.svg' {
  const source: string;
  export default source;
}
