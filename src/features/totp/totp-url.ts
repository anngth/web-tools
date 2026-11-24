const SENSITIVE_SECRET_PARAMS = ["secret", "key", "s"];

export function readTotpInputFromFragment(): string {
  if (typeof window === "undefined") return "";

  const fragment = window.location.hash.slice(1);
  if (/^otpauth:/i.test(fragment)) return fragment;

  try {
    const decoded = decodeURIComponent(fragment).trim();
    return /^otpauth:/i.test(decoded) ? decoded : "";
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
  const hasSensitiveHash = readTotpInputFromFragment() !== "";

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
