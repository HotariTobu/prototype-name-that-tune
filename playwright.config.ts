import { defineConfig } from "@playwright/test";

export default defineConfig({
  testMatch: "test-penalty-e2e.ts",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3456",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
});
