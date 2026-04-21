export const MEL_LANGUAGE_ID = "manifesto-mel";

type MonacoDisposableLike = { dispose?: () => void };

type MonarchAction =
  | string
  | {
      token: string;
      next?: string;
      bracket?: "@open" | "@close";
    };

type MonarchRule = [RegExp, MonarchAction];

// Monaco's IMonarchLanguage types rule arrays as mutable; keeping them
// `readonly` here creates a contravariant-position incompatibility at
// call sites that pass the real `monaco` object in.
type MonarchTokenizer = Record<string, MonarchRule[]>;

// NOTE: these structural types intentionally use mutable collection
// shapes to match monaco-editor's real `IMonarchLanguage` /
// `LanguageConfiguration`. Contravariant-position incompatibilities
// appear the moment we mark these arrays/objects `readonly`.
type MonacoMonarchLanguage = {
  defaultToken: string;
  ignoreCase?: boolean;
  tokenizer: MonarchTokenizer;
};

type MonacoLanguageConfiguration = {
  comments?: {
    lineComment?: string;
    blockComment?: [string, string];
  };
  brackets?: [string, string][];
  autoClosingPairs?: {
    open: string;
    close: string;
  }[];
  surroundingPairs?: {
    open: string;
    close: string;
  }[];
};

export interface MonacoLanguageApiLike {
  readonly languages: {
    readonly register: (desc: {
      id: string;
      // These must stay mutable to match monaco-editor's real
      // ILanguageExtensionPoint shape; `readonly` here creates a
      // contravariant-position mismatch at the call site in App.tsx.
      extensions?: string[];
      aliases?: string[];
    }) => MonacoDisposableLike | void;
    readonly setMonarchTokensProvider: (
      languageId: string,
      languageDef: MonacoMonarchLanguage,
    ) => MonacoDisposableLike | void;
    readonly setLanguageConfiguration: (
      languageId: string,
      configuration: MonacoLanguageConfiguration,
    ) => MonacoDisposableLike | void;
  };
}

const registered = new WeakSet<object>();

const MEL_TOKENS: MonacoMonarchLanguage = {
  defaultToken: "identifier",
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", next: "@string" }],
      [/\b(?:available|dispatchable)\s+when\b/, "keyword.guard"],
      [/\b(?:domain|type|state|computed|action)\b/, "keyword"],
      [/\b(?:true|false|null)\b/, "constant.language"],
      [/\b\d+(?:\.\d+)?\b/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[|=,:.?]/, "operator"],
      [/[+\-*/<>!]+/, "operator"],
      [/[A-Za-z_][\w-]*/, "identifier"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", next: "@pop" }],
    ],
  },
};

const MEL_LANGUAGE_CONFIGURATION: MonacoLanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
};

export function registerMelLanguage(monaco: MonacoLanguageApiLike): void {
  if (registered.has(monaco as object)) return;
  registered.add(monaco as object);
  monaco.languages.register({
    id: MEL_LANGUAGE_ID,
    extensions: [".mel"],
    aliases: ["MEL", "Manifesto MEL"],
  });
  monaco.languages.setMonarchTokensProvider(MEL_LANGUAGE_ID, MEL_TOKENS);
  monaco.languages.setLanguageConfiguration(
    MEL_LANGUAGE_ID,
    MEL_LANGUAGE_CONFIGURATION,
  );
}
