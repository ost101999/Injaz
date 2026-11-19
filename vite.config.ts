import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    publicDir: 'Public',
    // Keep the previous preview files available while a watched build runs.
    build: { emptyOutDir: process.env.INJAZ_SHARED_PREVIEW === '1' ? false : undefined },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // These launcher shortcuts are not source files and Windows security may
      // block stat calls on them, causing the development watcher to crash.
      watch: { ignored: ['**/تشغيل وبناء إنجاز/**'] },
    },
    plugins: [react()],
    css: { postcss: { plugins: [tailwindcss()] } },
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
