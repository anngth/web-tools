import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Check, Clipboard } from "lucide-react";
import { copyTextToClipboard } from "../../shared/clipboard";
import {
  generateTotp,
  importTotpKey,
  normalizeSecret,
  TOTP_STEP_SECONDS,
} from "./totp.service";
import {
  readSecretFromUrlSearch,
  removeSecretFromAddressBar,
} from "./totp-url";
import "./totp.css";

export function TotpPage() {
  const [secret, setSecret] = useState<string>(readSecretFromUrlSearch);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);
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
    return () => {
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
    };
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

    const successful = await copyTextToClipboard(code);
    if (successful) {
      setCopied(true);
      setError("");
      if (copiedResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedResetTimeoutRef.current);
      }
      copiedResetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedResetTimeoutRef.current = null;
      }, 1600);
      return;
    }

    setCopied(false);
    setError("Could not copy token. Check browser clipboard permission.");
  }

  function handleSecretChange(event: ChangeEvent<HTMLInputElement>) {
    setSecret(event.target.value);
    setCode("");
    setError("");
    setCopied(false);
  }

  return (
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
          onChange={handleSecretChange}
          placeholder="JBSWY3DPEHPK3PXP, 6rb5 m3a2 rcf6 np6i qbyg r6pf sf4r ghkd"
          aria-describedby="secret-help secret-error"
        />
      </label>
      <p id="secret-help" className="helpText">
        Your secret is processed only in this browser. It is not stored, logged,
        or sent anywhere. Spaces and lowercase letters are accepted.
      </p>
      <p
        id="secret-error"
        className={error ? "errorText" : "errorText isHidden"}
        role="alert"
        aria-live="polite"
      >
        {error || " "}
      </p>

      <div className="output">
        <span className="outputLabel">Current Token</span>
        <div className="codeRow">
          <button
            className={code ? "codeButton" : "codeButton empty"}
            type="button"
            onClick={copyCode}
            disabled={!code}
            aria-label={code ? "Copy current token" : "No token to copy"}
            title={code ? "Copy token" : "Enter a secret key first"}
            aria-live="polite"
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

        <div className={code ? "countdown" : "countdown hidden"}>
          <div className="countdownBar">
            <div
              className="countdownProgress"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <span className="countdownText">
            {code ? `Refreshes in ${secondsRemaining}s` : "\u00A0"}
          </span>
        </div>
      </div>
    </div>
  );
}
