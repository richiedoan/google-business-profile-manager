import "reflect-metadata";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { HealthController } from "../src/health.controller";
import { configureApp } from "../src/configure-app";
@Module({ controllers: [HealthController] })
class TestModule {}
test("health HTTP response and explicit CORS origin", async () => {
  const app = await NestFactory.create(TestModule, { logger: false });
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/health`;
    const response = await fetch(url, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      null,
    );
    const denied = await fetch(url, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  } finally {
    await app.close();
  }
});
