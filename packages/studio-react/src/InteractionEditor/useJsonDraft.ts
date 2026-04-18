import { useCallback, useEffect, useMemo, useState } from "react";

export type UseJsonDraftOptions = {
  readonly value: unknown;
  readonly onCommit: (next: unknown) => void;
};

export type UseJsonDraftValue = {
  readonly draft: string;
  readonly error: string | null;
  readonly setDraft: (next: string) => void;
};

export function useJsonDraft({
  value,
  onCommit,
}: UseJsonDraftOptions): UseJsonDraftValue {
  const serialized = useMemo(() => stringifyJson(value), [value]);
  const [draft, setDraftState] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftState(serialized);
    setError(null);
  }, [serialized]);

  const setDraft = useCallback(
    (next: string) => {
      setDraftState(next);
      if (next.trim() === "") {
        setError(null);
        onCommit(null);
        return;
      }
      try {
        const parsed = JSON.parse(next) as unknown;
        setError(null);
        onCommit(parsed);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onCommit],
  );

  return { draft, error, setDraft };
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
