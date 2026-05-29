import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  generateTotp,
  normalizeSecret,
  parseOtpauthUri,
} from "./totp";

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
    expect(parseOtpauthUri(uri)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("returns empty for non-otpauth URI", () => {
    expect(parseOtpauthUri("https://example.com")).toBe("");
  });

  it("returns empty for invalid URI", () => {
    expect(parseOtpauthUri("not a uri")).toBe("");
  });

  it("returns empty for otpauth hotp", () => {
    const uri =
      "otpauth://hotp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP";
    expect(parseOtpauthUri(uri)).toBe("");
  });

  it("handles URI without secret parameter", () => {
    const uri = "otpauth://totp/Example:user@example.com?issuer=Example";
    expect(parseOtpauthUri(uri)).toBe("");
  });
});

describe("generateTotp", () => {
  it("matches the RFC 6238 SHA-1 test vector for 59 seconds", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    await expect(generateTotp(secret, 59_000)).resolves.toBe("287082");
  });
});
