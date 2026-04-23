/**
 * MockDataPalette — human-facing UI for the same generator the agent
 * uses (`generate.ts`). Lives inside the Interact lens: the caller
 * hands in the action that's already picked there, and this
 * component just drives Count / Seed / Preview / Dispatch. No second
 * action selector — forcing the user to re-pick the thing they just
 * clicked is the wrong kind of ceremony.
 *
 * If no action is given (nothing focused in Interact), the button is
 * disabled. The fix is to pick an action in the main UI, not to
 * expose another picker here.
 *
 * Architectural note: this component imports the pure generator
 * directly — no agent plumbing in the path. The agent's tool and
 * this UI are two consumers of the same function.
 */
import { useCallback, useState } from "react";
import { useStudio } from "@manifesto-ai/studio-react";
import type { StudioCore } from "@manifesto-ai/studio-core";
import {
  generateForAction,
  type GenerateForActionResult,
} from "./generate.js";

type DispatchState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly done: number; readonly total: number }
  | {
      readonly kind: "done";
      readonly successCount: number;
      readonly rejectedCount: number;
      readonly errorCount: number;
    };

export type MockDataPaletteProps = {
  /**
   * The action to generate mock data for. Typical caller is the
   * Interact lens, which hands in its `focusedActionName`. When
   * `null`, the button is disabled — the user should pick an action
   * in the surrounding UI rather than in this popover.
   */
  readonly action: string | null;
  /** Override the button label. Defaults to "🎲 Mock". */
  readonly buttonLabel?: string;
};

export function MockDataPalette({
  action,
  buttonLabel = "🎲 Mock",
}: MockDataPaletteProps): JSX.Element | null {
  const { core, module: mod } = useStudio();
  const [open, setOpen] = useState(false);

  if (mod === null) return null;
  const actionExists =
    action !== null &&
    Object.prototype.hasOwnProperty.call(
      (mod.schema as { actions?: Record<string, unknown> }).actions ?? {},
      action,
    );

  return (
    // `relative` so the popover positions against the button's own
    // bounding box (top-100% + right-0), not whatever ancestor
    // happens to be positioned. Without this the popover escapes to
    // Panel and lands way off screen.
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={!actionExists}
        title={
          actionExists
            ? `Generate mock data for ${action}`
            : "Pick an action in Interact first"
        }
        className="
          px-2 py-1 rounded-md text-[11px] font-sans
          border border-[var(--color-rule)]
          bg-[var(--color-glass)]
          text-[var(--color-ink-dim)]
          hover:text-[var(--color-ink)]
          hover:border-[var(--color-glass-edge-hot)]
          disabled:opacity-50 disabled:cursor-not-allowed
          disabled:hover:text-[var(--color-ink-dim)]
          disabled:hover:border-[var(--color-rule)]
          transition-colors
        "
      >
        {buttonLabel}
      </button>
      {open && actionExists ? (
        <MockDataPopover
          core={core}
          action={action!}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MockDataPopover({
  core,
  action,
  onClose,
}: {
  readonly core: StudioCore;
  readonly action: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [count, setCount] = useState(5);
  const [seedEnabled, setSeedEnabled] = useState(false);
  const [seed, setSeed] = useState(42);
  const [preview, setPreview] = useState<GenerateForActionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [dispatchState, setDispatchState] = useState<DispatchState>({
    kind: "idle",
  });

  const buildPreview = useCallback(() => {
    setPreviewError(null);
    const mod = core.getModule();
    if (mod === null) {
      setPreviewError("no compiled module");
      return;
    }
    try {
      const result = generateForAction(mod, action, {
        count,
        seed: seedEnabled ? seed : undefined,
      });
      setPreview(result);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    }
  }, [action, core, count, seed, seedEnabled]);

  const dispatchAll = useCallback(async () => {
    if (preview === null) return;
    const samples = preview.samples;
    setDispatchState({ kind: "running", done: 0, total: samples.length });
    let successCount = 0;
    let rejectedCount = 0;
    let errorCount = 0;
    for (let i = 0; i < samples.length; i++) {
      try {
        const intent = core.createIntent(
          preview.action,
          ...(samples[i] as unknown[]),
        );
        // Core fires subscribeAfterDispatch on completion so the UI
        // sees each seed land without extra plumbing here.
        const report = await core.dispatchAsync(
          intent as Parameters<typeof core.dispatchAsync>[0],
        );
        if (report.kind === "completed") successCount++;
        else rejectedCount++;
      } catch {
        errorCount++;
      }
      setDispatchState({
        kind: "running",
        done: i + 1,
        total: samples.length,
      });
    }
    setDispatchState({
      kind: "done",
      successCount,
      rejectedCount,
      errorCount,
    });
  }, [core, preview]);

  return (
    <div
      className="
        absolute top-[calc(100%+6px)] right-0 z-20
        w-[340px] rounded-lg
        border border-[var(--color-rule)]
        bg-[color-mix(in_oklch,var(--color-void)_92%,transparent)]
        backdrop-blur-md
        shadow-xl
        p-3
        flex flex-col gap-2
        text-[11.5px] font-sans
      "
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[var(--color-ink)] font-semibold">
            🎲 Mock data
          </span>
          <span className="text-[var(--color-ink-mute)]">→</span>
          <code
            className="
              px-1.5 py-0.5 rounded text-[11px]
              bg-[var(--color-glass)]
              border border-[var(--color-rule)]
              text-[var(--color-sig-action)]
              truncate
            "
            title={action}
          >
            {action}
          </code>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--color-ink-mute)] hover:text-[var(--color-ink)] shrink-0 ml-2"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[var(--color-ink-mute)]">Count</span>
        <input
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(e) =>
            setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
          }
          className="
            bg-[var(--color-glass)]
            border border-[var(--color-rule)]
            rounded px-2 py-1
            text-[var(--color-ink)]
          "
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={seedEnabled}
          onChange={(e) => setSeedEnabled(e.target.checked)}
        />
        <span className="text-[var(--color-ink-mute)]">Lock seed</span>
        {seedEnabled ? (
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 0)}
            className="
              flex-1 bg-[var(--color-glass)]
              border border-[var(--color-rule)]
              rounded px-2 py-0.5
              text-[var(--color-ink)]
            "
          />
        ) : null}
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={buildPreview}
          className="
            flex-1 px-2 py-1 rounded-md
            border border-[var(--color-rule)]
            bg-[var(--color-glass)]
            text-[var(--color-ink)]
            hover:border-[var(--color-glass-edge-hot)]
          "
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => void dispatchAll()}
          disabled={preview === null || dispatchState.kind === "running"}
          className="
            flex-1 px-2 py-1 rounded-md
            bg-[var(--color-violet-hot)] text-[var(--color-void)]
            disabled:bg-[var(--color-glass)] disabled:text-[var(--color-ink-mute)]
            disabled:cursor-not-allowed
          "
        >
          {dispatchState.kind === "running"
            ? `${dispatchState.done} / ${dispatchState.total}`
            : "Dispatch all"}
        </button>
      </div>

      {previewError !== null ? (
        <div className="text-[var(--color-sig-effect)]">{previewError}</div>
      ) : null}

      {preview !== null ? (
        <div
          className="
            max-h-[220px] overflow-y-auto rounded-md
            border border-[var(--color-rule)]
            bg-[color-mix(in_oklch,var(--color-void)_55%,transparent)]
            p-2
          "
        >
          <div className="text-[var(--color-ink-mute)] mb-1">
            {preview.samples.length} sample
            {preview.samples.length === 1 ? "" : "s"} · params:{" "}
            {preview.paramNames.join(", ") || "(none)"}
          </div>
          <pre className="text-[10.5px] font-mono whitespace-pre-wrap text-[var(--color-ink-dim)] leading-snug">
            {JSON.stringify(preview.samples, null, 2)}
          </pre>
        </div>
      ) : null}

      {dispatchState.kind === "done" ? (
        <div className="text-[var(--color-ink-mute)]">
          ✓ {dispatchState.successCount} succeeded
          {dispatchState.rejectedCount > 0
            ? ` · ${dispatchState.rejectedCount} rejected`
            : ""}
          {dispatchState.errorCount > 0
            ? ` · ${dispatchState.errorCount} errored`
            : ""}
        </div>
      ) : null}
    </div>
  );
}
