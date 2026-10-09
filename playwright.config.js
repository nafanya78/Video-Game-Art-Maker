import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: '*.spec.js', workers: 1, use: { channel: 'msedge', baseURL: 'http://127.0.0.1:4317', viewport: { width: 1440, height: 1000 }, acceptDownloads: true }, reporter: 'list' });
