import { requestInfo } from "rwsdk/worker";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // No hydration <script> needed: @gleanql/vite auto-wraps each route with the
  // hydration boundary, so this request's cache rides the RSC flight stream.
  const nonce = requestInfo.rw?.nonce;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GleanQL starter</title>
        <link rel="modulepreload" href="/src/client.tsx" />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "3rem auto", padding: "0 1rem" }}>
        {children}
        <script nonce={nonce}>import("/src/client.tsx")</script>
      </body>
    </html>
  );
};
