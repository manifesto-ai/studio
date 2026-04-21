import { webCrypto } from "./web-crypto.js";

export function mintBuildId(): string {
  return webCrypto.randomUUID();
}
