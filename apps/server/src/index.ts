import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[tempass] server listening on http://localhost:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`[tempass] received ${signal}, shutting down`);

  server.close((error) => {
    if (error) {
      console.error("[tempass] shutdown failed:", error.message);
      process.exitCode = 1;
      return;
    }

    process.exitCode = 0;
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
