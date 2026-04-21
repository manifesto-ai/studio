import { createInitialFormValue } from "../field-descriptor.js";
import { ensureAtPath, isPresentAtPath, removeAtPath, setAtPath } from "../form-path-utils.js";
import {
  FieldChrome,
  composeTrailing,
  emptyHintStyle,
  isPathHighlighted,
  nestedGroupStyle,
  optionalHintStyle,
  rootGroupStyle,
  smallBtnStyle,
  isRecord,
} from "./shared.js";
import type { BaseFieldProps } from "./types.js";
import type { ObjectDescriptor } from "../field-descriptor.js";
import { objectFillAll } from "./smart-fill.js";

export function ObjectField({
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
}: BaseFieldProps<ObjectDescriptor>): JSX.Element {
  const hiddenOptional =
    presenceMode === "sparse-optional"
      ? descriptor.fields.filter(
          (field) =>
            !field.descriptor.required &&
            !isPresentAtPath(rootValue, [...path, field.name]),
        )
      : [];
  const visibleFields = descriptor.fields.filter(
    (field) =>
      presenceMode !== "sparse-optional" ||
      field.descriptor.required ||
      isPresentAtPath(rootValue, [...path, field.name]),
  );
  const nested = path.length > 0 || label !== undefined;
  const highlighted = isPathHighlighted(highlightedPaths, path);
  const groupValue = isRecord(value) ? value : {};
  const hasChildren = visibleFields.length > 0 || hiddenOptional.length > 0;

  // "Fill all now" — only when ≥3 children are recognisable as
  // derivable (timestamps, uuids, etc.). Target: ClockStamp-shaped
  // objects where users shouldn't be typing 15 fields by hand.
  const labelPath = label !== undefined ? [...path, label] : [...path];
  const fillAll = objectFillAll(descriptor, labelPath, rootValue);
  const fillAllTrailing =
    fillAll !== null ? (
      <button
        type="button"
        onClick={() => onRootChange(setAtPath(rootValue, path, fillAll))}
        disabled={disabled}
        style={smallBtnStyle}
        title="Fill every recognisable field in this object with a fresh derived value (uuid, now, timezone, etc.)."
      >
        + fill all now
      </button>
    ) : null;

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
      trailing={composeTrailing(fillAllTrailing, trailing)}
      highlighted={highlighted}
    >
      <div style={nested ? nestedGroupStyle : rootGroupStyle}>
        {visibleFields.map((field) =>
          renderField({
            descriptor: field.descriptor,
            path: [...path, field.name],
            label: field.name,
            disabled,
            presenceMode,
            trailing:
              presenceMode === "sparse-optional" && !field.descriptor.required ? (
                <button
                  type="button"
                  onClick={() =>
                    onRootChange(removeAtPath(rootValue, [...path, field.name]))
                  }
                  disabled={disabled}
                  style={smallBtnStyle}
                >
                  remove
                </button>
              ) : undefined,
          }),
        )}

        {hiddenOptional.length > 0 ? (
          <div style={optionalHintStyle}>
            {hiddenOptional.map((field) => (
              <button
                key={field.name}
                type="button"
                onClick={() =>
                  onRootChange(
                    ensureAtPath(
                      rootValue,
                      [...path, field.name],
                      createInitialFormValue(field.descriptor, {
                        sparseOptional: true,
                      }),
                    ),
                  )
                }
                disabled={disabled}
                style={smallBtnStyle}
              >
                + {field.name}
              </button>
            ))}
          </div>
        ) : null}

        {!hasChildren ? (
          <div style={emptyHintStyle}>
            {Object.keys(groupValue).length === 0 ? "(empty object)" : null}
          </div>
        ) : null}
      </div>
    </FieldChrome>
  );
}
