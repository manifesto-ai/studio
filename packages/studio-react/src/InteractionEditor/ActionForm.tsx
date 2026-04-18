import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import type {
  ArrayDescriptor,
  EnumDescriptor,
  FormDescriptor,
  JsonDescriptor,
  ObjectDescriptor,
  PrimitiveDescriptor,
  RecordDescriptor,
} from "./field-descriptor.js";
import { defaultValueFor } from "./field-descriptor.js";

export type ActionFormProps = {
  readonly descriptor: FormDescriptor;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  /** Breadcrumb path for nested fields. Used for IDs and aria labels. */
  readonly path?: readonly string[];
};

/**
 * Recursive form renderer. Caller owns `value` state; this component
 * emits fully-resolved object/array values through `onChange`.
 */
export function ActionForm(props: ActionFormProps): JSX.Element {
  const {
    descriptor,
    value,
    onChange,
    label,
    disabled = false,
    path = [],
  } = props;

  switch (descriptor.kind) {
    case "string":
    case "number":
    case "boolean":
    case "null":
      return (
        <PrimitiveField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
    case "enum":
      return (
        <EnumField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
    case "object":
      return (
        <ObjectField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
    case "array":
      return (
        <ArrayField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
    case "record":
      return (
        <RecordField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
    case "json":
      return (
        <JsonField
          descriptor={descriptor}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
          path={path}
        />
      );
  }
}

type FieldCommonProps<D extends FormDescriptor> = {
  readonly descriptor: D;
  readonly value: unknown;
  readonly onChange: (next: unknown) => void;
  readonly label?: string;
  readonly disabled: boolean;
  readonly path: readonly string[];
};

function PrimitiveField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<PrimitiveDescriptor>): JSX.Element {
  const id = makeId(path, label);

  if (descriptor.kind === "null") {
    return (
      <FieldChrome label={label} required={descriptor.required} description={descriptor.description}>
        <div style={nullBoxStyle}>null</div>
      </FieldChrome>
    );
  }

  if (descriptor.kind === "boolean") {
    const checked = value === true;
    return (
      <FieldChrome
        label={label}
        required={descriptor.required}
        description={descriptor.description}
        labelFor={id}
      >
        <label style={checkboxRowStyle}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.currentTarget.checked)}
            style={checkboxStyle}
          />
          <span style={{ color: COLORS.textDim }}>{checked ? "true" : "false"}</span>
        </label>
      </FieldChrome>
    );
  }

  if (descriptor.kind === "number") {
    const numberValue = typeof value === "number" && Number.isFinite(value) ? value : "";
    return (
      <FieldChrome
        label={label}
        required={descriptor.required}
        description={descriptor.description}
        labelFor={id}
      >
        <input
          id={id}
          type="number"
          value={numberValue}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const raw = e.currentTarget.value;
            if (raw === "") onChange(null);
            else {
              const parsed = Number(raw);
              onChange(Number.isFinite(parsed) ? parsed : raw);
            }
          }}
          style={inputStyle}
        />
      </FieldChrome>
    );
  }

  // string
  const stringValue = typeof value === "string" ? value : "";
  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      labelFor={id}
    >
      <input
        id={id}
        type="text"
        value={stringValue}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={
          descriptor.defaultValue === undefined
            ? undefined
            : String(descriptor.defaultValue)
        }
        style={inputStyle}
      />
    </FieldChrome>
  );
}

function EnumField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<EnumDescriptor>): JSX.Element {
  const id = makeId(path, label);
  const stringValue = value === null ? "__null__" : String(value);
  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      labelFor={id}
    >
      <select
        id={id}
        value={stringValue}
        disabled={disabled || descriptor.options.length === 0}
        onChange={(e) => {
          const picked = descriptor.options.find((o) => {
            const serialized = o.value === null ? "__null__" : String(o.value);
            return serialized === e.currentTarget.value;
          });
          if (picked !== undefined) onChange(picked.value);
        }}
        style={{ ...inputStyle, appearance: "none" }}
      >
        {descriptor.options.map((o) => (
          <option
            key={o.value === null ? "__null__" : String(o.value)}
            value={o.value === null ? "__null__" : String(o.value)}
          >
            {o.label}
          </option>
        ))}
      </select>
    </FieldChrome>
  );
}

function ObjectField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<ObjectDescriptor>): JSX.Element {
  const obj = isRecord(value) ? value : {};
  const updateField = (name: string, next: unknown): void => {
    onChange({ ...obj, [name]: next });
  };
  const nested = path.length > 0 || label !== undefined;
  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
    >
      <div style={nested ? nestedGroupStyle : rootGroupStyle}>
        {descriptor.fields.map((f) => (
          <ActionForm
            key={f.name}
            descriptor={f.descriptor}
            value={obj[f.name]}
            onChange={(next) => updateField(f.name, next)}
            label={f.name}
            disabled={disabled}
            path={[...path, f.name]}
          />
        ))}
        {descriptor.fields.length === 0 ? (
          <div style={emptyHintStyle}>(empty object)</div>
        ) : null}
      </div>
    </FieldChrome>
  );
}

function ArrayField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<ArrayDescriptor>): JSX.Element {
  const list = Array.isArray(value) ? value : [];
  const push = (): void => onChange([...list, defaultValueFor(descriptor.item)]);
  const removeAt = (i: number): void => {
    const next = list.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const setAt = (i: number, v: unknown): void => {
    const next = list.slice();
    next[i] = v;
    onChange(next);
  };
  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
      trailing={
        <button
          type="button"
          onClick={push}
          disabled={disabled}
          style={smallBtnStyle}
          aria-label={`Add item to ${label ?? "array"}`}
        >
          + add
        </button>
      }
    >
      <div style={arrayListStyle}>
        {list.map((item, i) => (
          <div key={i} style={arrayRowStyle}>
            <ActionForm
              descriptor={descriptor.item}
              value={item}
              onChange={(next) => setAt(i, next)}
              label={`[${i}]`}
              disabled={disabled}
              path={[...path, String(i)]}
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              disabled={disabled}
              style={{ ...smallBtnStyle, color: COLORS.err }}
              aria-label={`Remove item ${i}`}
            >
              ×
            </button>
          </div>
        ))}
        {list.length === 0 ? (
          <div style={emptyHintStyle}>(empty — click “+ add” to append)</div>
        ) : null}
      </div>
    </FieldChrome>
  );
}

function RecordField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<RecordDescriptor>): JSX.Element {
  const obj = isRecord(value) ? value : {};
  const entries = Object.entries(obj);
  const [newKey, setNewKey] = useState("");
  const addEntry = (): void => {
    const k = newKey.trim();
    if (k === "" || Object.prototype.hasOwnProperty.call(obj, k)) return;
    onChange({ ...obj, [k]: defaultValueFor(descriptor.value) });
    setNewKey("");
  };
  const updateEntry = (k: string, v: unknown): void => {
    onChange({ ...obj, [k]: v });
  };
  const removeEntry = (k: string): void => {
    const next: Record<string, unknown> = { ...obj };
    delete next[k];
    onChange(next);
  };
  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={descriptor.description}
      asGroup
    >
      <div style={arrayListStyle}>
        {entries.map(([k, v]) => (
          <div key={k} style={arrayRowStyle}>
            <div style={recordKeyStyle}>{k}</div>
            <ActionForm
              descriptor={descriptor.value}
              value={v}
              onChange={(next) => updateEntry(k, next)}
              label={undefined}
              disabled={disabled}
              path={[...path, k]}
            />
            <button
              type="button"
              onClick={() => removeEntry(k)}
              disabled={disabled}
              style={{ ...smallBtnStyle, color: COLORS.err }}
              aria-label={`Remove key ${k}`}
            >
              ×
            </button>
          </div>
        ))}
        <div style={recordAddRowStyle}>
          <input
            type="text"
            placeholder="key"
            value={newKey}
            disabled={disabled}
            onChange={(e) => setNewKey(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addEntry();
                e.preventDefault();
              }
            }}
            style={{ ...inputStyle, flex: "none", width: 120 }}
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

function JsonField({
  descriptor,
  value,
  onChange,
  label,
  disabled,
  path,
}: FieldCommonProps<JsonDescriptor>): JSX.Element {
  const id = makeId(path, label);
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);
  const [draft, setDraft] = useState<string>(serialized);
  const [error, setError] = useState<string | null>(null);

  // Keep draft in sync when the underlying value changes externally.
  const prevSerialized = useMemo(() => serialized, [serialized]);
  useMemo(() => {
    if (prevSerialized !== draft && prevSerialized !== "") {
      setDraft(prevSerialized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevSerialized]);

  const commit = useCallback(
    (next: string) => {
      if (next.trim() === "") {
        setError(null);
        onChange(null);
        return;
      }
      try {
        const parsed = JSON.parse(next) as unknown;
        setError(null);
        onChange(parsed);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [onChange],
  );

  return (
    <FieldChrome
      label={label}
      required={descriptor.required}
      description={
        descriptor.description ??
        `Raw JSON fallback: ${descriptor.reason}`
      }
      labelFor={id}
    >
      <textarea
        id={id}
        value={draft}
        disabled={disabled}
        rows={4}
        onChange={(e) => {
          setDraft(e.currentTarget.value);
          commit(e.currentTarget.value);
        }}
        style={{ ...inputStyle, fontFamily: MONO_STACK, minHeight: 60 }}
        spellCheck={false}
      />
      {error !== null ? <div style={errorStyle}>{error}</div> : null}
    </FieldChrome>
  );
}

function FieldChrome({
  label,
  required,
  description,
  labelFor,
  children,
  asGroup = false,
  trailing,
}: {
  readonly label?: string;
  readonly required: boolean;
  readonly description?: string;
  readonly labelFor?: string;
  readonly children: React.ReactNode;
  readonly asGroup?: boolean;
  readonly trailing?: React.ReactNode;
}): JSX.Element {
  return (
    <div style={asGroup ? groupChromeStyle : fieldChromeStyle}>
      {label !== undefined ? (
        <div style={labelRowStyle}>
          {labelFor !== undefined ? (
            <label htmlFor={labelFor} style={labelStyle}>
              {label}
              {required ? <span style={requiredStyle}>*</span> : null}
            </label>
          ) : (
            <span style={labelStyle}>
              {label}
              {required ? <span style={requiredStyle}>*</span> : null}
            </span>
          )}
          {trailing}
        </div>
      ) : null}
      {description !== undefined && description.length > 0 ? (
        <div style={descriptionStyle}>{description}</div>
      ) : null}
      {children}
    </div>
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function makeId(path: readonly string[], label: string | undefined): string {
  const parts = label !== undefined ? [...path, label] : path;
  return `form-${parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

const fieldChromeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontFamily: FONT_STACK,
  fontSize: 12,
  color: COLORS.text,
};

const groupChromeStyle: CSSProperties = {
  ...fieldChromeStyle,
  padding: "8px 10px",
  borderRadius: 6,
  background: COLORS.panelAlt,
  border: `1px solid ${COLORS.line}`,
};

const nestedGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 4,
};

const rootGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const labelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: COLORS.textDim,
  letterSpacing: 0.4,
};

const requiredStyle: CSSProperties = {
  color: COLORS.err,
  marginLeft: 2,
};

const descriptionStyle: CSSProperties = {
  fontSize: 10.5,
  color: COLORS.muted,
  marginTop: -2,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 12,
  background: COLORS.bg,
  color: COLORS.text,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  outline: "none",
  fontFamily: FONT_STACK,
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  cursor: "pointer",
};

const checkboxStyle: CSSProperties = {
  width: 14,
  height: 14,
  accentColor: COLORS.accent,
};

const nullBoxStyle: CSSProperties = {
  padding: "4px 8px",
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.muted,
  background: COLORS.bg,
  border: `1px dashed ${COLORS.line}`,
  borderRadius: 4,
  display: "inline-block",
};

const arrayListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const arrayRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 6,
};

const recordKeyStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 11,
  color: COLORS.textDim,
  alignSelf: "center",
  minWidth: 80,
};

const recordAddRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
};

const smallBtnStyle: CSSProperties = {
  background: COLORS.surface,
  color: COLORS.text,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: FONT_STACK,
};

const emptyHintStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
};

const errorStyle: CSSProperties = {
  color: COLORS.err,
  fontSize: 11,
  fontFamily: MONO_STACK,
};
