import "reflect-metadata";
import "dotenv/config";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaSessionRepository } from "../src/auth/session.repository";
import { hashSessionToken } from "../src/auth/session.service";
test(
  "PostgreSQL sessions persist across repository/client instances and revoke durably",
  {
    skip:
      process.env.RUN_SESSION_DB_TESTS !== "true" ||
      process.env.NODE_ENV !== "test",
  },
  async () => {
    const first = new PrismaService();
    const second = new PrismaService();
    const hash = hashSessionToken(randomBytes(32).toString("hex"));
    const repository = new PrismaSessionRepository(first);
    try {
      await first.$connect();
      await second.$connect();
      const user = await repository.createLocalSession(
        hash,
        new Date(Date.now() + 60000),
      );
      const other = new PrismaSessionRepository(second);
      assert.equal((await other.find(hash))?.user?.id, user.id);
      await other.remove(hash);
      assert.equal(await repository.find(hash), null);
    } finally {
      await repository.remove(hash);
      await first.$disconnect();
      await second.$disconnect();
    }
  },
);
