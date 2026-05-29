import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clipboard,
  Wrench,
  Moon,
  Sun,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import "./styles.css";
import {
  generateTotp,
  importTotpKey,
  normalizeSecret,
  parseOtpauthUri,
  TOTP_STEP_SECONDS,
} from "./totp";

function readSecretFromUrlSearch(): string {
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

    if (!raw && window.location.hash) {
      const hashValue = safeDecodeUriComponent(window.location.hash.slice(1));
      const hashSecret = parseOtpauthUri(hashValue);
      if (hashSecret) return hashSecret.trim();
    }

    return "";
  } catch {
    return "";
  }
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function removeSecretFromAddressBar() {
  if (typeof window === "undefined" || !window.history.replaceState) {
    return;
  }

  const url = new URL(window.location.href);
  const sensitiveParams = ["secret", "key", "s"];
  const hasSensitiveParam = sensitiveParams.some((param) =>
    url.searchParams.has(param),
  );
  const hasSensitiveHash = parseOtpauthUri(
    safeDecodeUriComponent(url.hash.slice(1)),
  );

  if (!hasSensitiveParam && !hasSensitiveHash) {
    return;
  }

  for (const param of sensitiveParams) {
    url.searchParams.delete(param);
  }
  url.hash = "";
  window.history.replaceState(
    null,
    document.title,
    `${url.pathname}${url.search}`,
  );
}

function App() {
  const [secret, setSecret] = useState<string>(readSecretFromUrlSearch);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());

  const normalizedSecret = useMemo(() => normalizeSecret(secret), [secret]);

  const cryptoKeyPromise = useMemo(() => {
    if (!normalizedSecret) {
      return Promise.resolve(null);
    }
    return importTotpKey(normalizedSecret);
  }, [normalizedSecret]);

  const secondsRemaining = useMemo(() => {
    const currentSecond = Math.floor(now / 1000);
    return TOTP_STEP_SECONDS - (currentSecond % TOTP_STEP_SECONDS);
  }, [now]);
  const currentStep = useMemo(
    () => Math.floor(now / 1000 / TOTP_STEP_SECONDS),
    [now],
  );

  const progressPercentage = useMemo(() => {
    return (secondsRemaining / TOTP_STEP_SECONDS) * 100;
  }, [secondsRemaining]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    secretInputRef.current?.focus();
    removeSecretFromAddressBar();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshToken() {
      setCopied(false);
      if (!normalizedSecret) {
        setCode("");
        setError("");
        return;
      }

      try {
        const cryptoKey = await cryptoKeyPromise;
        if (!cryptoKey) {
          return;
        }
        const stepTimestamp = currentStep * TOTP_STEP_SECONDS * 1000;
        const nextCode = await generateTotp(
          normalizedSecret,
          stepTimestamp,
          cryptoKey,
        );
        if (!cancelled) {
          setCode(nextCode);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setCode("");
          setError(
            err instanceof Error ? err.message : "Could not generate token.",
          );
        }
      }
    }

    refreshToken();
    return () => {
      cancelled = true;
    };
  }, [cryptoKeyPromise, currentStep, normalizedSecret]);

  async function copyCode() {
    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      // Fallback for older browsers or when clipboard API is not available
      try {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (successful) {
          setCopied(true);
          setError("");
          window.setTimeout(() => setCopied(false), 1600);
        } else {
          throw new Error("Fallback copy failed");
        }
      } catch {
        setCopied(false);
        setError("Could not copy token. Check browser clipboard permission.");
      }
    }
  }

  return (
    <main
      className={`app ${darkMode ? "dark" : ""} ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}
    >
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="sidebarOverlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarCollapsed ? "collapsed" : ""}`}
      >
        <div className="sidebarHeader">
          <div className="sidebarBrand">
            <span className="sidebarBrandIcon" aria-hidden="true">
              <Wrench size={20} />
            </span>
            {!sidebarCollapsed && (
              <span className="sidebarBrandText">Web Tools</span>
            )}
          </div>

          <button
            className="sidebarThemeToggle"
            type="button"
            onClick={() => setDarkMode((value) => !value)}
            aria-label={
              darkMode ? "Switch to light mode" : "Switch to dark mode"
            }
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            className="sidebarCloseButton"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>

          <button
            className="sidebarCollapseButton"
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <ChevronLeft size={18} />
            )}
          </button>
        </div>

        <nav className="sidebarNav" aria-label="Main navigation">
          <a
            href="#"
            className="sidebarNavItem active"
            title={sidebarCollapsed ? "TOTP Generator" : ""}
          >
            <ShieldCheck size={20} />
            {!sidebarCollapsed && <span>TOTP Generator</span>}
          </a>
        </nav>

        <div className="sidebarFooter"></div>
      </aside>

      {/* Fixed Dark Mode Toggle - Near Header */}
      <button
        className="fixedThemeToggle mobileOnly"
        type="button"
        onClick={() => setDarkMode((value) => !value)}
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        title={darkMode ? "Light mode" : "Dark mode"}
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <section className="shell" aria-labelledby="page-title">
        <header className="topbar">
          <div className="brand">
            <button
              className="menuButton"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              aria-expanded={sidebarOpen}
            >
              <Menu size={24} />
            </button>
            <span className="brandIcon" aria-hidden="true">
              <ShieldCheck size={24} />
            </span>
            <div>
              <h1 id="page-title">TOTP Generator</h1>
              <p>RFC 6238 · HMAC-SHA1</p>
            </div>
          </div>
        </header>

        <div className="panel">
          <label className="field">
            <span>Base32 Secret Key</span>
            <input
              ref={secretInputRef}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              type="text"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="JBSWY3DPEHPK3PXP, 6rb5 m3a2 rcf6 np6i qbyg r6pf sf4r ghkd"
              aria-describedby="secret-help secret-error"
            />
          </label>
          <p id="secret-help" className="helpText">
            Your secret is processed only in this browser. It is not stored,
            logged, or sent anywhere. Spaces and lowercase letters are accepted.
          </p>
          <p
            id="secret-error"
            className={error ? "errorText" : "errorText isHidden"}
            role="alert"
            aria-live="polite"
          >
            {error || " "}
          </p>

          <div className="output" aria-live="polite">
            <span className="outputLabel">Current Token</span>
            <div className="codeRow">
              <button
                className={code ? "codeButton" : "codeButton empty"}
                type="button"
                onClick={copyCode}
                disabled={!code}
                aria-label={code ? "Copy current token" : "No token to copy"}
                title={code ? "Copy token" : "Enter a secret key first"}
              >
                {code || "------"}
              </button>
              <button
                className={copied ? "copyButton copied" : "copyButton"}
                type="button"
                onClick={copyCode}
                disabled={!code}
              >
                {copied ? <Check size={18} /> : <Clipboard size={18} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Countdown Timer */}
            <div className={code ? "countdown" : "countdown hidden"}>
              <div className="countdownBar">
                <div
                  className="countdownProgress"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <span className="countdownText" aria-live="polite">
                {code ? `Refreshes in ${secondsRemaining}s` : "\u00A0"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
