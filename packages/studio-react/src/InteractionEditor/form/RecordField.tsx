import { useState } from "react";
import { createInitialFormValue } from "../field-descriptor.js";
import { removeAtPath, setAtPath } from "../form-path-utils.js";
import {
  FieldChrome,
  arrayListStyle,
  arrayRowStyle,
  composeTrailing,
  emptyHintStyle,
  inputStyle,
  isPathHighlighted,
  isRecord,
  recordAddRowStyle,
  recordKeyStyle,
  smallBtnStyle,
} from "./shared.js";
import type { BaseFieldProps } from "./types.js";
import type { RecordDescriptor } from "../field-descriptor.js";

export function RecordField({
  descriptor,
  value,
  rootValue,
  path,
  label,
  disabled,
  presenceMode,
  highlightedPaths,
  trailing,
  onRootChange,
  renderField,
}: BaseFieldProps<RecordDescriptor>): JSX.Element {
  const obj = isRecord(value) ? value : {};
  const entries = Object.entries(obj);
  const [newKey, setNewKey] = useState("");
  const highlighted = isPathHighlighted(highlightedPaths, path);

  const addEntry = (): void => {
    const key = newKey.trim();
    if (key === "" || Object.prototype.hasOwnProperty.call(obj, key)) return;
    onRootChange(
      setAtPath(
        rootValue,
        [...path, key],
        createInitialFormValue(descriptor.value, {
          sparseOptional: presenceMode === "sparse-optional",
        }),
      ),
    );
    setNewKey("");
  };

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
      trailing={composeTrailing(trailing)}
      highlighted={highlighted}
    >
      <div style={arrayListStyle}>
        {entries.map(([key]) => (
          <div key={key} style={arrayRowStyle}>
            <div style={recordKeyStyle}>{key}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renderField({
                descriptor: descriptor.value,
                path: [...path, key],
                disabled,
                presenceMode,
                trailing: (
                  <button
                    type="button"
                    onClick={() =>
                      onRootChange(removeAtPath(rootValue, [...path, key]))
                    }
                    disabled={disabled}
                    style={smallBtnStyle}
                    aria-label={`Remove key ${key}`}
                  >
                    remove
                  </button>
                ),
              })}
            </div>
          </div>
        ))}
        {entries.length === 0 ? (
          <div style={emptyHintStyle}>(empty record)</div>
        ) : null}
        <div style={recordAddRowStyle}>
          <input
            type="text"
            placeholder="key"
            value={newKey}
            disabled={disabled}
            onChange={(event) => setNewKey(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addEntry();
            }}
            style={{ ...inputStyle(false), flex: "none", width: 120 }}
          />
          <button
            type="button"
            onClick={addEntry}
            disabled={disabled || newKey.trim() === ""}
            style={smallBtnStyle}
          >
            + add
          </button>
        </div>
      </div>
    </FieldChrome>
  );
}
