import todoSource from "./todo.mel?raw";
import taskflowSource from "./taskflow.mel?raw";

/**
 * Built-in examples surfaced from the "New from example" submenu and
 * used as the first-boot seed (todo only — see `useProjects.tsx`).
 * Heavier stress fixtures (e.g. battleship) live in the headless
 * adapter's test fixtures rather than here so the MVP example list
 * stays approachable.
 */
export type FixtureId = "todo" | "taskflow";

export type Fixture = {
  readonly id: FixtureId;
  readonly label: string;
  readonly source: string;
  readonly hint?: string;
};

export const FIXTURES: readonly Fixture[] = [
  { id: "todo", label: "todo.mel", source: todoSource, hint: "starter" },
  {
    id: "taskflow",
    label: "taskflow.mel",
    source: taskflowSource,
    hint: "task mgmt · nullable types · time-aware computeds",
  },
];
