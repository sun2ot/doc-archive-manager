import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', fullyParallel:true,
  use:{baseURL:'http://127.0.0.1:1420',channel:'msedge',headless:true,viewport:{width:1440,height:1050}},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:1420',reuseExistingServer:!process.env.CI},
});
