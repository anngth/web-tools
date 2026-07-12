const SLUG_LENGTH = 7;
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateSlug(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = randomBytes(SLUG_LENGTH);

  return Array.from(
    bytes,
    (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length],
  ).join("");
}
