import todoSource from "./todo.mel?raw";
import battleshipSource from "./battleship.mel?raw";

export type FixtureId = "todo" | "battleship";

export type Fixture = {
  readonly id: FixtureId;
  readonly label: string;
  readonly source: string;
  readonly hint?: string;
};

export const FIXTURES: readonly Fixture[] = [
  { id: "todo", label: "todo.mel", source: todoSource, hint: "starter" },
  {
    id: "battleship",
    label: "battleship.mel",
    source: battleshipSource,
    hint: "60+ nodes",
  },
];
