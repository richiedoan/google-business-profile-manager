CREATE TABLE "GoogleBusinessConnection" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "googleSubject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "scopes" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GoogleBusinessConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleBusinessConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleBusinessConnection_userId_googleSubject_key" ON "GoogleBusinessConnection"("userId", "googleSubject");
CREATE INDEX "GoogleBusinessConnection_userId_status_idx" ON "GoogleBusinessConnection"("userId", "status");
CREATE TABLE "GoogleBusinessOAuthTransaction" (
  "stateHash" CHAR(64) NOT NULL,
  "browserHash" CHAR(64) NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "nonceHash" CHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "GoogleBusinessOAuthTransaction_pkey" PRIMARY KEY ("stateHash"),
  CONSTRAINT "GoogleBusinessOAuthTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GoogleBusinessOAuthTransaction_expiresAt_idx" ON "GoogleBusinessOAuthTransaction"("expiresAt");
