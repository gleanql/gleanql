import { requestInfo } from "rwsdk/worker";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No hydration <script> here. @gleanql/vite auto-wraps each route component with
  // <GraphHydrate />, so this request's cache rides the RSC flight stream as a
  // client-component prop — warm on first load and on every client navigation.
  const nonce = requestInfo.rw?.nonce;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Glean · Todo (RedwoodSDK)</title>
        <link rel="modulepreload" href="/src/client.tsx" />
        <style nonce={nonce}>{STYLES}</style>
      </head>
      <body>
        {children}
        <script nonce={nonce}>import("/src/client.tsx")</script>
      </body>
    </html>
  );
};

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f4f4f5; color: #18181b; }
  @media (prefers-color-scheme: dark) { body { background: #18181b; color: #fafafa; } .app { background: #27272a !important; } .row, .add { border-color: #3f3f46 !important; } .muted { color: #a1a1aa !important; } }
  .wrap { max-width: 520px; margin: 3rem auto; padding: 0 1rem; }
  h1 { text-align: center; font-weight: 200; font-size: 3rem; color: #d4456b; margin: 0 0 1rem; }
  .app { background: #fff; border-radius: 10px; box-shadow: 0 2px 16px rgba(0,0,0,.08); overflow: hidden; }
  .add { display: flex; border-bottom: 1px solid #e4e4e7; }
  .add input { flex: 1; border: 0; background: transparent; padding: 1rem 1.25rem; font-size: 1.1rem; color: inherit; outline: none; }
  .row { display: flex; align-items: center; gap: .75rem; padding: .85rem 1.25rem; border-bottom: 1px solid #e4e4e7; }
  .row input[type=checkbox] { width: 1.25rem; height: 1.25rem; accent-color: #d4456b; }
  .row .title { flex: 1; font-size: 1.05rem; }
  .row.done .title { text-decoration: line-through; color: #a1a1aa; }
  .row .x { border: 0; background: transparent; color: #c4c4c8; font-size: 1.3rem; cursor: pointer; line-height: 1; }
  .row .x:hover { color: #d4456b; }
  .foot { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1.25rem; font-size: .85rem; }
  .muted { color: #71717a; }
  .filters { display: flex; gap: .4rem; }
  .filters button { border: 1px solid transparent; border-radius: 5px; background: transparent; padding: .15rem .5rem; cursor: pointer; color: inherit; font-size: .85rem; }
  .filters button.on { border-color: #d4456b; }
  .link { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: .85rem; }
  .link:hover { text-decoration: underline; }
  .empty { padding: 2rem; text-align: center; color: #a1a1aa; }
`;
