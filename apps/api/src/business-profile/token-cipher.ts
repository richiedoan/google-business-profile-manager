import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export class TokenCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "hex");
    if (this.key.length !== 32) throw new Error("Invalid token encryption key");
  }
  encrypt(token: string, owner: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(owner));
    const encrypted = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(".");
  }
  decrypt(value: string, owner: string): string {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra)
      throw new Error("Invalid encrypted token");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
