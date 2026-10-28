import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { AccountsScreen } from "../components/accounts-screen";
import { LocationScreen } from "../components/location-screen";
import { EmptyState, ErrorState } from "../components/data-states";
import { BffError } from "../lib/bff-client";
import { createQueryClient } from "../lib/query-client";
import { queryKeys } from "../lib/query-keys";
import { isXssLabEnabled } from "../lib/xss-lab";
const hostile = `<img src=x onerror="alert('synthetic-demo')"><script>demo()</script>`;
function assertTextOnly(markup: string) {
  assert.ok(markup.includes("&lt;img"));
  assert.ok(markup.includes("&lt;script&gt;"));
  assert.ok(!markup.includes("<img"));
  assert.ok(!markup.includes("<script"));
}
test("normal account and location screens escape provider-controlled strings", () => {
  const client = createQueryClient();
  client.setQueryData(["google-connections"], {
    enabled: false,
    connections: [],
  });
  client.setQueryData(["google-connections"], {
    enabled: false,
    connections: [],
  });
  client.setQueryData(queryKeys.accounts, [{ id: hostile, name: hostile }]);
  client.setQueryData(queryKeys.me, {
    id: "demo",
    role: "VIEWER",
    permissions: ["location:read"],
  });
  client.setQueryData(queryKeys.location("demo"), {
    id: "demo",
    accountId: hostile,
    name: hostile,
    formattedAddress: hostile,
    status: "OPEN",
    verificationStatus: "VERIFIED",
    websiteUrl: hostile,
    primaryPhone: hostile,
  });
  try {
    for (const element of [
      createElement(AccountsScreen),
      createElement(LocationScreen, { id: "demo" }),
    ]) {
      const markup = renderToStaticMarkup(
        createElement(QueryClientProvider, { client }, element),
      );
      assertTextOnly(markup);
      assert.ok(
        markup.includes("%3Cimg"),
        "untrusted identifiers are encoded in fixed application paths",
      );
    }
    assertTextOnly(
      renderToStaticMarkup(
        createElement(EmptyState, { title: hostile, message: hostile }),
      ),
    );
  } finally {
    client.clear();
  }
});
test("disabled location updates hide the editor even for managers", () => {
  const client = createQueryClient();
  client.setQueryData(queryKeys.me, {
    id: "manager",
    role: "MANAGER",
    permissions: ["location:read", "location:write"],
  });
  client.setQueryData(queryKeys.location("demo"), {
    id: "demo",
    accountId: "account-1",
    name: "Demo",
    formattedAddress: "Address",
    status: "OPEN",
    verificationStatus: "VERIFIED",
    websiteUrl: "https://example.com",
    primaryPhone: null,
  });
  const render = (updatesDisabled: boolean) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LocationScreen, { id: "demo", updatesDisabled }),
      ),
    );
  try {
    assert.ok(render(false).includes('aria-label="Edit Website"'));
    const disabled = render(true);
    assert.ok(!disabled.includes('class="detail-edit"'));
    assert.ok(!disabled.includes("<form"));
    assert.ok(!disabled.includes("Location updates are currently disabled."));
    assert.ok(disabled.includes("https://example.com"));
  } finally {
    client.clear();
  }
});
test("API/provider errors use fixed messages and escape the request ID", () => {
  const error = new BffError(
    {
      code: "INTERNAL_ERROR",
      message: hostile,
      requestId: hostile,
      details: null,
    },
    500,
  );
  const markup = renderToStaticMarkup(createElement(ErrorState, { error }));
  assert.ok(markup.includes("Something went wrong. Please try again."));
  assertTextOnly(markup);
  assert.equal(
    markup.split("&lt;img").length - 1,
    2,
    "escaped request ID appears in its title and visible text; provider message is suppressed",
  );
});
test("XSS route gate is off by default and cannot be enabled in production or for nonlocal hosts", () => {
  assert.equal(
    isXssLabEnabled({ NODE_ENV: "development" }, "localhost:3000"),
    false,
  );
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    assert.equal(
      isXssLabEnabled({ NODE_ENV: "development", LOCAL_LAB: "true" }, host),
      true,
    );
    assert.equal(
      isXssLabEnabled({ NODE_ENV: "production", LOCAL_LAB: "true" }, host),
      false,
    );
  }
  for (const host of [
    "shared.example",
    "localhost.evil.example",
    "",
    "user@localhost",
    "localhost/path",
  ])
    assert.equal(
      isXssLabEnabled({ NODE_ENV: "development", LOCAL_LAB: "true" }, host),
      false,
    );
  assert.equal(isXssLabEnabled({ LOCAL_LAB: "true" }, "localhost"), false);
});
test("unsafe HTML/script sinks are confined to the isolated XSS lab component", () => {
  const web = resolve(import.meta.dirname, "..");
  const sink =
    /dangerouslySetInnerHTML|\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(|\bsrcDoc\s*=/;
  function audit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) audit(path);
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        if (relative(web, path) === "components/xss-lab.tsx") {
          assert.match(source, /sandbox="allow-scripts"/);
          assert.ok(!source.includes("allow-same-origin"));
          assert.match(source, /INSECURE DEMO/);
        } else
          assert.ok(
            !sink.test(source),
            `unsafe sink in ${relative(web, path)}`,
          );
      }
    }
  }
  for (const directory of ["app", "components", "lib"])
    audit(resolve(web, directory));
});
