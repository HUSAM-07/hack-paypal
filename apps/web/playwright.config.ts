import { defineConfig, devices } from "@playwright/test";

const PORT = 5181;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/app`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop-dark", use: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
    {
      name: "mobile-light",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, colorScheme: "light" },
    },
    ...(process.env.SCREENSHOTS
      ? [
          {
            name: "desktop-light",
            use: { viewport: { width: 1440, height: 900 }, colorScheme: "light" as const },
          },
          {
            name: "mobile-dark",
            use: {
              ...devices["Pixel 7"],
              viewport: { width: 375, height: 812 },
              colorScheme: "dark" as const,
            },
          },
        ]
      : []),
  ],
});
