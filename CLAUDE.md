<!-- BEGIN MANAGED BLOCK: @manifesto-ai/skills v1.2.0 -->
See @node_modules/@manifesto-ai/skills/SKILL.md for Manifesto integration guidance.
<!-- END MANAGED BLOCK: @manifesto-ai/skills -->

## Manifesto Agent Operating Notes

Full version: [Building Agents on Manifesto](docs/building-agents-on-manifesto.md).

Core rule: **MEL is identity; snapshot is state.** Put stable identity in the
system prompt: agent role, tool catalog, grounding recipe, MEL source, and a
compact recent-turn tail. Pull all dynamic state through tools: current
snapshot, computed values, focus, availability, graph neighbors, lineage, and
conversation history.

Do not bake snapshot JSON, current counts, focused nodes, availability lists, or
graph projections into prompt prose. Tool calls run at decision time; prompt
values are stale as soon as dispatches happen. If the agent needs “this”,
“now”, counts, relationships, or legality, it must inspect first.

Split tools by intent and keep their boundaries narrow:
- Inspect tools are pure reads and safe to call speculatively.
- Act tools mutate user-domain or studio-domain state through legality gates.
- Diagnose tools explain failures or preview outcomes without mutating.

Default every large tool response to a compact projection. Heavy fields should
be opt-in through `fields`, `limit`, cursor, or filter parameters. Projection
belongs in the tool response, not in a smart prompt builder.

For multi-runtime agents, prefer descriptive tool names over a generic
`runtime` parameter. `dispatch` for user-domain writes and `studioDispatch` for
UI-domain writes route better than one overloaded tool.

For MEL Author work, analyze behavior through Manifesto Orchestrator snapshot,
compact inspect tools, and lineage first. Raw provider logs are fallback data,
not the primary lens.

Test the contracts that keep this architecture honest: prompt builders must not
include dynamic state, inspect tools must prove compact/default projections,
dispatch failures must return quotable error values, and snapshot consistency
must hold after dispatch. Avoid making normal unit tests depend on full LLM
round-trips.
