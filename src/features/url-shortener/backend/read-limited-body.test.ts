import { describe, expect, it, vi } from "vitest";
import {
  RequestBodyTooLargeError,
  readLimitedRequestBody,
} from "./read-limited-body";

function streamingRequest(
  chunks: Uint8Array[],
  onCancel = vi.fn(),
): { request: Request; pulls: ReturnType<typeof vi.fn>; onCancel: typeof onCancel } {
  const pulls = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls();
      const chunk = chunks.shift();
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
    cancel: onCancel,
  });
  const request = new Request("https://example.test/", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, pulls, onCancel };
}

describe("readLimitedRequestBody", () => {
  it("accepts exactly 16 KiB across multibyte UTF-8 chunk boundaries", async () => {
    const encoded = new TextEncoder().encode("é".repeat(8_192));
    const { request, onCancel } = streamingRequest([
      encoded.slice(0, 3),
      encoded.slice(3, 9_001),
      encoded.slice(9_001),
    ]);

    const body = await readLimitedRequestBody(request, 16_384);

    expect(body).toHaveLength(16_384);
    expect(new TextDecoder().decode(body)).toBe("é".repeat(8_192));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels and rejects as soon as byte 16,385 arrives", async () => {
    const remaining = new Uint8Array(2_000_000);
    const { request, pulls, onCancel } = streamingRequest([
      new Uint8Array(16_384),
      new Uint8Array([1]),
      remaining,
    ]);

    await expect(readLimitedRequestBody(request, 16_384)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pulls).toHaveBeenCalledTimes(2);
  });
});
