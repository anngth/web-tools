import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard } from "lucide-react";
import { copyTextToClipboard } from "../../shared/clipboard";
import {
  generateTotp,
  parseTotpInput,
  TOTP_STEP_SECONDS,
} from "./totp.service";
import {
  readTotpInputFromFragment,
  removeSecretFromAddressBar,
} from "./totp-url";
import "./totp.css";

export function TotpPage() {
  const [secret, setSecret] = useState<string>(readTotpInputFromFragment);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const parsedInput = useMemo(() => {
    try {
      return { config: parseTotpInput(secret), error: "" };
    } catch (error) {
      return {
        config: null,
        error: error instanceof Error ? error.message : "Could not read TOTP setup.",
      };
    }
  }, [secret]);
  const period = parsedInput.config?.period ?? TOTP_STEP_SECONDS;
  const currentSecond = Math.floor(now / 1000);
  const currentStep = Math.floor(currentSecond / period);
  const secondsRemaining = period - (currentSecond % period);
  const progressPercentage = (secondsRemaining / period) * 100;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const updateTotpInput = useCallback((value: string) => {
    setSecret(value);
    setCode("");
    setError("");
    setCopied(false);
  }, []);

  useEffect(() => {
    secretInputRef.current?.focus();
    removeSecretFromAddressBar();

    function importSetupFragment() {
      const setup = readTotpInputFromFragment();
      if (!setup) return;
      updateTotpInput(setup);
      removeSecretFromAddressBar();
    }

    window.addEventListener("hashchange", importSetupFragment);
    return () => window.removeEventListener("hashchange", importSetupFragment);
  }, [updateTotpInput]);

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
      const { config } = parsedInput;
      if (config === null) {
        setCode("");
        setError(parsedInput.error);
        return;
      }

      try {
        const stepTimestamp = currentStep * config.period * 1000;
        const nextCode = await generateTotp(config, stepTimestamp);
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
  }, [currentStep, parsedInput]);

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

  return (
    <div className="panel">
      <label className="field">
        <span>Secret key or TOTP setup link</span>
        <input
          ref={secretInputRef}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          type="text"
          value={secret}
          onChange={(event) => updateTotpInput(event.target.value)}
          placeholder="JBSWY3DPEHPK3PXP, 6rb5 m3a2 rcf6 np6i qbyg r6pf sf4r ghkd"
          aria-describedby="secret-help secret-error"
        />
      </label>
      <p id="secret-help" className="helpText">
        Paste a Base32 key or an otpauth setup link. Your key stays in this tab's
        memory while the generator is open.
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
