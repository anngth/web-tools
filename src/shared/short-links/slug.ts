const SLUG_LENGTH = 7;
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const UNBIASED_BYTE_LIMIT =
  Math.floor(256 / SLUG_ALPHABET.length) * SLUG_ALPHABET.length;

export function generateSlug(
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const characters: string[] = [];

  while (characters.length < SLUG_LENGTH) {
    const bytes = randomBytes(SLUG_LENGTH - characters.length);
    for (const byte of bytes) {
      if (byte < UNBIASED_BYTE_LIMIT) {
        characters.push(SLUG_ALPHABET[byte % SLUG_ALPHABET.length]);
        if (characters.length === SLUG_LENGTH) break;
      }
    }
  }

  return characters.join("");
}
