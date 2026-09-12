import "server-only";
import {
  createCipheriv, createDecipheriv, createHash, randomBytes,
} from "node:crypto";

/**
 * Symmetric encryption for third-party tokens at rest.
 *
 * Google OAuth tokens grant read access to a creator's Drive, so they must not
 * sit in the database as plaintext. AES-256-GCM gives confidentiality and
 * tamper detection; the key comes from WG_SECRET.
 *
 * With no WG_SECRET the key is derived from the database path so a single-user
 * local install still works. That is weaker than a real secret — a reader of
 * the disk can derive it — so a deployment that stores anyone else's tokens
 * must set WG_SECRET. The distinction is called out in .env.example.
 */
function keyMaterial(): Buffer {
  const secret =
    process.env.WG_SECRET ||
    `local-install:${process.env.WG_DATA_DIR ?? process.cwd()}`;
  return createHash("sha256").update(secret).digest();
}

/**
 * A key for a purpose other than token encryption, derived from the same
 * secret. Separating by label means a signature minted for one purpose can
 * never be replayed as another.
 */
export function derivedKey(purpose: string): Buffer {
  return createHash("sha256").update(keyMaterial()).update(purpose).digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  const [version, ivB64, tagB64, dataB64] = stored.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) return "";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyMaterial(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A rotated WG_SECRET invalidates stored tokens; the creator reconnects.
    return "";
  }
}
