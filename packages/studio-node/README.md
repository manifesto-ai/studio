# @manifesto-ai/studio-node

Shared Node adapter used by `studio-cli` and `studio-mcp`.

It is responsible for:

- loading `.mel` or JSON domain inputs from disk
- compiling MEL into `DomainSchema`
- resolving bundle files and overlay artifacts
- executing thin `studio-core` operations against a loaded bundle
