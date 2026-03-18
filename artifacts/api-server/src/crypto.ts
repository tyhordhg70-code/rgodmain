import crypto from "crypto";

const SALT = Buffer.from("ordrsubmit_enc_v1_2024");
const ITERATIONS = 100000;

function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, "sha256");
}

export function encrypt(data: string, password: string): string {
  const key = deriveKey(password);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString("base64");
}

export function decrypt(encryptedBase64: string, password: string): string {
  const key = deriveKey(password);
  const combined = Buffer.from(encryptedBase64, "base64");
  const iv = combined.slice(0, 12);
  const authTag = combined.slice(combined.length - 16);
  const encrypted = combined.slice(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "ordrsubmit_pwd_salt_v1").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}
