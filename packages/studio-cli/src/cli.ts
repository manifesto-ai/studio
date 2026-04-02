import { runCli } from "./run-cli.js";

runCli()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown CLI error"}\n`
    );
    process.exit(1);
  });
