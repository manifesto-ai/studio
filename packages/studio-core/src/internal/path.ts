import type { PatchPath } from "@manifesto-ai/core";

export function patchPathToSemanticPath(path: PatchPath): string {
  return path
    .map((segment) =>
      segment.kind === "prop" ? segment.name : `[${segment.index}]`
    )
    .reduce<string>((acc, segment) => {
      if (segment.startsWith("[")) {
        return `${acc}${segment}`;
      }

      return acc ? `${acc}.${segment}` : segment;
    }, "");
}

export function topLevelPath(path: string): string {
  const [root] = path.split(".");

  return root.replace(/\[.*$/, "");
}

