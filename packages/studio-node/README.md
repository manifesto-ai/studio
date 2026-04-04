# @manifesto-ai/studio-node

Shared Node adapter used by `studio-cli` and `studio-mcp`.

Most users should not need this package directly. Reach for it only when you want the same file-loading and bundle-resolution behavior that the Studio CLI and MCP server use internally.

It is responsible for:

- loading `.mel` or JSON domain inputs from disk
- compiling MEL into `DomainSchema`
- resolving bundle files and overlay artifacts
- executing thin `studio-core` operations against a loaded bundle
