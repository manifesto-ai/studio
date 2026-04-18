export const MEL_LANGUAGE_ID = "manifesto-mel";

type MonacoDisposableLike = { dispose?: () => void };

type MonarchAction =
  | string
  | {
      token: string;
      next?: string;
      bracket?: "@open" | "@close";
    };

type MonarchRule = readonly [RegExp, MonarchAction];

type MonarchTokenizer = Record<string, readonly MonarchRule[]>;

type MonacoMonarchLanguage = {
  readonly defaultToken: string;
  readonly ignoreCase?: boolean;
  readonly tokenizer: MonarchTokenizer;
};

type MonacoLanguageConfiguration = {
  readonly comments?: {
    readonly lineComment?: string;
    readonly blockComment?: readonly [string, string];
  };
  readonly brackets?: readonly (readonly [string, string])[];
  readonly autoClosingPairs?: readonly {
    readonly open: string;
    readonly close: string;
  }[];
  readonly surroundingPairs?: readonly {
    readonly open: string;
    readonly close: string;
  }[];
};

export interface MonacoLanguageApiLike {
  readonly languages: {
    readonly register: (desc: {
      id: string;
      extensions?: readonly string[];
      aliases?: readonly string[];
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
