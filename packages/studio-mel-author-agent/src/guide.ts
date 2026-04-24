import { readFileSync } from "node:fs";
import {
  createMelAuthorGuideIndexFromDocuments,
  searchMelAuthorGuide,
} from "./guide-search.js";
import type {
  MelAuthorGuideDocument,
  MelAuthorGuideIndex,
  MelAuthorGuideSearchInput,
  MelAuthorGuideSearchOutput,
} from "./types.js";

const GUIDE_FILES: readonly {
  readonly source: MelAuthorGuideDocument["source"];
  readonly path: string;
}[] = [
  { source: "reference", path: "../knowledge/reference.md" },
  { source: "syntax", path: "../knowledge/syntax.md" },
  { source: "error", path: "../knowledge/error-guide.md" },
];

let bundledIndex: MelAuthorGuideIndex | null = null;

export function createMelAuthorGuideIndex(): MelAuthorGuideIndex {
  if (bundledIndex !== null) return bundledIndex;
  const documents = GUIDE_FILES.map((file): MelAuthorGuideDocument => {
    const url = new URL(file.path, import.meta.url);
    return {
      source: file.source,
      text: readFileSync(url, "utf8"),
    };
  });
  bundledIndex = createMelAuthorGuideIndexFromDocuments(documents);
  return bundledIndex;
}

export function searchBundledMelAuthorGuide(
  input: MelAuthorGuideSearchInput,
): MelAuthorGuideSearchOutput {
  return searchMelAuthorGuide(createMelAuthorGuideIndex(), input);
}

export {
  createMelAuthorGuideIndexFromDocuments,
  searchMelAuthorGuide,
} from "./guide-search.js";
export type {
  MelAuthorGuideChunk,
  MelAuthorGuideDocument,
  MelAuthorGuideHit,
  MelAuthorGuideIndex,
  MelAuthorGuideSearchInput,
  MelAuthorGuideSearchOutput,
  MelAuthorGuideSource,
} from "./types.js";
