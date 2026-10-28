-- CreateTable
CREATE TABLE "OAuthTransaction" (
    "stateHash" CHAR(64) NOT NULL,
    "browserHash" CHAR(64) NOT NULL,
    "nonceHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OAuthTransaction_pkey" PRIMARY KEY ("stateHash")
);

-- CreateIndex
CREATE INDEX "OAuthTransaction_browserHash_idx" ON "OAuthTransaction"("browserHash");

-- CreateIndex
CREATE INDEX "OAuthTransaction_expiresAt_idx" ON "OAuthTransaction"("expiresAt");
