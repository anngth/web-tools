import { ShortLinkError } from "./url-shortener.model";

const DEFAULT_TTL_SECONDS = 2_592_000;
const ALIAS_PATTERN = /^[a-z0-9-]{3,48}$/;
const DECIMAL_INTEGER_PATTERN = /^\d+$/;

function validationError(): ShortLinkError {
  return new ShortLinkError("validation");
}

function parseIpv4(hostname: string): readonly number[] | undefined {
  const parts = hostname.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !DECIMAL_INTEGER_PATTERN.test(part))
  ) {
    return undefined;
  }

  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255)
    ? octets
    : undefined;
}

function isBlockedIpv4(octets: readonly number[]): boolean {
  const [first, second] = octets;

  return (
    (first === 0 && second === 0 && octets[2] === 0 && octets[3] === 0) ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function parseIpv6(hostname: string): readonly number[] | undefined {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) {
    return undefined;
  }

  const address = hostname.slice(1, -1);
  const compressedParts = address.split("::");
  if (compressedParts.length > 2) {
    return undefined;
  }

  const left = compressedParts[0] ? compressedParts[0].split(":") : [];
  const right = compressedParts[1] ? compressedParts[1].split(":") : [];
  const omittedCount =
    compressedParts.length === 2 ? 8 - left.length - right.length : 0;
  if (
    omittedCount < 0 ||
    (compressedParts.length === 1 && left.length !== 8)
  ) {
    return undefined;
  }

  const groups = [
    ...left,
    ...Array.from({ length: omittedCount }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))
  ) {
    return undefined;
  }

  return groups.map((group) => Number.parseInt(group, 16));
}

function isBlockedIpv6(groups: readonly number[]): boolean {
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isPrivate = (groups[0] & 0xfe00) === 0xfc00;
  const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const isIpv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

  if (isIpv4Mapped) {
    const mappedIpv4 = [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ];
    return isBlockedIpv4(mappedIpv4);
  }

  return isUnspecified || isLoopback || isPrivate || isLinkLocal;
}

function isBlockedHostname(hostname: string): boolean {
  const normalizedHostname = hostname.endsWith(".")
    ? hostname.slice(0, -1)
    : hostname;

  if (
    normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost")
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalizedHostname);
  if (ipv4) {
    return isBlockedIpv4(ipv4);
  }

  const ipv6 = parseIpv6(normalizedHostname);
  return ipv6 ? isBlockedIpv6(ipv6) : false;
}

export function validateDestinationUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validationError();
  }

  let destination: URL;
  try {
    destination = new URL(value);
  } catch {
    throw validationError();
  }

  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.username !== "" ||
    destination.password !== "" ||
    isBlockedHostname(destination.hostname)
  ) {
    throw validationError();
  }

  return destination.toString();
}

export function validateCustomAlias(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw validationError();
  }

  const alias = value.trim().toLowerCase();
  if (!ALIAS_PATTERN.test(alias)) {
    throw validationError();
  }

  return alias;
}

export function validateTtlSeconds(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_TTL_SECONDS;
  }
  if (!DECIMAL_INTEGER_PATTERN.test(value)) {
    throw validationError();
  }

  const ttlSeconds = Number(value);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw validationError();
  }

  return ttlSeconds;
}

export function computeExpiresAt(createdAt: Date, ttlSeconds: number): string {
  const createdAtMilliseconds = createdAt.getTime();
  const expiresAtMilliseconds = createdAtMilliseconds + ttlSeconds * 1_000;

  if (
    !Number.isFinite(createdAtMilliseconds) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    !Number.isSafeInteger(expiresAtMilliseconds)
  ) {
    throw validationError();
  }

  try {
    return new Date(expiresAtMilliseconds).toISOString();
  } catch {
    throw validationError();
  }
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  const expirationMilliseconds = Date.parse(expiresAt);
  const nowMilliseconds = now.getTime();
  if (
    !Number.isFinite(expirationMilliseconds) ||
    !Number.isFinite(nowMilliseconds)
  ) {
    throw validationError();
  }

  return expirationMilliseconds <= nowMilliseconds;
}
