import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Deliberately simple, dependency-free password hashing built on Node's crypto.
// Each password gets a random 16-byte salt; we store "<salt-hex>:<hash-hex>".
// scrypt is a memory-hard KDF, so this is slow to brute-force even though the
// scheme itself is plain.

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer;

  // Constant-time compare to avoid leaking match progress via timing.
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

/** Opaque, URL-safe session token. */
export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}
