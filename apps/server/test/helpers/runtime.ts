import { createRuntime, type TempassRuntimeOptions } from "../../src/server";

export interface TestRuntime {
  url: string;
  runtime: ReturnType<typeof createRuntime>;
  close: () => Promise<void>;
}

export async function startTestRuntime(
  options: TempassRuntimeOptions = {},
): Promise<TestRuntime> {
  const runtime = createRuntime({
    capacity: 2,
    reconnectGraceMs: 80,
    emptyRoomTtlMs: 150,
    roomMaxAgeMs: 60_000,
    cleanupIntervalMs: 3_600_000,
    ...options,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };

    runtime.httpServer.once("error", onError);
    runtime.httpServer.listen(0, "127.0.0.1", () => {
      runtime.httpServer.off("error", onError);
      resolve();
    });
  });

  const address = runtime.httpServer.address();

  if (!address || typeof address === "string") {
    await runtime.close();
    throw new Error("Test server did not expose a TCP address");
  }

  return {
    runtime,
    url: `http://127.0.0.1:${address.port}`,
    close: () => runtime.close(),
  };
}
