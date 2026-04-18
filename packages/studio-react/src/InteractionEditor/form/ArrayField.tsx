import { createInitialFormValue } from "../field-descriptor.js";
import { removeAtPath, setAtPath } from "../form-path-utils.js";
import {
  FieldChrome,
  arrayListStyle,
  composeTrailing,
  emptyHintStyle,
  isPathHighlighted,
  smallBtnStyle,
} from "./shared.js";
import type { BaseFieldProps } from "./types.js";
import type { ArrayDescriptor } from "../field-descriptor.js";

export function ArrayField({
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
}: BaseFieldProps<ArrayDescriptor>): JSX.Element {
  const list = Array.isArray(value) ? value : [];
  const highlighted = isPathHighlighted(highlightedPaths, path);

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
      trailing={composeTrailing(
        trailing,
        <button
          key="add-array-item"
          type="button"
          onClick={() =>
            onRootChange(
              setAtPath(
                rootValue,
                [...path, list.length],
                createInitialFormValue(descriptor.item, {
                  sparseOptional: presenceMode === "sparse-optional",
                }),
              ),
            )
          }
          disabled={disabled}
          style={smallBtnStyle}
          aria-label={`Add item to ${label ?? "array"}`}
        >
          + add
        </button>,
      )}
      highlighted={highlighted}
    >
      <div style={arrayListStyle}>
        {list.map((_, index) =>
          renderField({
            descriptor: descriptor.item,
            path: [...path, index],
            label: `[${index}]`,
            disabled,
            presenceMode,
            trailing: (
              <button
                type="button"
                onClick={() =>
                  onRootChange(removeAtPath(rootValue, [...path, index]))
                }
                disabled={disabled}
                style={smallBtnStyle}
                aria-label={`Remove item ${index}`}
              >
                remove
              </button>
            ),
          }),
        )}
        {list.length === 0 ? (
          <div style={emptyHintStyle}>(empty — click “+ add” to append)</div>
        ) : null}
      </div>
    </FieldChrome>
  );
}
