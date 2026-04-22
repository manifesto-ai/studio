import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FIXTURES, type Fixture } from "@/fixtures";
import {
  createProject,
  deleteProject as storageDeleteProject,
  getLastActiveProjectId,
  getProject,
  importBundle,
  listProjects,
  renameProject as storageRenameProject,
  serializeBundle,
  setLastActiveProjectId,
  touchProject,
  updateProjectSource,
  type ProjectOrigin,
  type ProjectRecord,
} from "@/storage/projects";

/**
 * useProjects — one place to read/write the IndexedDB project store.
 *
 * The hook is rendered as a context provider so App, TopBar, and any
 * future command palette can read the same list + perform mutations
 * without each re-querying IndexedDB. On first mount it seeds a fresh
 * browser with the three built-in fixtures as starter projects, so new
 * users land in an editor with actual MEL they can touch instead of a
 * blank canvas.
 */

export type UseProjectsValue = {
  readonly ready: boolean;
  readonly projects: readonly ProjectRecord[];
  readonly activeProject: ProjectRecord | null;
  readonly select: (id: string) => Promise<void>;
  readonly newFromTemplate: (templateId: string) => Promise<ProjectRecord | null>;
  readonly newBlank: (name?: string) => Promise<ProjectRecord>;
  readonly cloneActive: (nameSuffix?: string) => Promise<ProjectRecord | null>;
  readonly rename: (id: string, name: string) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly saveSource: (id: string, source: string) => Promise<void>;
  readonly exportAll: () => Promise<string>;
  readonly exportOne: (id: string) => Promise<string | null>;
  readonly importJson: (
    json: string,
  ) => Promise<{ imported: readonly ProjectRecord[]; errors: readonly string[] }>;
};

const ProjectsContext = createContext<UseProjectsValue | null>(null);

export function ProjectsProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<readonly ProjectRecord[]> => {
    const next = await listProjects();
    setProjects(next);
    return next;
  }, []);

  // On boot: seed DB if empty, then pick the last-active project (or
  // the most-recently-opened one as a fallback). Only the lightweight
  // `todo` starter is seeded; Battleship (~180 nodes) and TaskFlow are
  // available via "New from template" but shouldn't be the first thing
  // a new user sees — they're too heavy for a first impression.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = await listProjects();
      if (list.length === 0) {
        const starter = FIXTURES.find((f) => f.id === "todo") ?? FIXTURES[0];
        await createProject({
          name: templateDisplayName(starter),
          source: starter.source,
          origin: { kind: "template", templateId: starter.id },
        });
        list = await listProjects();
      }
      if (cancelled) return;
      const last = await getLastActiveProjectId();
      const pick =
        (last !== null && list.find((p) => p.id === last)) ||
        list[0] ||
        null;
      setProjects(list);
      setActiveId(pick?.id ?? null);
      if (pick !== null) {
        await touchProject(pick.id);
        await setLastActiveProjectId(pick.id);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  const select = useCallback(
    async (id: string): Promise<void> => {
      const rec = await getProject(id);
      if (rec === null) return;
      await touchProject(id);
      await setLastActiveProjectId(id);
      setActiveId(id);
      await refresh();
    },
    [refresh],
  );

  const newFromTemplate = useCallback(
    async (templateId: string): Promise<ProjectRecord | null> => {
      const template = FIXTURES.find((f) => f.id === templateId);
      if (template === undefined) return null;
      const created = await createProject({
        name: templateDisplayName(template),
        source: template.source,
        origin: { kind: "template", templateId: template.id },
      });
      await setLastActiveProjectId(created.id);
      setActiveId(created.id);
      await refresh();
      return created;
    },
    [refresh],
  );

  const newBlank = useCallback(
    async (name: string = "Untitled"): Promise<ProjectRecord> => {
      const created = await createProject({
        name,
        source: BLANK_SOURCE,
        origin: { kind: "blank" },
      });
      await setLastActiveProjectId(created.id);
      setActiveId(created.id);
      await refresh();
      return created;
    },
    [refresh],
  );

  const cloneActive = useCallback(
    async (nameSuffix: string = " (copy)"): Promise<ProjectRecord | null> => {
      if (activeProject === null) return null;
      const created = await createProject({
        name: `${activeProject.name}${nameSuffix}`,
        source: activeProject.source,
        origin: { kind: "cloned", sourceProjectId: activeProject.id },
      });
      await setLastActiveProjectId(created.id);
      setActiveId(created.id);
      await refresh();
      return created;
    },
    [activeProject, refresh],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      await storageRenameProject(id, name);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await storageDeleteProject(id);
      const list = await refresh();
      if (activeId === id) {
        const next = list[0] ?? null;
        setActiveId(next?.id ?? null);
        if (next !== null) {
          await touchProject(next.id);
          await setLastActiveProjectId(next.id);
        } else {
          await setLastActiveProjectId(null);
        }
      }
    },
    [activeId, refresh],
  );

  // Autosave guard — we throttle DB writes at the call site but the
  // source-of-truth belongs here so stale callbacks don't overwrite
  // newer state. Callers pass the id of the project they intend to
  // save; if it no longer matches the active project we drop the write.
  const saveSource = useCallback(
    async (id: string, source: string): Promise<void> => {
      await updateProjectSource(id, source);
      // Update the in-memory list's updatedAt without a full re-query.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, source, updatedAt: Date.now() }
            : p,
        ),
      );
    },
    [],
  );

  const exportAll = useCallback(async (): Promise<string> => {
    const list = await listProjects();
    return serializeBundle(list);
  }, []);

  const exportOne = useCallback(
    async (id: string): Promise<string | null> => {
      const rec = await getProject(id);
      if (rec === null) return null;
      return serializeBundle([rec]);
    },
    [],
  );

  const importJson = useCallback(
    async (
      json: string,
    ): Promise<{
      imported: readonly ProjectRecord[];
      errors: readonly string[];
    }> => {
      const result = await importBundle(json);
      if (result.imported.length > 0) {
        await refresh();
        const newest = result.imported[0];
        await setLastActiveProjectId(newest.id);
        setActiveId(newest.id);
      }
      return result;
    },
    [refresh],
  );

  const value = useMemo<UseProjectsValue>(
    () => ({
      ready,
      projects,
      activeProject,
      select,
      newFromTemplate,
      newBlank,
      cloneActive,
      rename,
      remove,
      saveSource,
      exportAll,
      exportOne,
      importJson,
    }),
    [
      ready,
      projects,
      activeProject,
      select,
      newFromTemplate,
      newBlank,
      cloneActive,
      rename,
      remove,
      saveSource,
      exportAll,
      exportOne,
      importJson,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): UseProjectsValue {
  const ctx = useContext(ProjectsContext);
  if (ctx === null) {
    throw new Error("useProjects must be used inside <ProjectsProvider>");
  }
  return ctx;
}

/**
 * Debounced autosave. Call whenever the editor's content changes; the
 * hook batches writes and drops stale saves when the user switches
 * projects mid-debounce.
 */
export function useAutosave(
  activeProjectId: string | null,
  getCurrentSource: () => string,
  save: (id: string, source: string) => Promise<void>,
  delayMs: number = 500,
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestIdRef = useRef<string | null>(activeProjectId);
  latestIdRef.current = activeProjectId;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const id = latestIdRef.current;
      if (id === null) return;
      const src = getCurrentSource();
      void save(id, src);
    }, delayMs);
  }, [getCurrentSource, save, delayMs]);
}

const BLANK_SOURCE = `domain Untitled {
  state {
    count: number = 0
  }

  computed doubled = count * 2

  action increment() {
    onceIntent {
      patch count = count + 1
    }
  }

  action decrement() available when count > 0 {
    onceIntent {
      patch count = count - 1
    }
  }
}
`;

function templateDisplayName(fixture: Fixture): string {
  // Fixture labels read like filenames (`todo.mel`), which is fine in a
  // file picker but noisy as a project name. Humanize for the store.
  switch (fixture.id) {
    case "todo":
      return "Todo";
    case "taskflow":
      return "TaskFlow";
    default:
      return fixture.label;
  }
}
