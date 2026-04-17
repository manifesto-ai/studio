/**
 * Web Crypto bridge — isomorphic access to `randomUUID` and `subtle.digest`
 * without importing `node:crypto`. Node 19+ and every supported browser
 * expose `globalThis.crypto` that satisfies both APIs, so consumers of
 * studio-core can build for Node (CLI / replay) or browser (webapp).
 *
 * Throws at first use if a runtime somehow lacks `globalThis.crypto`;
 * that's a platform bug, not a Studio bug.
 */

type WebCryptoRef = Crypto & {
  readonly randomUUID: () => string;
  readonly subtle: SubtleCrypto;
};

function resolve(): WebCryptoRef {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c === undefined) {
    throw new Error(
      "[studio-core] globalThis.crypto is not available. Require Node >=19 or a secure browser context.",
    );
  }
  if (typeof (c as { randomUUID?: unknown }).randomUUID !== "function") {
    throw new Error(
      "[studio-core] globalThis.crypto.randomUUID is not available. Require Node >=19 or a secure browser context.",
    );
  }
  return c as WebCryptoRef;
}

export const webCrypto: WebCryptoRef = resolve();

const hexTable: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += hexTable[bytes[i] as number];
  }
  return out;
}

/**
 * Synchronous-looking SHA-256 hex digest. The underlying `subtle.digest`
 * is async, so callers must await this.
 */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await webCrypto.subtle.digest("SHA-256", enc);
  return bytesToHex(new Uint8Array(buf));
}
