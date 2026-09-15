import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // The browser never holds the API key. Render calls go to server.js.
    proxy: {
      '/api': 'http://localhost:8787',
      '/hooks': 'http://localhost:8787'
    }
  }
});
