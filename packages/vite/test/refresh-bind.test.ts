import { describe, it, expect } from "vitest";
import { bindComponentRefresh } from "../src/refresh-bind.js";

describe("bindComponentRefresh (bare refresh() → component-bound)", () => {
  it("binds a zero-arg refresh() to its enclosing function component", () => {
    const out = bindComponentRefresh(
      `import { useGlean, refresh } from "@gleanql/client/client";\n` +
        `export function RefreshViews() {\n  return <button onClick={() => refresh()} />;\n}\n`,
      "RefreshViews.tsx",
    );
    expect(out).toContain('refresh({ component: "RefreshViews" })');
  });

  it("binds inside an arrow-function component too", () => {
    const out = bindComponentRefresh(
      `import { refresh } from "@gleanql/client/client";\n` +
        `export const Views = () => { void refresh(); return null; };\n`,
      "Views.tsx",
    );
    expect(out).toContain('refresh({ component: "Views" })');
  });

  it("honors an aliased import", () => {
    const out = bindComponentRefresh(
      `import { refresh as r } from "@gleanql/client/client";\n` +
        `function Card() { return <a onClick={() => r()} />; }\n`,
      "Card.tsx",
    );
    expect(out).toContain('r({ component: "Card" })');
  });

  it("leaves refresh(...) calls that already have args alone", () => {
    const code =
      `import { refresh } from "@gleanql/client/client";\n` +
      `function C() { return <a onClick={() => refresh("Other")} />; }\n`;
    expect(bindComponentRefresh(code, "C.tsx")).toBeNull();
  });

  it("ignores refresh() outside any named component, and files without the import", () => {
    expect(bindComponentRefresh(`import { refresh } from "@gleanql/client/client";\nrefresh();\n`, "top.tsx")).toBeNull();
    expect(bindComponentRefresh(`function C(){ refresh(); }`, "C.tsx")).toBeNull(); // not imported from the glue
  });
});
