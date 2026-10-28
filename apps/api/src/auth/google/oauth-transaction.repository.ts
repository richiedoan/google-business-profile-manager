import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
export interface OAuthTransaction {
  stateHash: string;
  browserHash: string;
  nonceHash: string;
  expiresAt: Date;
}
export interface OAuthTransactionRepository {
  create(
    transaction: OAuthTransaction,
    previousBrowserHash?: string,
  ): Promise<void>;
  consume(
    stateHash: string,
    browserHash: string,
  ): Promise<OAuthTransaction | null>;
}
export const OAUTH_TRANSACTION_REPOSITORY = Symbol(
  "OAuthTransactionRepository",
);
@Injectable()
export class PrismaOAuthTransactionRepository implements OAuthTransactionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(
    transaction: OAuthTransaction,
    previousBrowserHash?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.oAuthTransaction.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            ...(previousBrowserHash
              ? [{ browserHash: previousBrowserHash }]
              : []),
          ],
        },
      });
      await tx.oAuthTransaction.create({ data: transaction });
    });
  }
  async consume(
    stateHash: string,
    browserHash: string,
  ): Promise<OAuthTransaction | null> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.oAuthTransaction.findUnique({
        where: { stateHash },
      });
      if (
        !record ||
        record.browserHash !== browserHash ||
        record.expiresAt.getTime() <= Date.now()
      )
        return null;
      const result = await tx.oAuthTransaction.deleteMany({
        where: { stateHash, browserHash, expiresAt: { gt: new Date() } },
      });
      return result.count === 1 ? record : null;
    });
  }
}
