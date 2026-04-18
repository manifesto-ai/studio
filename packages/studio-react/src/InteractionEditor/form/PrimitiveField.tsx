import type { CSSProperties } from "react";
import type { BaseFieldProps } from "./types.js";
import { setAtPath } from "../form-path-utils.js";
import {
  FieldChrome,
  inputStyle,
  isPathHighlighted,
  makeId,
} from "./shared.js";
import type { PrimitiveDescriptor } from "../field-descriptor.js";

export function PrimitiveField({
  descriptor,
  value,
  rootValue,
  path,
  label,
  disabled,
  highlightedPaths,
  getStringSuggestions,
  trailing,
  onRootChange,
}: BaseFieldProps<PrimitiveDescriptor>): JSX.Element {
  const id = makeId(path, label);
  const highlighted = isPathHighlighted(highlightedPaths, path);

  if (descriptor.kind === "null") {
    return (
      <FieldChrome
        label={label}
        required={descriptor.required}
        description={descriptor.description}
        trailing={trailing}
        highlighted={highlighted}
      >
        <div style={nullBoxStyle}>null</div>
      </FieldChrome>
    );
  }

  if (descriptor.kind === "boolean") {
    return (
      <FieldChrome
        label={label}
        required={descriptor.required}
        description={descriptor.description}
        labelFor={id}
        trailing={trailing}
        highlighted={highlighted}
      >
        <label style={checkboxRowStyle}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) =>
              onRootChange(
                setAtPath(rootValue, path, event.currentTarget.checked),
              )}
            style={checkboxStyle}
          />
          <span style={checkboxLabelStyle}>
            {value === true ? "true" : "false"}
          </span>
        </label>
      </FieldChrome>
    );
  }

  if (descriptor.kind === "number") {
    const numberValue =
      typeof value === "number" && Number.isFinite(value) ? value : "";
    return (
      <FieldChrome
        label={label}
        required={descriptor.required}
        description={descriptor.description}
        labelFor={id}
        trailing={trailing}
        highlighted={highlighted}
      >
        <input
          id={id}
          type="number"
          value={numberValue}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            if (raw === "") {
              onRootChange(setAtPath(rootValue, path, null));
              return;
            }
            const parsed = Number(raw);
            onRootChange(
              setAtPath(rootValue, path, Number.isFinite(parsed) ? parsed : raw),
            );
          }}
          style={inputStyle(highlighted)}
        />
      </FieldChrome>
    );
  }

  const stringValue = typeof value === "string" ? value : "";
  const suggestions = getStringSuggestions?.({
    descriptor,
    path,
    label,
    value,
  }) ?? [];
  const listId = suggestions.length > 0 ? `${id}-suggestions` : undefined;

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      labelFor={id}
      trailing={trailing}
      highlighted={highlighted}
    >
      <input
        id={id}
        type="text"
        value={stringValue}
        disabled={disabled}
        onChange={(event) =>
          onRootChange(setAtPath(rootValue, path, event.currentTarget.value))
        }
        list={listId}
        placeholder={
          descriptor.defaultValue === undefined
            ? undefined
            : String(descriptor.defaultValue)
        }
        style={inputStyle(highlighted)}
      />
      {listId !== undefined ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </FieldChrome>
  );
}

const nullBoxStyle: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 4,
  background: "var(--color-void, #0B1020)",
  border: "1px solid var(--color-rule, #334155)",
  color: "var(--color-ink-dim, #95A3B8)",
  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
  fontSize: 12,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const checkboxStyle: CSSProperties = {
  width: 14,
  height: 14,
  accentColor: "var(--color-violet-hot, #63B3FC)",
};

const checkboxLabelStyle: CSSProperties = {
  color: "var(--color-ink-dim, #95A3B8)",
  fontSize: 12,
};
