import { requestInfo } from "rwsdk/worker";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No graph hydration <script> here. @gleanql/vite auto-wraps each route component
  // with <GraphHydrate />, so this request's cache rides the RSC flight stream as a
  // client-component prop — warm on first load AND on every client navigation (the
  // Document shell, unlike the page, is not re-streamed on nav).
  const nonce = requestInfo.rw?.nonce;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Glean · RedwoodSDK</title>
        <link rel="modulepreload" href="/src/client.tsx" />
      </head>
      <body>
        {children}
        <script nonce={nonce}>import("/src/client.tsx")</script>
      </body>
    </html>
  );
};
