export const TOTP_STEP_SECONDS = 30;
export const DIGITS = 6;

type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

interface TotpInput {
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
}

const DEFAULT_TOTP_OPTIONS = {
  algorithm: "SHA-1",
  digits: DIGITS,
  period: TOTP_STEP_SECONDS,
} as const;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_ALLOWED_LENGTH_REMAINDERS = new Set([0, 2, 4, 5, 7]);

export function normalizeSecret(value: string): string {
  return value.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
}

export function parseOtpauthUri(uri: string): TotpInput | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "otpauth:" || url.hostname.toLowerCase() !== "totp") {
    return null;
  }

  const secret = normalizeSecret(url.searchParams.get("secret") ?? "");
  if (!secret) return null;

  const rawAlgorithm = url.searchParams.get("algorithm")?.toUpperCase() ?? "SHA1";
  let algorithm: TotpAlgorithm;
  switch (rawAlgorithm) {
    case "SHA1":
      algorithm = "SHA-1";
      break;
    case "SHA256":
      algorithm = "SHA-256";
      break;
    case "SHA512":
      algorithm = "SHA-512";
      break;
    default:
      throw new Error("Unsupported TOTP algorithm. Use SHA1, SHA256, or SHA512.");
  }

  const rawDigits = url.searchParams.get("digits") ?? String(DEFAULT_TOTP_OPTIONS.digits);
  if (rawDigits !== "6" && rawDigits !== "8") {
    throw new Error("Unsupported TOTP code length. Use 6 or 8 digits.");
  }
  const digits = rawDigits === "8" ? 8 : 6;

  const rawPeriod = url.searchParams.get("period") ?? String(DEFAULT_TOTP_OPTIONS.period);
  const period = Number(rawPeriod);
  if (!/^\d+$/.test(rawPeriod) || !Number.isSafeInteger(period) || period < 1) {
    throw new Error("Unsupported TOTP period. Use a positive whole number of seconds.");
  }

  return { secret, algorithm, digits, period };
}

export function parseTotpInput(value: string): TotpInput | null {
  const input = value.trim();
  if (/^otpauth:/i.test(input)) {
    const setup = parseOtpauthUri(input);
    if (setup === null) throw new Error("Use a valid TOTP setup link with a secret.");
    return setup;
  }

  const secret = normalizeSecret(input);
  return secret ? { secret, ...DEFAULT_TOTP_OPTIONS } : null;
}

export function decodeBase32(secret: string): Uint8Array<ArrayBuffer> {
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
  input: string | TotpInput,
  timestamp: number,
): Promise<string> {
  const { secret, algorithm, digits, period } = typeof input === "string"
    ? { secret: input, ...DEFAULT_TOTP_OPTIONS }
    : input;
  const keyBytes = decodeBase32(secret);
  if (keyBytes.length === 0) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );

  const counter = Math.floor(timestamp / 1000 / period);
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

  return String(binary % 10 ** digits).padStart(digits, "0");
}
