export const TOTP_STEP_SECONDS = 30;
export const DIGITS = 6;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_ALLOWED_LENGTH_REMAINDERS = new Set([0, 2, 4, 5, 7]);

export function normalizeSecret(value: string): string {
  return value.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
}

export function parseOtpauthUri(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") {
      return "";
    }

    return url.searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

export function decodeBase32(secret: string): Uint8Array {
  const normalized = normalizeSecret(secret);

  if (!normalized) {
    return new Uint8Array();
  }

  const values: number[] = [];
  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error("Use a valid Base32 secret: A-Z and 2-7.");
    }
    values.push(value);
  }

  if (!BASE32_ALLOWED_LENGTH_REMAINDERS.has(normalized.length % 8)) {
    throw new Error("Use a valid Base32 secret length.");
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const value of values) {
    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  if (bitsLeft > 0 && (buffer & ((1 << bitsLeft) - 1)) !== 0) {
    throw new Error("Use a valid Base32 secret padding.");
  }

  return new Uint8Array(bytes);
}

export function counterToBytes(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;

  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  return buffer;
}

export async function generateTotp(
  secret: string,
  timestamp: number,
  cryptoKey?: CryptoKey,
): Promise<string> {
  let key = cryptoKey;
  if (!key) {
    const keyBytes = decodeBase32(secret);
    if (keyBytes.length === 0) {
      return "";
    }
    key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
  }

  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    counterToBytes(counter),
  );
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function importTotpKey(secret: string): Promise<CryptoKey | null> {
  const keyBytes = decodeBase32(secret);
  if (keyBytes.length === 0) {
    return null;
  }

  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
}
