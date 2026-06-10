// Permissive JSX typing so the example app compiles without pulling in React
// types. The compiler analyzes the .tsx structurally + via the schema; it does
// not require a real JSX runtime.
declare namespace JSX {
  type Element = unknown;
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
