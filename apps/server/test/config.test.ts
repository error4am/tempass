// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config";

const productionEnv = {
  NODE_ENV: "production",
  PORT: "10000",
  HOST: "0.0.0.0",
  CORS_ORIGIN: "https://tempass.vercel.app",
  WEB_ORIGIN: "https://tempass.vercel.app/",
};

describe("parseConfig", () => {
  it("keeps local defaults on the loopback interface", () => {
    const config = parseConfig({ NODE_ENV: "development" });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.corsOrigin).toBe("http://localhost:5173");
    expect(config.webOrigin).toBe("http://localhost:5173");
  });

  it("binds all interfaces by default in production", () => {
    const config = parseConfig({
      ...productionEnv,
      HOST: undefined,
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(10000);
  });

  it("normalizes deployment origins", () => {
    const config = parseConfig(productionEnv);

    expect(config.corsOrigin).toBe("https://tempass.vercel.app");
    expect(config.webOrigin).toBe("https://tempass.vercel.app");
  });

  it("rejects insecure or localhost origins in production", () => {
    expect(() =>
      parseConfig({
        ...productionEnv,
        CORS_ORIGIN: "http://tempass.vercel.app",
      }),
    ).toThrow(/CORS_ORIGIN must use HTTPS/);

    expect(() =>
      parseConfig({
        ...productionEnv,
        WEB_ORIGIN: "https://localhost:5173",
      }),
    ).toThrow(/WEB_ORIGIN must not use localhost/);
  });

  it("allows HTTP localhost origins outside production", () => {
    const config = parseConfig({
      NODE_ENV: "development",
      CORS_ORIGIN: "http://127.0.0.1:4173",
      WEB_ORIGIN: "http://127.0.0.1:4173",
    });

    expect(config.corsOrigin).toBe("http://127.0.0.1:4173");
    expect(config.webOrigin).toBe("http://127.0.0.1:4173");
  });
});
