import { requestInfo } from "rwsdk/worker";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const nonce = requestInfo.rw?.nonce;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Pages hoist their own <title> (React 19 document metadata). */}
        <link rel="stylesheet" href="/styles.css" />
        <link rel="modulepreload" href="/src/client.tsx" />
      </head>
      <body>
        {children}
        <script nonce={nonce}>import("/src/client.tsx")</script>
      </body>
    </html>
  );
};
