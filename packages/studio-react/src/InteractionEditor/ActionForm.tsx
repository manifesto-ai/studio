import type { ReactNode } from "react";
import {
  getAtPath,
  type FormPath,
} from "./form-path-utils.js";
import {
  ArrayField,
} from "./form/ArrayField.js";
import {
  EnumField,
} from "./form/EnumField.js";
import {
  JsonField,
} from "./form/JsonField.js";
import {
  ObjectField,
} from "./form/ObjectField.js";
import {
  PrimitiveField,
} from "./form/PrimitiveField.js";
import {
  RecordField,
} from "./form/RecordField.js";
import type {
  ActionFormPresenceMode,
  GetStringSuggestions,
  RenderField,
  RenderFieldInput,
} from "./form/types.js";
import type { FormDescriptor } from "./field-descriptor.js";

export type ActionFormProps = {
  readonly descriptor: FormDescriptor;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly path?: FormPath;
  readonly presenceMode?: ActionFormPresenceMode;
  readonly highlightedPaths?: ReadonlySet<string>;
  readonly getStringSuggestions?: GetStringSuggestions;
};

export function ActionForm({
  descriptor,
  value,
  onChange,
  label,
  disabled = false,
  path = [],
  presenceMode = "sparse-optional",
  highlightedPaths,
  getStringSuggestions,
}: ActionFormProps): JSX.Element {
  const renderField: RenderField = (input) => (
    <FieldRenderer
      key={input.path.join(":")}
      descriptor={input.descriptor}
      rootValue={value}
      path={input.path}
      label={input.label}
      disabled={input.disabled}
      presenceMode={input.presenceMode}
      highlightedPaths={highlightedPaths}
      getStringSuggestions={getStringSuggestions}
      trailing={input.trailing}
      onRootChange={onChange}
      renderField={renderField}
    />
  );

  return (
    <FieldRenderer
      descriptor={descriptor}
      rootValue={value}
      path={path}
      label={label}
      disabled={disabled}
      presenceMode={presenceMode}
      highlightedPaths={highlightedPaths}
      getStringSuggestions={getStringSuggestions}
      onRootChange={onChange}
      renderField={renderField}
    />
  );
}

function FieldRenderer({
  descriptor,
  rootValue,
  path,
  label,
  disabled,
  presenceMode,
  highlightedPaths,
  getStringSuggestions,
  trailing,
  onRootChange,
  renderField,
}: {
  readonly descriptor: FormDescriptor;
  readonly rootValue: unknown;
  readonly path: FormPath;
  readonly label?: string;
  readonly disabled: boolean;
  readonly presenceMode: ActionFormPresenceMode;
  readonly highlightedPaths?: ReadonlySet<string>;
  readonly getStringSuggestions?: GetStringSuggestions;
  readonly trailing?: ReactNode;
  readonly onRootChange: (next: unknown) => void;
  readonly renderField: RenderField;
}): JSX.Element {
  const value = path.length === 0 ? rootValue : getAtPath(rootValue, path);

  switch (descriptor.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return (
        <PrimitiveField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
    case "enum":
      return (
        <EnumField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
    case "object":
      return (
        <ObjectField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
    case "array":
      return (
        <ArrayField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
    case "record":
      return (
        <RecordField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
    case "json":
      return (
        <JsonField
          descriptor={descriptor}
          value={value}
          rootValue={rootValue}
          path={path}
          label={label}
          disabled={disabled}
          presenceMode={presenceMode}
          highlightedPaths={highlightedPaths}
          getStringSuggestions={getStringSuggestions}
          trailing={trailing}
          onRootChange={onRootChange}
          renderField={renderField}
        />
      );
  }
}
