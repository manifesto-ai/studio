import { setAtPath } from "../form-path-utils.js";
import { useJsonDraft } from "../useJsonDraft.js";
import {
  FieldChrome,
  errorStyle,
  inputStyle,
  isPathHighlighted,
  makeId,
} from "./shared.js";
import type { BaseFieldProps } from "./types.js";
import type { JsonDescriptor } from "../field-descriptor.js";

export function JsonField({
  descriptor,
  value,
  rootValue,
  path,
  label,
  disabled,
  highlightedPaths,
  trailing,
  onRootChange,
}: BaseFieldProps<JsonDescriptor>): JSX.Element {
  const id = makeId(path, label);
  const highlighted = isPathHighlighted(highlightedPaths, path);
  const { draft, error, setDraft } = useJsonDraft({
    value,
    onCommit: (next) => onRootChange(setAtPath(rootValue, path, next)),
  });

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={
        descriptor.description ?? `Raw JSON fallback: ${descriptor.reason}`
      }
      labelFor={id}
      trailing={trailing}
      highlighted={highlighted}
    >
      <textarea
        id={id}
        value={draft}
        disabled={disabled}
        rows={4}
        onChange={(event) => setDraft(event.currentTarget.value)}
        style={{
          ...inputStyle(highlighted),
          fontFamily:
            'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)',
          minHeight: 60,
        }}
        spellCheck={false}
      />
      {error !== null ? <div style={errorStyle}>{error}</div> : null}
    </FieldChrome>
  );
}
