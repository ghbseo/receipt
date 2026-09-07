import { defineConfig, devices } from '@playwright/test'

const localEdge = process.env.PLAYWRIGHT_USE_EDGE === '1'
  ? { channel: 'msedge' as const }
  : {}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...localEdge } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Launch Vite directly so Playwright can reliably terminate the child on Windows.
    command: 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
