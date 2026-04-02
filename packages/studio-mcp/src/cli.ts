import { runServer } from "./server.js";

runServer()
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown MCP server error"}\n`
    );
    process.exit(1);
  });
