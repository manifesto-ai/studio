export {
  main,
  parseCliArgs,
  type CliParseResult,
  type ParsedCliCommand,
} from "./cli.js";
export {
  readAuthorModelConfig,
  resolveAuthorModel,
  normalizeOllamaBaseURL,
  type AuthorModelConfig,
  type AuthorModelProvider,
  type ResolvedAuthorModel,
} from "./model.js";
export {
  runMelAuthorAgent,
  type GenerateAuthorText,
  type MelAuthorCliRunInput,
  type MelAuthorCliRunReport,
  type MelAuthorCliStrategy,
} from "./runner.js";
