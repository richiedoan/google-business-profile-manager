import { authFailure } from "../lib/auth";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BffError,
  createBffClient,
  decodeHealth,
  decodeUser,
} from "../lib/bff-client";
import { queryKeys } from "../lib/query-keys";
import { createQueryClient } from "../lib/query-client";
test("BFF sends credentials, forwards cancellation, and decodes success", async () => {
  const controller = new AbortController();
  const client = createBffClient("http://localhost:3001", async (url, init) => {
    assert.equal(String(url), "http://localhost:3001/health");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.redirect, "error");
    return Response.json({ status: "ok" });
  });
  assert.deepEqual(
    await client.get("/health", decodeHealth, controller.signal),
    { status: "ok" },
  );
  for (const path of [
    "https://untrusted.example",
    "//untrusted.example",
    "/\\untrusted.example",
  ])
    await assert.rejects(client.get(path, decodeHealth));
});
test("normalized domain errors survive transport consistently", async () => {
  const body = {
    code: "SESSION_EXPIRED",
    message: "Your session has expired.",
    requestId: "request-1",
    details: null,
  };
  const client = createBffClient("http://localhost:3001", async () =>
    Response.json(body, { status: 401 }),
  );
  await assert.rejects(client.get("/me", decodeHealth), (error: unknown) => {
    assert.ok(error instanceof BffError);
    assert.equal(error.status, 401);
    assert.deepEqual(error.apiError, body);
    return true;
  });
});
test("malformed responses, invalid success data, and network errors suppress raw contents", async () => {
  for (const response of [
    new Response("SECRET STACK", {
      status: 502,
      headers: { "X-Request-Id": "request-2" },
    }),
    Response.json({ message: "SECRET STACK" }, { status: 500 }),
    Response.json({ status: "SECRET STACK" }),
  ]) {
    const client = createBffClient(
      "http://localhost:3001",
      async () => response,
    );
    await assert.rejects(
      client.get("/health", decodeHealth),
      (error: unknown) => {
        assert.ok(error instanceof BffError);
        assert.equal(error.apiError.code, "INTERNAL_ERROR");
        assert.ok(!error.message.includes("SECRET"));
        return true;
      },
    );
  }
  const client = createBffClient("http://localhost:3001", async () => {
    throw new Error("SECRET NETWORK");
  });
  await assert.rejects(
    client.get("/health", decodeHealth),
    (error: unknown) =>
      error instanceof BffError &&
      error.status === 0 &&
      !error.message.includes("SECRET"),
  );
});
test("cancellation remains cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = new DOMException("Aborted", "AbortError");
  const client = createBffClient("http://localhost:3001", async () => {
    throw aborted;
  });
  await assert.rejects(
    client.get("/health", decodeHealth, controller.signal),
    (error) => error === aborted,
  );
});
test("query keys snapshot all location filters without capturing UI state", () => {
  const input = {
    page: 1,
    pageSize: 25,
    search: "shop",
    status: "OPEN" as const,
  };
  const key = queryKeys.locations("account-1", input);
  input.page = 2;
  assert.deepEqual(key, [
    "locations",
    "account-1",
    { page: 1, pageSize: 25, search: "shop", status: "OPEN" },
  ]);
  assert.deepEqual(queryKeys.me, ["me"]);
  assert.deepEqual(queryKeys.accounts, ["accounts"]);
  assert.deepEqual(queryKeys.location("location-1"), [
    "location",
    "location-1",
  ]);
});
test("query clients are isolated and do not retry client/auth failures", async () => {
  const first = createQueryClient();
  const second = createQueryClient();
  first.setQueryData(queryKeys.me, { id: "first-user" });
  assert.equal(second.getQueryData(queryKeys.me), undefined);
  let calls = 0;
  try {
    await assert.rejects(
      first.fetchQuery({
        queryKey: ["unauthorized"],
        queryFn: async () => {
          calls++;
          throw new BffError(
            {
              code: "UNAUTHENTICATED",
              message: "Sign in",
              requestId: "test",
              details: null,
            },
            401,
          );
        },
      }),
    );
    assert.equal(calls, 1);
  } finally {
    first.clear();
    second.clear();
  }
});

test("session mutations send credentials with JSON and preserve normalized auth errors", async () => {
  const client = createBffClient(
    "http://localhost:3001",
    async (_url, init) => {
      if (String(_url).endsWith("/api/csrf"))
        return Response.json({ csrfToken: "a".repeat(64) });
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(init?.headers, {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": "a".repeat(64),
      });
      assert.equal(init?.body, "{}");
      return Response.json({ status: "ok" });
    },
  );
  assert.deepEqual(await client.post("/api/logout", decodeHealth), {
    status: "ok",
  });
});
test("user decoder exposes only the minimal user and server permissions", () => {
  const user = {
    id: "u",
    email: "user@example.test",
    displayName: "User",
    role: "VIEWER",
    permissions: ["location:read"],
  };
  assert.deepEqual(
    decodeUser({ ...user, providerToken: "fake-test-value" }),
    user,
  );
  assert.throws(() => decodeUser({ ...user, permissions: ["unknown"] }));
});
test("auth state distinguishes session expiration from missing authentication", () => {
  const error = (
    code: "UNAUTHENTICATED" | "SESSION_EXPIRED" | "PERMISSION_DENIED",
  ) =>
    new BffError(
      { code, message: "Safe message", requestId: "test", details: null },
      code === "PERMISSION_DENIED" ? 403 : 401,
    );
  assert.equal(authFailure(error("UNAUTHENTICATED")), "unauthenticated");
  assert.equal(authFailure(error("SESSION_EXPIRED")), "expired");
  assert.equal(authFailure(error("PERMISSION_DENIED")), null);
  assert.equal(authFailure(new Error("NETWORK")), null);
});

test("Google login uses a fixed top-level BFF navigation without client-side token exchange", () => {
  assert.equal(
    createBffClient("http://localhost:3001").googleLoginUrl,
    "http://localhost:3001/auth/google",
  );
});

test("PATCH and DELETE obtain fresh session proof; failed proof acquisition prevents mutations", async () => {
  const methods: string[] = [];
  const client = createBffClient("http://localhost:3001", async (url, init) => {
    assert.equal(init?.credentials, "include");
    if (String(url).endsWith("/api/csrf")) {
      methods.push("CSRF");
      return Response.json({ csrfToken: "b".repeat(64) });
    }
    const headers = new Headers(init?.headers);
    assert.ok(headers.get("x-csrf-token") === "b".repeat(64));
    methods.push(init?.method ?? "");
    return Response.json({ status: "ok" });
  });
  await client.patch("/api/test", decodeHealth);
  await client.delete("/api/test", decodeHealth);
  assert.deepEqual(methods, ["CSRF", "PATCH", "CSRF", "DELETE"]);
  let mutationCalls = 0;
  const denied = createBffClient(
    "http://localhost:3001",
    async (_url, init) => {
      if (init?.method !== "GET") mutationCalls++;
      return Response.json(
        {
          code: "UNAUTHENTICATED",
          message: "Sign in",
          requestId: "test",
          details: null,
        },
        { status: 401 },
      );
    },
  );
  await assert.rejects(
    denied.post("/api/logout", decodeHealth),
    (error) => error instanceof BffError && error.status === 401,
  );
  assert.equal(mutationCalls, 0);
});

test("location PATCH sends explicit JSON fields after CSRF acquisition", async () => {
  const payload = { websiteUrl: null, primaryPhone: "+1 555 1234" };
  const client = createBffClient("http://localhost:3001", async (url, init) => {
    if (String(url).endsWith("/api/csrf"))
      return Response.json({ csrfToken: "a".repeat(64) });
    assert.equal(init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init?.body)), payload);
    return Response.json({ status: "ok" });
  });
  await client.patch(
    "/api/locations/location-1",
    decodeHealth,
    undefined,
    payload,
  );
});

test("UI user decoder preserves server-issued capability permissions", () => {
  const user = {
    id: "manager",
    email: "m@example.test",
    displayName: "Manager",
    role: "MANAGER",
    permissions: ["location:read", "location:write"],
  };
  assert.deepEqual(decodeUser(user), user);
  assert.deepEqual(
    decodeUser({ ...user, permissions: ["location:read"] }).permissions,
    ["location:read"],
  );
});
