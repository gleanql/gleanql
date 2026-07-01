import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeSources } from "../src/provision.js";

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A published-style package: resolves `"."` → dist, and ships pristine `src/*.ts`. */
function pristinePkg(dir: string, name: string, version: string): void {
  write(path.join(dir, "package.json"), JSON.stringify({ name, version, type: "module", exports: { ".": "./dist/index.js" } }));
  write(path.join(dir, "dist", "index.js"), "export const _ = 1;\n");
  write(path.join(dir, "src", "index.ts"), `export const VERSION = ${JSON.stringify(version)};\n`);
}

/** The self-provisioned shadow we write into `node_modules/@gleanql/*`: transpiled
 * `.js` only, NO `.ts` sources — the thing that must NOT be provisioned FROM. */
function shadowPkg(dir: string, name: string): void {
  write(path.join(dir, "package.json"), JSON.stringify({ name, type: "module", main: "./index.js" }));
  write(path.join(dir, "index.js"), 'export * from "./src/index.js";\n');
  write(path.join(dir, "src", "index.js"), "export const _ = 1;\n");
}

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe("resolveRuntimeSources — pristine source over the self-provisioned shadow", () => {
  it("provisions from the upgraded pristine copy via the host, not the stale shadow/stash", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glean-provision-"));
    const app = path.join(tmp, "app");
    const nm = path.join(app, "node_modules");

    // The app depends on a host framework; @gleanql/client is transitive (the
    // ShopLayer shape). It does NOT declare @gleanql/client itself.
    write(path.join(app, "package.json"), JSON.stringify({ name: "app", dependencies: { "host-fw": "*" } }));

    // SHADOW: what a previous build self-provisioned into the app's node_modules —
    // this is what app-level resolution of @gleanql/client lands on (it shadows the
    // real package). It has no `.ts`, so it must be skipped.
    shadowPkg(path.join(nm, "@gleanql", "client"), "@gleanql/client");
    shadowPkg(path.join(nm, "@gleanql", "core"), "@gleanql/core");

    // A STALE stash from before the upgrade (0.1.13). The pre-fix code fell back to
    // "newest stash by mtime" and would pick this.
    write(path.join(nm, ".glean", "@gleanql+client@0.1.13", "src", "index.ts"), 'export const VERSION = "0.1.13";\n');

    // The host framework, carrying the PRISTINE upgraded runtime (0.1.16) as its
    // transitive dep — the copy an in-place upgrade actually installed.
    write(
      path.join(nm, "host-fw", "package.json"),
      JSON.stringify({ name: "host-fw", type: "module", main: "./index.js", dependencies: { "@gleanql/client": "*" } }),
    );
    write(path.join(nm, "host-fw", "index.js"), "export const _ = 1;\n");
    pristinePkg(path.join(nm, "host-fw", "node_modules", "@gleanql", "client"), "@gleanql/client", "0.1.16");
    pristinePkg(path.join(nm, "host-fw", "node_modules", "@gleanql", "core"), "@gleanql/core", "0.1.16");

    const sources = resolveRuntimeSources(app, "host-fw");

    expect(sources.mode).toBe("installed");
    // The resolved client source is the PRISTINE 0.1.16 (stashed under its own
    // version), NOT the 0.1.13 stale stash the shadow would have led to.
    expect(fs.readFileSync(path.join(sources.client, "index.ts"), "utf8")).toContain('"0.1.16"');
    expect(fs.readFileSync(path.join(sources.core, "index.ts"), "utf8")).toContain('"0.1.16"');
    // A fresh version-keyed stash for the upgraded version exists.
    expect(fs.existsSync(path.join(nm, ".glean", "@gleanql+client@0.1.16", "src", "index.ts"))).toBe(true);
  });
});
