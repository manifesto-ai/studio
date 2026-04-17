import { describe, expect, it, vi } from "vitest";
import {
  MEL_LANGUAGE_ID,
  registerMelLanguage,
  type MonacoLanguageApiLike,
} from "../language.js";

function makeFakeMonaco(): {
  readonly monaco: MonacoLanguageApiLike;
  readonly register: ReturnType<typeof vi.fn>;
  readonly setTokens: ReturnType<typeof vi.fn>;
  readonly setConfig: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn();
  const setTokens = vi.fn();
  const setConfig = vi.fn();
  return {
    monaco: {
      languages: {
        register,
        setMonarchTokensProvider: setTokens,
        setLanguageConfiguration: setConfig,
      },
    },
    register,
    setTokens,
    setConfig,
  };
}

describe("registerMelLanguage", () => {
  it("registers the MEL language with a Monarch tokenizer and config", () => {
    const fake = makeFakeMonaco();

    registerMelLanguage(fake.monaco);

    expect(fake.register).toHaveBeenCalledTimes(1);
    expect(fake.register).toHaveBeenCalledWith({
      id: MEL_LANGUAGE_ID,
      extensions: [".mel"],
      aliases: ["MEL", "Manifesto MEL"],
    });
    expect(fake.setTokens).toHaveBeenCalledTimes(1);
    expect(fake.setTokens.mock.calls[0]?.[0]).toBe(MEL_LANGUAGE_ID);
    expect(fake.setTokens.mock.calls[0]?.[1]).toMatchObject({
      defaultToken: "identifier",
      tokenizer: {
        root: expect.any(Array),
      },
    });
    expect(fake.setConfig).toHaveBeenCalledTimes(1);
    expect(fake.setConfig.mock.calls[0]?.[0]).toBe(MEL_LANGUAGE_ID);
    expect(fake.setConfig.mock.calls[0]?.[1]).toMatchObject({
      comments: { lineComment: "//" },
      autoClosingPairs: expect.any(Array),
    });
  });

  it("is idempotent per Monaco namespace", () => {
    const fake = makeFakeMonaco();

    registerMelLanguage(fake.monaco);
    registerMelLanguage(fake.monaco);

    expect(fake.register).toHaveBeenCalledTimes(1);
    expect(fake.setTokens).toHaveBeenCalledTimes(1);
    expect(fake.setConfig).toHaveBeenCalledTimes(1);
  });

  it("allows registering against a second Monaco namespace", () => {
    const first = makeFakeMonaco();
    const second = makeFakeMonaco();

    registerMelLanguage(first.monaco);
    registerMelLanguage(second.monaco);

    expect(first.register).toHaveBeenCalledTimes(1);
    expect(second.register).toHaveBeenCalledTimes(1);
  });
});
