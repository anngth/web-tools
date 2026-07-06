import { parseOtpauthUri } from "./totp.service";

const SENSITIVE_SECRET_PARAMS = ["secret", "key", "s"];

export function readSecretFromUrlSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const raw =
      params.get("secret") ?? params.get("key") ?? params.get("s") ?? "";

    if (raw) {
      return (parseOtpauthUri(raw) || raw).trim();
    }

    if (window.location.hash) {
      const hashValue = safeDecodeUriComponent(window.location.hash.slice(1));
      const hashSecret = parseOtpauthUri(hashValue);
      if (hashSecret) return hashSecret.trim();
    }

    return "";
  } catch {
    return "";
  }
}

export function removeSecretFromAddressBar() {
  if (typeof window === "undefined" || !window.history.replaceState) {
    return;
  }

  const url = new URL(window.location.href);
  const hasSensitiveParam = SENSITIVE_SECRET_PARAMS.some((param) =>
    url.searchParams.has(param),
  );
  const hasSensitiveHash = parseOtpauthUri(
    safeDecodeUriComponent(url.hash.slice(1)),
  );

  if (!hasSensitiveParam && !hasSensitiveHash) {
    return;
  }

  for (const param of SENSITIVE_SECRET_PARAMS) {
    url.searchParams.delete(param);
  }

  if (hasSensitiveHash) {
    url.hash = "";
  }

  window.history.replaceState(
    null,
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
