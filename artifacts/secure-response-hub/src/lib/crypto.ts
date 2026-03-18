const SALT = new TextEncoder().encode("ordrsubmit_enc_v1_2024");
const ITERATIONS = 100000;

async function deriveKey(password: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: SALT,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

export async function encryptData(data: string, password: string): Promise<string> {
  const key = await deriveKey(password, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(data)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(Array.from(combined).map((b) => String.fromCharCode(b)).join(""));
}

export async function decryptData(encryptedBase64: string, password: string): Promise<string> {
  const key = await deriveKey(password, "decrypt");
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertextWithTag
  );
  return new TextDecoder().decode(decrypted);
}

export function generateSubmissionId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
