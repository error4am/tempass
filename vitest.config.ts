import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tempass/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "apps/server/test/**/*.test.ts",
      "apps/web/test/**/*.test.tsx",
      "packages/shared/test/**/*.test.ts",
    ],
  },
});
