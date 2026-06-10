import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // The middleware API: a root middleware preloads the graph and wraps both the
  // loaders and the document render in one `scope.run(...)` (the loader→render
  // handoff). Flag-gated in v7, default in v8.
  future: { v8_middleware: true },
} satisfies Config;
