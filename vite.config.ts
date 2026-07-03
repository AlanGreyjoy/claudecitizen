import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

function stripProtectedAssets(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'claudecitizen-strip-protected-assets',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      if (process.env.INCLUDE_PROTECTED_ASSETS === '1') return;
      await rm(resolve(root, outDir, 'assets/protected'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [stripProtectedAssets()],
});
