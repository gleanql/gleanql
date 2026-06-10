import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { IndexPage } from "@/app/pages/IndexPage";
import { GetStartedPage } from "@/app/pages/GetStartedPage";
import { UsagePage } from "@/app/pages/UsagePage";
import { ComparisonPage } from "@/app/pages/ComparisonPage";
import { ArchitecturePage } from "@/app/pages/ArchitecturePage";
import { CorePage } from "@/app/pages/CorePage";
import { CompilerPage } from "@/app/pages/CompilerPage";
import { RuntimePage } from "@/app/pages/RuntimePage";
import { VitePage } from "@/app/pages/VitePage";
import { RwsdkPage } from "@/app/pages/RwsdkPage";
import { ReactRouterPage } from "@/app/pages/ReactRouterPage";
import { CodegenPage } from "@/app/pages/CodegenPage";
import { GoldenCasesPage } from "@/app/pages/GoldenCasesPage";
import { ApiPage } from "@/app/pages/ApiPage";
import { DecisionsPage } from "@/app/pages/DecisionsPage";

export type AppContext = Record<string, never>;

const PAGES = {
  index: IndexPage,
  "get-started": GetStartedPage,
  usage: UsagePage,
  comparison: ComparisonPage,
  architecture: ArchitecturePage,
  core: CorePage,
  compiler: CompilerPage,
  runtime: RuntimePage,
  vite: VitePage,
  rwsdk: RwsdkPage,
  "react-router": ReactRouterPage,
  codegen: CodegenPage,
  "golden-cases": GoldenCasesPage,
  api: ApiPage,
  decisions: DecisionsPage,
} as const;

// Every page answers on BOTH its static-site path (`/usage.html` — historical
// links and the cross-references inside articles) and the clean path (`/usage` —
// what the Cloudflare asset layer redirects `.html` requests to).
export default defineApp([
  render(Document, [
    route("/", IndexPage),
    ...Object.entries(PAGES).flatMap(([name, Page]) => [route(`/${name}`, Page), route(`/${name}.html`, Page)]),
  ]),
]);
