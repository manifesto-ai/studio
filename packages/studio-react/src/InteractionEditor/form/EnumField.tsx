import type { BaseFieldProps } from "./types.js";
import { setAtPath } from "../form-path-utils.js";
import {
  FieldChrome,
  inputStyle,
  isPathHighlighted,
  makeId,
} from "./shared.js";
import type { EnumDescriptor } from "../field-descriptor.js";

export function EnumField({
  descriptor,
  value,
  rootValue,
  path,
  label,
  disabled,
  highlightedPaths,
  trailing,
  onRootChange,
}: BaseFieldProps<EnumDescriptor>): JSX.Element {
  const id = makeId(path, label);
  const highlighted = isPathHighlighted(highlightedPaths, path);
  const stringValue = value === null ? "__null__" : String(value);

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      labelFor={id}
      trailing={trailing}
      highlighted={highlighted}
    >
      <select
        id={id}
        value={stringValue}
        disabled={disabled || descriptor.options.length === 0}
        onChange={(event) => {
          const picked = descriptor.options.find((option) => {
            const serialized =
              option.value === null ? "__null__" : String(option.value);
            return serialized === event.currentTarget.value;
          });
          if (picked === undefined) return;
          onRootChange(setAtPath(rootValue, path, picked.value));
        }}
        style={{ ...inputStyle(highlighted), appearance: "none" }}
      >
        {descriptor.options.map((option) => {
          const optionValue =
            option.value === null ? "__null__" : String(option.value);
          return (
            <option key={optionValue} value={optionValue}>
              {option.label}
            </option>
          );
        })}
      </select>
    </FieldChrome>
  );
}
