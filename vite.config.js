import { defineConfig } from 'vite';

export default defineConfig({
  // `threejsdemo/` is retained only as a static legacy demo.  Letting Vite
  // discover its standalone HTML files makes dependency optimisation resolve
  // Three.js from both node_modules directories, which loads two runtimes in
  // the editor during development.
  optimizeDeps: {
    entries: ['index.html']
  },
  resolve: {
    dedupe: ['three']
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    }
  }
});
