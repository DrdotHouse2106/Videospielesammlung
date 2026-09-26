// Browser-Tests (Playwright) auf Handy-Größe. Voraussetzung: `npm run build`.
// Start: `npm run test:e2e`
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || '4310';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1, // eine gemeinsame Datenbank – der erste registrierte Benutzer wird Administrator
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'de-DE',
  },
  projects: [
    { name: 'handy-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node e2e/server.js',
    url: `http://127.0.0.1:${PORT}/api/auth/status`,
    env: { E2E_PORT: PORT },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
