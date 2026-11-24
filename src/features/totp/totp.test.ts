import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  generateTotp,
  normalizeSecret,
  parseOtpauthUri,
} from "./totp.service";
import { readTotpInputFromFragment, removeSecretFromAddressBar } from "./totp-url";

describe("normalizeSecret", () => {
  it("removes spaces", () => {
    expect(normalizeSecret("JBSW Y3DP EHPK 3PXP")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("removes padding", () => {
    expect(normalizeSecret("JBSWY3DPEHPK3PXP====")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("converts to uppercase", () => {
    expect(normalizeSecret("jbswy3dpehpk3pxp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("handles mixed case with spaces and padding", () => {
    expect(normalizeSecret("jbsw y3dp ehpk 3pxp==")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("handles empty strings", () => {
    expect(normalizeSecret("")).toBe("");
  });
});

describe("decodeBase32", () => {
  it("decodes valid Base32 strings", () => {
    const result = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("decodes Base32 with spaces", () => {
    expect(decodeBase32("JBSW Y3DP EHPK 3PXP")).toEqual(
      decodeBase32("JBSWY3DPEHPK3PXP"),
    );
  });

  it("decodes lowercase Base32", () => {
    expect(decodeBase32("jbswy3dpehpk3pxp")).toEqual(
      decodeBase32("JBSWY3DPEHPK3PXP"),
    );
  });

  it("handles empty strings", () => {
    expect(decodeBase32("")).toEqual(new Uint8Array());
  });

  it("throws for invalid characters", () => {
    expect(() => decodeBase32("INVALID!@#$")).toThrow(
      "Use a valid Base32 secret: A-Z and 2-7.",
    );
  });

  it("throws for invalid length", () => {
    expect(() => decodeBase32("ABC")).toThrow(
      "Use a valid Base32 secret length.",
    );
  });

  it("throws for non-zero padding bits", () => {
    expect(() => decodeBase32("MZXW6YTBON")).toThrow(
      "Use a valid Base32 secret padding.",
    );
  });

  it("decodes the RFC 4648 foobar vector", () => {
    expect(Array.from(decodeBase32("MZXW6YTBOI"))).toEqual(
      Array.from(new TextEncoder().encode("foobar")),
    );
  });
});

describe("parseOtpauthUri", () => {
  it("parses valid otpauth URI", () => {
    const uri =
      "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example";
    expect(parseOtpauthUri(uri)).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA-1",
      digits: 6,
      period: 30,
    });
  });

  it("returns empty for non-otpauth URI", () => {
    expect(parseOtpauthUri("https://example.com")).toBeNull();
  });

  it("returns empty for invalid URI", () => {
    expect(parseOtpauthUri("not a uri")).toBeNull();
  });

  it("returns empty for otpauth hotp", () => {
    const uri =
      "otpauth://hotp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP";
    expect(parseOtpauthUri(uri)).toBeNull();
  });

  it("handles URI without secret parameter", () => {
    const uri = "otpauth://totp/Example:user@example.com?issuer=Example";
    expect(parseOtpauthUri(uri)).toBeNull();
  });
});

describe("generateTotp", () => {
  it("matches the RFC 6238 SHA-1 test vector for 59 seconds", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    await expect(generateTotp(secret, 59_000)).resolves.toBe("287082");
  });

  it.each([
    ["SHA1", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "94287082"],
    ["SHA256", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA", "46119246"],
    ["SHA512", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA", "90693936"],
  ])("honors %s, eight digits and a nondefault period", async (algorithm, secret, expected) => {
    const uri = `otpauth://totp/RFC6238?secret=${secret}&algorithm=${algorithm}&digits=8&period=60`;
    const input = parseOtpauthUri(uri);
    expect(input).toMatchObject({ digits: 8, period: 60 });
    if (input === null) throw new Error("Expected a valid TOTP setup link");
    await expect(generateTotp(input, 119_000)).resolves.toBe(expected);
  });

  it.each(["algorithm=MD5", "digits=7", "period=0", "period=1.5", "period=9007199254740992"])(
    "rejects unsupported setup parameter %s",
    (parameter) => {
      const uri = `otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&${parameter}`;
      expect(() => parseOtpauthUri(uri)).toThrow("Unsupported TOTP");
    },
  );
});

it("preserves escaped URI fields in an unwrapped setup fragment", () => {
  const uri = "otpauth://totp/Example?secret=JBSWY3DPEHPK3PXP&issuer=A%26B&digits=8";
  window.history.replaceState(null, "", `/totp#${uri}`);

  expect(readTotpInputFromFragment()).toBe(uri);
});

describe("removeSecretFromAddressBar", () => {
  it("removes sensitive search params and preserves non-sensitive hashes", () => {
    window.history.replaceState(
      null,
      document.title,
      "/?secret=JBSWY3DPEHPK3PXP&theme=dark#settings",
    );

    removeSecretFromAddressBar();

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?theme=dark");
    expect(window.location.hash).toBe("#settings");
  });

  it("removes otpauth hash payloads", () => {
    window.history.replaceState(
      null,
      document.title,
      "/#otpauth%3A%2F%2Ftotp%2FExample%3Fsecret%3DJBSWY3DPEHPK3PXP",
    );

    removeSecretFromAddressBar();

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });
});
