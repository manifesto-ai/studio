# @manifesto-ai/studio-cli

Thin CLI surface over `@manifesto-ai/studio-core`.

## Usage

```bash
pnpm build
pnpm studio:cli help
pnpm studio:cli analyze apps/web/src/domain/coin-sapiens.mel
pnpm studio:cli graph apps/web/src/domain/coin-sapiens.mel --format json
pnpm studio:cli graph apps/web/src/domain/coin-sapiens.mel --format dot
pnpm studio:cli explain openPosition apps/web/src/domain/coin-sapiens.mel --snapshot snapshot.json
```

## Commands

- `analyze` / `check`: findings report
- `graph`: domain graph projection, including `--format json` and `--format dot`
- `explain`: action blocker explanation
- `trace`: trace replay projection
- `availability`: action availability projection
- `snapshot`: snapshot inspector projection
- `lineage`: lineage state projection
- `governance`: governance state projection

## Inputs

- `--mel <file>`: compile MEL through `@manifesto-ai/compiler`
- `--schema <file>`: load `DomainSchema` JSON
- `--bundle <file>`: load an analysis bundle JSON
- `--snapshot`, `--trace`, `--lineage`, `--governance`: attach overlay JSON artifacts
