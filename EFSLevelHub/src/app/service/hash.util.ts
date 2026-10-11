/**
 * Computes a SHA-256 digest of the given bytes and returns it as lowercase hex.
 *
 * Used to detect whether an editor's stage archive still matches the original
 * one copied at import time, so exports only patch the arcs that changed.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}
