import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

let gitCommit = '';
try {
  gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch {
  gitCommit = '';
}

const githubRepoUrl = 'https://github.com/KubiV/ThreeJS-EditorDEMO';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_GIT_COMMIT__: JSON.stringify(gitCommit),
    __GITHUB_REPO_URL__: JSON.stringify(githubRepoUrl)
  },
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
