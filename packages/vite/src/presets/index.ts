import type { FrameworkOption, FrameworkPreset } from "../types.js";
import { rwsdk } from "./rwsdk.js";
import { reactRouter } from "./react-router.js";

export { rwsdk } from "./rwsdk.js";
export { reactRouter, type ReactRouterPresetOptions } from "./react-router.js";

/** Resolve the `framework` option to a concrete preset (a built-in name or a custom object). */
export function resolvePreset(framework: FrameworkOption = "rwsdk"): FrameworkPreset {
  if (framework === "rwsdk") return rwsdk();
  if (framework === "react-router") return reactRouter();
  return framework;
}
