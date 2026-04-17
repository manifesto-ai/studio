import { randomUUID } from "node:crypto";

export function mintBuildId(): string {
  return randomUUID();
}
