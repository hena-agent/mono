import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL:
      process.env["HENA_E2E_DEV"] === "1" ? "http://127.0.0.1:3000" : "http://127.0.0.1:4401",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer:
    process.env["HENA_E2E_DEV"] === "1"
      ? {
          command: "bun run --cwd ../.. dev",
          gracefulShutdown: { signal: "SIGINT", timeout: 5000 },
          url: "http://127.0.0.1:3000",
          reuseExistingServer: false,
        }
      : {
          command: "bun ../cli/src/main.ts serve --port 4401",
          gracefulShutdown: { signal: "SIGINT", timeout: 5000 },
          url: "http://127.0.0.1:4401",
          reuseExistingServer: false,
        },
});

export default config;
