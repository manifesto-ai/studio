import type * as monaco from "monaco-editor";

export const MEL_LANGUAGE_ID = "mel";

export const MEL_LANGUAGE_CONFIG: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
    blockComment: ["/*", "*/"]
  },
  brackets: [
    ["{", "}"],
    ["(", ")"],
    ["<", ">"]
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: "<", close: ">" },
    { open: '"', close: '"' },
    { open: "'", close: "'" }
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: "<", close: ">" },
    { open: '"', close: '"' }
  ],
  folding: {
    markers: {
      start: /^\s*\{/,
      end: /^\s*\}/
    }
  },
  indentationRules: {
    increaseIndentPattern: /\{\s*$/,
    decreaseIndentPattern: /^\s*\}/
  }
};

export const MEL_MONARCH_TOKENIZER: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".mel",

  keywords: [
    "domain",
    "state",
    "computed",
    "action",
    "type",
    "when",
    "once",
    "onceIntent",
    "patch",
    "effect",
    "fail",
    "stop",
    "available",
    "with",
    "unset",
    "merge",
    "import",
    "from",
    "export",
    "as"
  ],

  typeKeywords: [
    "string",
    "number",
    "boolean",
    "null",
    "Array",
    "Record"
  ],

  builtinFunctions: [
    "and",
    "or",
    "not",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "add",
    "sub",
    "mul",
    "div",
    "mod",
    "abs",
    "min",
    "max",
    "floor",
    "ceil",
    "round",
    "len",
    "isEmpty",
    "contains",
    "startsWith",
    "endsWith",
    "concat",
    "join",
    "split",
    "trim",
    "toLower",
    "toUpper",
    "toString",
    "toNumber",
    "if",
    "coalesce",
    "keys",
    "values",
    "entries",
    "at",
    "first",
    "last",
    "slice",
    "flat",
    "find",
    "filter",
    "map",
    "every",
    "some",
    "count",
    "sum",
    "sort",
    "reverse",
    "unique",
    "groupBy",
    "flatMap",
    "partition",
    "mapValues",
    "fromEntries",
    "push",
    "append",
    "prepend",
    "remove",
    "removeAt",
    "set",
    "omit",
    "pick",
    "mergeDeep",
    "now"
  ],

  constants: ["true", "false"],

  operators: ["=", ",", ".", ":"],

  symbols: /[=,.:;<>]/,

  tokenizer: {
    root: [
      // system identifiers ($system, $meta, $input, $item)
      [/\$[a-zA-Z_][\w.]*/, "variable.predefined"],

      // identifiers and keywords
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "type",
            "@builtinFunctions": "support.function",
            "@constants": "constant.language",
            "@default": "identifier"
          }
        }
      ],

      // whitespace
      { include: "@whitespace" },

      // numbers
      [/\d+(\.\d+)?/, "number"],

      // strings
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string_double"],
      [/'([^'\\]|\\.)*$/, "string.invalid"],
      [/'/, "string", "@string_single"],

      // delimiters and operators
      [/[{}()]/, "@brackets"],
      [/</, "@brackets"],
      [/>/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "delimiter", "@default": "" } }]
    ],

    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"]
    ],

    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"]
    ],

    string_double: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"]
    ],

    string_single: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/'/, "string", "@pop"]
    ]
  }
};

let registered = false;

export function registerMelLanguage(monacoInstance: typeof monaco): void {
  if (registered) {
    return;
  }

  monacoInstance.languages.register({
    id: MEL_LANGUAGE_ID,
    extensions: [".mel"],
    aliases: ["MEL", "mel"]
  });

  monacoInstance.languages.setMonarchTokensProvider(
    MEL_LANGUAGE_ID,
    MEL_MONARCH_TOKENIZER
  );

  monacoInstance.languages.setLanguageConfiguration(
    MEL_LANGUAGE_ID,
    MEL_LANGUAGE_CONFIG
  );

  registered = true;
}
