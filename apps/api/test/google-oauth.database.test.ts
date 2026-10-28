import "reflect-metadata";
import "dotenv/config";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/database/prisma.service";
import { PrismaSessionRepository } from "../src/auth/session.repository";
import { PrismaOAuthTransactionRepository } from "../src/auth/google/oauth-transaction.repository";
import { hashSessionToken } from "../src/auth/session.service";
import { AppException } from "../src/errors/app.exception";
const skip =
  process.env.RUN_SESSION_DB_TESTS !== "true" ||
  process.env.NODE_ENV !== "test";
function requireLocalDatabase() {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.DATABASE_URL ?? "").hostname,
    ),
    "Database fixture tests require a loopback test database.",
  );
}
test(
  "PostgreSQL OAuth transaction browser binding, expiry and atomic single use",
  { skip },
  async () => {
    requireLocalDatabase();
    const first = new PrismaService();
    const second = new PrismaService();
    const repo = new PrismaOAuthTransactionRepository(first);
    const other = new PrismaOAuthTransactionRepository(second);
    const record = {
      stateHash: hashSessionToken(randomUUID()),
      browserHash: hashSessionToken(randomUUID()),
      nonceHash: hashSessionToken(randomUUID()),
      expiresAt: new Date(Date.now() + 60000),
    };
    try {
      await first.$connect();
      await second.$connect();
      await repo.create(record);
      assert.equal(
        await other.consume(
          record.stateHash,
          hashSessionToken("wrong-browser"),
        ),
        null,
      );
      const results = await Promise.all([
        repo.consume(record.stateHash, record.browserHash),
        other.consume(record.stateHash, record.browserHash),
      ]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(
        await repo.consume(record.stateHash, record.browserHash),
        null,
      );
      await repo.create({ ...record, expiresAt: new Date(0) });
      assert.equal(
        await other.consume(record.stateHash, record.browserHash),
        null,
      );
    } finally {
      await first.oAuthTransaction.deleteMany({
        where: { stateHash: record.stateHash },
      });
      await first.$disconnect();
      await second.$disconnect();
    }
  },
);
test(
  "Google subject identity persists, preserves roles, rejects email linking, and rolls back invalid membership",
  { skip },
  async () => {
    requireLocalDatabase();
    const prisma = new PrismaService();
    const repository = new PrismaSessionRepository(prisma);
    const suffix = randomUUID();
    const identity = {
      subject: `test-google-${suffix}`,
      email: `oauth-${suffix}@example.test`,
      displayName: "OAuth Test User",
      scopes: ["openid", "email", "profile"],
    };
    const firstHash = hashSessionToken(randomUUID());
    const secondHash = hashSessionToken(randomUUID());
    const deniedHash = hashSessionToken(randomUUID());
    const expires = new Date(Date.now() + 60000);
    const userIds: string[] = [];
    try {
      await prisma.$connect();
      const first = await repository.createGoogleSession(
        identity,
        firstHash,
        expires,
      );
      userIds.push(first.id);
      assert.equal(first.role, "VIEWER");
      assert.equal((await repository.find(firstHash))?.user?.id, first.id);
      const connection = await prisma.oAuthConnection.findUnique({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: identity.subject,
          },
        },
      });
      assert.equal(connection?.userId, first.id);
      assert.deepEqual(connection?.scopes, identity.scopes);
      await prisma.membership.update({
        where: { userId: first.id },
        data: { role: "MANAGER" },
      });
      const updated = await repository.createGoogleSession(
        { ...identity, displayName: "Updated Profile" },
        secondHash,
        expires,
        firstHash,
      );
      assert.equal(updated.id, first.id);
      assert.equal(updated.role, "MANAGER");
      assert.equal(updated.displayName, "Updated Profile");
      assert.equal(await repository.find(firstHash), null);
      const localUser = await prisma.user.create({
        data: {
          email: `local-${suffix}@example.test`,
          displayName: "Existing Local",
          membership: { create: { role: "MANAGER" } },
        },
      });
      userIds.push(localUser.id);
      await assert.rejects(
        repository.createGoogleSession(
          { ...identity, subject: `other-${suffix}`, email: localUser.email },
          deniedHash,
          expires,
        ),
        (error) =>
          error instanceof AppException && error.code === "PERMISSION_DENIED",
      );
      assert.equal(await repository.find(deniedHash), null);
      assert.equal(
        await prisma.oAuthConnection.count({ where: { userId: localUser.id } }),
        0,
      );
      await prisma.membership.delete({ where: { userId: first.id } });
      await assert.rejects(
        repository.createGoogleSession(
          { ...identity, displayName: "Must Roll Back" },
          deniedHash,
          expires,
        ),
        (error) =>
          error instanceof AppException && error.code === "PERMISSION_DENIED",
      );
      assert.equal(
        (await prisma.user.findUnique({ where: { id: first.id } }))
          ?.displayName,
        "Updated Profile",
      );
      assert.equal(await repository.find(deniedHash), null);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
  },
);
