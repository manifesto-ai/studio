import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

type BattleshipData = {
  readonly cells: ReadonlyArray<{ readonly id: string; readonly status: string }>;
  readonly shotsFired: number;
  readonly hitCount: number;
  readonly missCount: number;
  readonly turnNumber: number;
};

describe("SC-8 — battleship domain end-to-end", () => {
  it("loads and drives the real battleship domain through a game cycle", async () => {
    const source = loadFixture("battleship.mel");
    const adapter = createHeadlessAdapter({ initialSource: source });
    const core = createStudioCore();
    core.attach(adapter);

    const build = await core.build();
    expect(build.kind).toBe("ok");
    if (build.kind !== "ok") return;

    // Battleship surface sanity: both shoot and askQuestion must exist.
    expect(Object.keys(build.module.schema.actions)).toContain("shoot");
    expect(Object.keys(build.module.schema.actions)).toContain("askQuestion");

    const cells = [
      { id: "A1", status: "unknown" },
      { id: "A2", status: "unknown" },
      { id: "A3", status: "unknown" },
    ];
    await core.dispatchAsync(core.createIntent("initCells", cells));
    await core.dispatchAsync(core.createIntent("setupBoard", 2));
    await core.dispatchAsync(core.createIntent("shoot", "A1"));
    await core.dispatchAsync(core.createIntent("recordHit", "A1"));
    await core.dispatchAsync(core.createIntent("shoot", "A2"));
    await core.dispatchAsync(core.createIntent("recordMiss", "A2"));

    const afterPlay = core.getSnapshot() as unknown as { data: BattleshipData };
    expect(afterPlay.data.shotsFired).toBe(2);
    expect(afterPlay.data.hitCount).toBe(1);
    expect(afterPlay.data.missCount).toBe(1);
    expect(afterPlay.data.turnNumber).toBe(2);

    // Rebuild with a harmless computed tweak. snapshot preservation path
    // must carry mid-game state through.
    const v2 = source.replace(
      "computed canShoot = and(eq(phase, \"playing\"), gt(shotsRemaining, 0))",
      "computed canShoot = and(and(eq(phase, \"playing\"), gt(shotsRemaining, 0)), true)",
    );
    expect(v2).not.toBe(source);
    adapter.setSource(v2);

    const rebuild = await core.build();
    expect(rebuild.kind).toBe("ok");
    if (rebuild.kind !== "ok") return;
    expect(rebuild.plan.snapshotPlan.preserved).toContain("state_field:cells");
    expect(rebuild.plan.snapshotPlan.preserved).toContain("state_field:shotsFired");
    expect(rebuild.plan.snapshotPlan.discarded).toEqual([]);

    const afterRebuild = core.getSnapshot() as unknown as { data: BattleshipData };
    expect(afterRebuild.data.shotsFired).toBe(2);
    expect(afterRebuild.data.hitCount).toBe(1);
    expect(afterRebuild.data.missCount).toBe(1);
    expect(afterRebuild.data.turnNumber).toBe(2);

    // Continue playing on the rebuilt runtime.
    await core.dispatchAsync(core.createIntent("shoot", "A3"));
    await core.dispatchAsync(core.createIntent("recordMiss", "A3"));
    const afterCont = core.getSnapshot() as unknown as { data: BattleshipData };
    expect(afterCont.data.shotsFired).toBe(3);
    expect(afterCont.data.missCount).toBe(2);
  });
});
