declare module "*?url" {
  const result: string;
  export default result;
}

declare module "*.md?raw" {
  const source: string;
  export default source;
}

interface ImportMeta {
  glob(pattern: string, options?: { query?: string; import?: string; eager?: boolean }): Record<string, unknown>;
}
