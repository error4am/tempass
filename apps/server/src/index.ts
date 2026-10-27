import { config } from "./config";
import { createRuntime } from "./server";

const runtime = createRuntime();

runtime.httpServer.listen(config.port, config.host, () => {
  console.log(`[tempass] server listening on http://${config.host}:${config.port}`);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[tempass] received ${signal}, shutting down`);

  runtime
    .close()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error(
        "[tempass] shutdown failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      process.exitCode = 1;
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
