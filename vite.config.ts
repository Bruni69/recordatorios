import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        login: 'src/pages/auth/login.html',
        dashboard: 'src/pages/dashboard/dashboard.html',
        settings: 'src/pages/settings/settings.html',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});