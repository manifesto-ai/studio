import type {
  MelAuthorGuideChunk,
  MelAuthorGuideDocument,
  MelAuthorGuideHit,
  MelAuthorGuideIndex,
  MelAuthorGuideSearchInput,
  MelAuthorGuideSearchOutput,
} from "./types.js";

const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;
const EXCERPT_LENGTH = 1_000;

export function createMelAuthorGuideIndexFromDocuments(
  documents: readonly MelAuthorGuideDocument[],
): MelAuthorGuideIndex {
  return {
    chunks: documents.flatMap((document) => parseMarkdownChunks(document)),
  };
}

export function searchMelAuthorGuide(
  index: MelAuthorGuideIndex,
  input: MelAuthorGuideSearchInput,
): MelAuthorGuideSearchOutput {
  const query = input.query.trim();
  if (query === "") {
    return { query, hitCount: 0, hits: [] };
  }

  const limit = clampLimit(input.limit);
  const queryTokens = tokenize(query);
  const scored = index.chunks
    .filter((chunk) => input.source === undefined || chunk.source === input.source)
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, query, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.chunk.source !== right.chunk.source) {
        return sourceRank(left.chunk.source) - sourceRank(right.chunk.source);
      }
      return left.chunk.lineStart - right.chunk.lineStart;
    })
    .slice(0, limit);

  const hits: readonly MelAuthorGuideHit[] = scored.map(({ chunk, score }) => ({
    id: chunk.id,
    source: chunk.source,
    headingPath: chunk.headingPath,
    excerpt: createExcerpt(chunk.text, query, queryTokens),
    score,
    lineStart: chunk.lineStart,
    lineEnd: chunk.lineEnd,
  }));

  return { query, hitCount: hits.length, hits };
}

function parseMarkdownChunks(
  document: MelAuthorGuideDocument,
): readonly MelAuthorGuideChunk[] {
  const lines = document.text.replace(/\r\n/g, "\n").split("\n");
  const headings: string[] = [];
  const chunks: MelAuthorGuideChunk[] = [];
  let active:
    | {
        readonly headingPath: readonly string[];
        readonly startLine: number;
        readonly startIndex: number;
      }
    | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = parseHeading(lines[index] ?? "");
    if (heading === null) continue;

    if (active !== null) {
      chunks.push(
        createChunk(document, active.headingPath, active.startLine, index, lines),
      );
    }

    headings.length = heading.level - 1;
    headings[heading.level - 1] = heading.title;
    active = {
      headingPath: headings.filter(Boolean),
      startLine: index + 1,
      startIndex: index,
    };
  }

  if (active !== null) {
    chunks.push(
      createChunk(
        document,
        active.headingPath,
        active.startLine,
        lines.length,
        lines,
      ),
    );
  }

  return chunks.filter((chunk) => chunk.text.trim() !== "");
}

function createChunk(
  document: MelAuthorGuideDocument,
  headingPath: readonly string[],
  startLine: number,
  endIndexExclusive: number,
  lines: readonly string[],
): MelAuthorGuideChunk {
  const text = lines.slice(startLine - 1, endIndexExclusive).join("\n").trim();
  return {
    id: [
      document.source,
      slugify(headingPath.join("-")),
      String(startLine),
    ].join(":"),
    source: document.source,
    headingPath,
    text,
    lineStart: startLine,
    lineEnd: endIndexExclusive,
  };
}

function parseHeading(
  line: string,
): { readonly level: number; readonly title: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (match === null) return null;
  return {
    level: match[1]?.length ?? 1,
    title: stripMarkdown(match[2] ?? ""),
  };
}

function scoreChunk(
  chunk: MelAuthorGuideChunk,
  query: string,
  queryTokens: readonly string[],
): number {
  const heading = normalize(chunk.headingPath.join(" "));
  const text = normalize(chunk.text);
  const normalizedQuery = normalize(query);
  let score = 0;

  if (heading.includes(normalizedQuery)) score += 24;
  if (text.includes(normalizedQuery)) score += 12;

  for (const token of queryTokens) {
    if (token.length <= 1) continue;
    const headingCount = countToken(heading, token);
    const textCount = countToken(text, token);
    score += Math.min(headingCount, 3) * tokenWeight(token) * 4;
    score += Math.min(textCount, 8) * tokenWeight(token);
  }

  return score;
}

function createExcerpt(
  text: string,
  query: string,
  queryTokens: readonly string[],
): string {
  const normalizedText = normalize(text);
  const anchors = [normalize(query), ...queryTokens].filter(
    (anchor) => anchor.length > 0,
  );
  const firstMatch = anchors
    .map((anchor) => normalizedText.indexOf(anchor))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const center = firstMatch ?? 0;
  const start = Math.max(0, center - Math.floor(EXCERPT_LENGTH / 3));
  const end = Math.min(text.length, start + EXCERPT_LENGTH);
  const excerpt = text.slice(start, end).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${excerpt}${suffix}`;
}

function tokenize(value: string): readonly string[] {
  const matches = normalize(value).match(/\$?[a-z0-9_.$-]+/g) ?? [];
  return [...new Set(matches.map((token) => token.trim()).filter(Boolean))];
}

function countToken(text: string, token: string): number {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const next = text.indexOf(token, offset);
    if (next < 0) break;
    count += 1;
    offset = next + token.length;
  }
  return count;
}

function tokenWeight(token: string): number {
  if (/^e\d+$/i.test(token)) return 12;
  if (token.startsWith("$")) return 6;
  if (token.length >= 10) return 3;
  if (token.length >= 5) return 2;
  return 1;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function sourceRank(source: MelAuthorGuideChunk["source"]): number {
  if (source === "error") return 0;
  if (source === "reference") return 1;
  return 2;
}

function normalize(value: string): string {
  return stripMarkdown(value).toLowerCase();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .trim();
}

function slugify(value: string): string {
  const slug = normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "root" : slug.slice(0, 80);
}
