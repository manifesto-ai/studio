import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Download,
  Upload,
  FileText,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useProjects } from "@/hooks/useProjects";
import { FIXTURES } from "@/fixtures";

/**
 * ProjectSwitcher — single dropdown in the top bar for everything
 * project-related: switch, create, clone, rename, delete, import,
 * export. Replaces the old fixture breadcrumb. Nested submenus keep
 * the common path (switch project) at one click while less frequent
 * actions (new from template, import) stay discoverable.
 */
export function ProjectSwitcher(): JSX.Element {
  const {
    projects,
    activeProject,
    select,
    newFromTemplate,
    newBlank,
    cloneActive,
    rename,
    remove,
    exportAll,
    exportOne,
    importJson,
  } = useProjects();

  const label = activeProject?.name ?? "No project";

  const [renaming, setRenaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onRename = useCallback(() => {
    if (activeProject === null) return;
    setRenaming(true);
  }, [activeProject]);

  const onDelete = useCallback(async () => {
    if (activeProject === null) return;
    const confirmed = window.confirm(
      `Delete "${activeProject.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    await remove(activeProject.id);
  }, [activeProject, remove]);

  const onExportOne = useCallback(async () => {
    if (activeProject === null) return;
    const json = await exportOne(activeProject.id);
    if (json === null) return;
    downloadJson(`${slugify(activeProject.name)}.mfst.json`, json);
  }, [activeProject, exportOne]);

  const onExportAll = useCallback(async () => {
    const json = await exportAll();
    downloadJson(`manifesto-studio-${timestamp()}.mfst.json`, json);
  }, [exportAll]);

  const onImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // reset so the same file can be re-imported
      if (file === undefined) return;
      const text = await file.text();
      const result = await importJson(text);
      if (result.errors.length > 0) {
        window.alert(
          `Import finished with issues:\n\n${result.errors.join("\n")}`,
        );
      }
    },
    [importJson],
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="
              group flex items-center gap-1 h-7 px-1.5 rounded-md
              font-sans text-[12px] text-[var(--color-ink-dim)]
              hover:text-[var(--color-ink)] hover:bg-[var(--color-glass)]
              transition-colors outline-none
              focus-visible:outline-2 focus-visible:outline-[var(--color-violet-hot)]
              focus-visible:outline-offset-2
            "
            aria-label="Project switcher"
          >
            <span className="text-[var(--color-ink-mute)]">studio</span>
            <span className="text-[var(--color-ink-mute)]">/</span>
            <span className="font-mono text-[11.5px] text-[var(--color-ink)] max-w-[220px] truncate">
              {label}
            </span>
            <ChevronDown className="h-3 w-3 text-[var(--color-ink-mute)] group-hover:text-[var(--color-ink-dim)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[260px]">
          <DropdownMenuLabel>Switch to</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeProject?.id ?? ""}
            onValueChange={(v) => {
              if (v !== "" && v !== activeProject?.id) void select(v);
            }}
          >
            {projects.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <FileText className="h-3 w-3 text-[var(--color-ink-mute)] shrink-0" />
                <span className="font-mono text-[12px] truncate">
                  {p.name}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-mute)] shrink-0">
                  {originHint(p.origin)}
                </span>
              </DropdownMenuRadioItem>
            ))}
            {projects.length === 0 && (
              <div className="px-3 py-1.5 text-[11px] text-[var(--color-ink-mute)]">
                No projects yet.
              </div>
            )}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Create</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="
                  flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5
                  text-[12px] outline-none transition-colors
                  focus:bg-[var(--color-glass-hi)]
                  data-[state=open]:bg-[var(--color-glass-hi)]
                "
              >
                <Plus className="h-3 w-3 text-[var(--color-ink-mute)]" />
                <span>New from example</span>
                <ChevronRight className="ml-auto h-3 w-3 text-[var(--color-ink-mute)]" />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {FIXTURES.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => {
                      void newFromTemplate(f.id);
                    }}
                  >
                    <FileText className="h-3 w-3 text-[var(--color-ink-mute)] shrink-0" />
                    <span className="font-mono text-[12px]">{f.label}</span>
                    {f.hint !== undefined && (
                      <span className="ml-2 font-mono text-[10px] text-[var(--color-ink-mute)]">
                        {f.hint}
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                void newBlank();
              }}
            >
              <Plus className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>New blank project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void cloneActive();
              }}
              disabled={activeProject === null}
            >
              <Copy className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>Clone current</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Current</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={onRename}
              disabled={activeProject === null}
            >
              <Pencil className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>Rename…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void onExportOne();
              }}
              disabled={activeProject === null}
            >
              <Download className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>Export as bundle</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void onDelete();
              }}
              disabled={activeProject === null}
              className="focus:bg-[color-mix(in_oklch,var(--color-err)_22%,transparent)]"
            >
              <Trash2 className="h-3 w-3 text-[var(--color-err)]" />
              <span className="text-[var(--color-err)]">Delete current</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Bundle</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onImportClick}>
              <Upload className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>Import bundle…</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void onExportAll();
              }}
              disabled={projects.length === 0}
            >
              <Download className="h-3 w-3 text-[var(--color-ink-mute)]" />
              <span>Export all projects</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportFile}
      />

      {renaming && activeProject !== null && (
        <RenameDialog
          initialName={activeProject.name}
          onSubmit={async (name) => {
            await rename(activeProject.id, name);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      )}
    </>
  );
}

function RenameDialog({
  initialName,
  onSubmit,
  onCancel,
}: {
  readonly initialName: string;
  readonly onSubmit: (name: string) => void | Promise<void>;
  readonly onCancel: () => void;
}): JSX.Element | null {
  const [name, setName] = useState(initialName);
  // Portal to <body> so the dialog escapes the TopBar's containing
  // block. TopBar uses `backdrop-filter` which establishes a new
  // containing block for descendants, trapping `position: fixed`
  // inside the TopBar's bounding rect — the dialog would otherwise
  // sit at the top of the screen instead of the viewport centre.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-void)]/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        className="
          flex flex-col gap-3 p-5 min-w-[320px]
          rounded-lg border border-[var(--color-glass-edge)]
          bg-[var(--color-void-hi)] shadow-[var(--shadow-glass)]
        "
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (trimmed !== "") void onSubmit(trimmed);
        }}
      >
        <label
          htmlFor="project-rename"
          className="font-sans text-[11px] tracking-[0.04em] uppercase text-[var(--color-ink-dim)]"
        >
          Rename project
        </label>
        <input
          id="project-rename"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="
            rounded-md px-2.5 py-1.5 font-mono text-[12.5px]
            bg-[var(--color-void)] border border-[var(--color-glass-edge)]
            outline-none focus:border-[var(--color-violet-hot)]
            text-[var(--color-ink)]
          "
        />
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="
              h-7 px-3 rounded-md font-sans text-[11.5px]
              text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]
              hover:bg-[var(--color-glass)] transition-colors
            "
          >
            Cancel
          </button>
          <button
            type="submit"
            className="
              h-7 px-3 rounded-md font-sans text-[11.5px] font-medium
              bg-[color-mix(in_oklch,var(--color-violet-hot)_28%,transparent)]
              text-[var(--color-ink)]
              border border-[color-mix(in_oklch,var(--color-violet-hot)_55%,transparent)]
              hover:bg-[color-mix(in_oklch,var(--color-violet-hot)_38%,transparent)]
              transition-colors
            "
          >
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function originHint(origin: { kind: string }): string {
  switch (origin.kind) {
    case "template":
      return "example";
    case "imported":
      return "imported";
    case "cloned":
      return "clone";
    case "blank":
      return "";
    default:
      return "";
  }
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "project"
  );
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
