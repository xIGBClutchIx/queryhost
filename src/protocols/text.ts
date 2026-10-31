/** Shared text decoding for protocol parsers. Callers map `undefined` to their own stable error. */

// `ignoreBOM` keeps a leading U+FEFF as server text rather than silently removing it.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const LATIN1 = new TextDecoder("latin1");

/** Decodes strict UTF-8, or returns `undefined` when any byte sequence is invalid or incomplete. */
export function decodeStrictUtf8(bytes: Uint8Array): string | undefined {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Decodes strict UTF-8 but drops one incomplete multi-byte sequence at the very end.
 *
 * Game engines often cut a string to a byte budget without respecting character boundaries (ARK
 * truncates hostnames at 63 bytes, for example), which leaves the valid leading bytes of a final
 * character. Only a valid prefix of a sequence is dropped: an invalid lead or continuation byte,
 * an overlong or surrogate prefix, or a stray continuation byte anywhere still fails.
 */
export function decodeTruncatedUtf8(bytes: Uint8Array): string | undefined {
  // A streaming decode reports every invalid sequence immediately but holds back a valid,
  // unfinished final sequence instead of failing; that withheld tail is what gets dropped. A fresh
  // decoder keeps the withheld bytes from leaking into the next call.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return decoder.decode(bytes, { stream: true });
  } catch {
    return undefined;
  }
}

/**
 * Decodes strict UTF-8 and falls back to Latin-1 when the bytes are not valid UTF-8.
 *
 * For protocols whose servers emit either encoding without declaring it. Latin-1 maps every byte,
 * so this never fails.
 */
export function decodeUtf8OrLatin1(bytes: Uint8Array): string {
  return decodeStrictUtf8(bytes) ?? LATIN1.decode(bytes);
}
