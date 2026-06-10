import { requestInfo } from "rwsdk/worker";

// Set the theme BEFORE first paint (no flash), from localStorage or the OS.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("glean-theme");if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})()`;

// One delegated listener powers every code block's copy button.
const COPY_SCRIPT = `document.addEventListener("click",function(e){var b=e.target&&e.target.closest&&e.target.closest(".code-copy");if(!b)return;var w=b.closest(".codeblock");var pre=w&&w.querySelector("pre");if(!pre)return;navigator.clipboard.writeText(pre.innerText).then(function(){b.textContent="copied";b.classList.add("copied");setTimeout(function(){b.textContent="copy";b.classList.remove("copied")},1600)})})`;

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const nonce = requestInfo.rw?.nonce;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Pages hoist their own <title> (React 19 document metadata). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Instrument+Sans:ital,wght@0,400..650;1,400..650&family=Fragment+Mono:ital@0;1&display=swap"
        />
        <link rel="stylesheet" href="/styles.css" />
        <link rel="modulepreload" href="/src/client.tsx" />
      </head>
      <body>
        {children}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
        <script nonce={nonce}>import("/src/client.tsx")</script>
      </body>
    </html>
  );
};
