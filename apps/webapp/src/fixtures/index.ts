import todoSource from "./todo.mel?raw";
import battleshipSource from "./battleship.mel?raw";
import taskflowSource from "./taskflow.mel?raw";

export type FixtureId = "todo" | "battleship" | "taskflow";

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
  {
    id: "battleship",
    label: "battleship.mel",
    source: battleshipSource,
    hint: "60+ nodes",
  },
];
