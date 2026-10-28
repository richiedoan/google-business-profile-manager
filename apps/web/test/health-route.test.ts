import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/health/route";

test("health uses the runtime binding without forwarding browser credentials and sanitizes failures", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: URL, init?: RequestInit) => {
    assert.equal(url.href, "https://internal.example/service/health");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.headers, undefined);
    return Response.json({ status: "ok" });
  });
  const previous = process.env.API_URL;
  try {
    process.env.API_URL = "https://internal.example/service";
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ok" });
    delete process.env.API_URL;
    const missing = await GET();
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { status: "unavailable" });
    process.env.API_URL = "https://internal.example/service/";
    t.mock.method(globalThis, "fetch", async () => {
      throw new Error("sensitive upstream details");
    });
    const failed = await GET();
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { status: "unavailable" });
  } finally {
    if (previous === undefined) delete process.env.API_URL;
    else process.env.API_URL = previous;
  }
});
