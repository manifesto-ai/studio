import type { ReactNode } from "react";
import type {
  FormDescriptor,
  PrimitiveDescriptor,
} from "../field-descriptor.js";
import type { FormPath } from "../form-path-utils.js";

export type ActionFormPresenceMode = "sparse-optional";

export type GetStringSuggestions = (input: {
  readonly descriptor: PrimitiveDescriptor & { readonly kind: "string" };
  readonly path: FormPath;
  readonly label?: string;
  readonly value: unknown;
}) => readonly string[];

export type RenderFieldInput = {
  readonly descriptor: FormDescriptor;
  readonly path: FormPath;
  readonly label?: string;
  readonly disabled: boolean;
  readonly presenceMode: ActionFormPresenceMode;
  readonly trailing?: ReactNode;
};

export type RenderField = (input: RenderFieldInput) => JSX.Element;

export type BaseFieldProps<D extends FormDescriptor> = {
  readonly descriptor: D;
  readonly value: unknown;
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
};
