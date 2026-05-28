import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clipboard,
  Wrench,
  Moon,
  RefreshCw,
  Sun,
  Menu,
  X,
  Home,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import "./styles.css";

const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;

function normalizeSecret(value: string): string {
  return value.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
}

function decodeBase32(secret: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeSecret(secret);
  const allowedLengthRemainders = new Set([0, 2, 4, 5, 7]);

  if (!normalized) {
    return new Uint8Array();
  }

  if (!allowedLengthRemainders.has(normalized.length % 8)) {
    throw new Error("Use a valid Base32 secret length.");
  }

  let bits = "";
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Error("Use a valid Base32 secret: A-Z and 2-7.");
    }
    bits += value.toString(2).padStart(5, "0");
  }

  const leftoverBitCount = bits.length % 8;
  if (
    leftoverBitCount > 0 &&
    !bits
      .slice(bits.length - leftoverBitCount)
      .split("")
      .every((bit) => bit === "0")
  ) {
    throw new Error("Use a valid Base32 secret padding.");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }

  return new Uint8Array(bytes);
}

function counterToBytes(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;

  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  return buffer;
}

function readSecretFromUrlSearch(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const raw =
      params.get("secret") ?? params.get("key") ?? params.get("s") ?? "";
    return raw.trim();
  } catch {
    return "";
  }
}

async function generateTotp(
  secret: string,
  timestamp: number,
): Promise<string> {
  const keyBytes = decodeBase32(secret);
  if (keyBytes.length === 0) {
    return "";
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
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

function App() {
  const [secret, setSecret] = useState<string>(readSecretFromUrlSearch);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const [timeStep, setTimeStep] = useState<number>(() =>
    Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS),
  );

  const normalizedSecret = useMemo(() => normalizeSecret(secret), [secret]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
      setTimeStep((currentStep) =>
        currentStep === nextStep ? currentStep : nextStep,
      );
    }, 500);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    secretInputRef.current?.focus();
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
        const nextCode = await generateTotp(normalizedSecret, Date.now());
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
  }, [normalizedSecret, timeStep]);

  async function handleGenerate() {
    if (!normalizedSecret) {
      setCode("");
      setCopied(false);
      setError("Enter a Base32 secret key first.");
      return;
    }

    try {
      const nextCode = await generateTotp(normalizedSecret, Date.now());
      setCode(nextCode);
      setCopied(false);
      setError("");
    } catch (err) {
      setCode("");
      setCopied(false);
      setError(
        err instanceof Error ? err.message : "Could not generate token.",
      );
    }
  }

  async function copyCode() {
    if (!code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setError("Could not copy token. Check browser clipboard permission.");
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
          <a
            href="#"
            className="sidebarNavItem"
            title={sidebarCollapsed ? "Home" : ""}
          >
            <Home size={20} />
            {!sidebarCollapsed && <span>Home</span>}
          </a>
          <a
            href="#"
            className="sidebarNavItem"
            title={sidebarCollapsed ? "Settings" : ""}
          >
            <Settings size={20} />
            {!sidebarCollapsed && <span>Settings</span>}
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

          <button
            className="generateButton"
            type="button"
            onClick={handleGenerate}
          >
            <RefreshCw size={18} />
            Generate TOTP
          </button>

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
