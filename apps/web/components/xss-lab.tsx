"use client";
import { useState } from "react";
const example = `<p>Example business description</p>
<img src="data:image/png,invalid" onerror="document.getElementById('demo-status').textContent='Demo script executed inside the sandbox.'">`;
const framePrefix = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
</head><body><h2 id="demo-status">Demo script has not executed.</h2>`;
export function XssLab() {
  const [source, setSource] = useState(example);
  const [rendered, setRendered] = useState<string | null>(null);
  return (
    <main>
      <h1>LOCAL LAB ONLY — XSS</h1>
      <p>
        This page uses synthetic text and a harmless status-changing script. It
        requires no sign-in, cookies, tokens or business data.
      </p>
      <label htmlFor="xss-source">
        Untrusted business description (synthetic demo input)
      </label>
      <textarea
        id="xss-source"
        rows={6}
        cols={80}
        maxLength={5000}
        value={source}
        onChange={(event) => setSource(event.target.value)}
      />
      <p>
        The image error handler changes the status inside the demo when
        interpreted as HTML.
      </p>
      <button type="button" onClick={() => setRendered(source)}>
        Run comparison
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          setSource(example);
          setRendered(null);
        }}
      >
        Reset demo
      </button>
      <section>
        <h2>INSECURE DEMO — untrusted HTML interpreted by srcDoc</h2>
        <p>
          This intentional HTML sink is contained in an opaque-origin iframe.
          Scripts can run inside it; access to the parent, network requests,
          forms, popups and top navigation are blocked.
        </p>
        {rendered !== null && (
          <iframe
            title="INSECURE DEMO sandbox"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={framePrefix + rendered + "</body></html>"}
          />
        )}
      </section>
      <section>
        <h2>Secure equivalent — React text escaping</h2>
        <p>
          The same input appears literally as text. No HTML parsing or event
          handler execution is needed.
        </p>
        <pre>{rendered ?? "Run the comparison to display the input."}</pre>
      </section>
    </main>
  );
}
