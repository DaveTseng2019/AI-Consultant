import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The exe reads its build stamp from build-info.json beside it, which only `pnpm build:local`
// writes. `tauri dev` runs out of target/debug and finds none, so it would show the pinned 0.0.0
// and say nothing about which commit is on screen. Bake the same describe into the bundle as the
// fallback. Empty when git is unavailable (a shallow CI checkout), and that lane has a real
// version from the tag anyway.
function gitDescribe(): string {
  try {
    return execFileSync('git', ['describe', '--tags', '--always', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __GIT_DESCRIBE__: JSON.stringify(gitDescribe()) },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['refs/**', 'node_modules/**', 'dist/**'],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Keep the watcher out of cargo's build output (EBUSY on Windows) and vendored repos.
      ignored: ['**/src-tauri/**', '**/refs/**'],
    },
  },
});
