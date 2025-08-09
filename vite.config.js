import { resolve } from 'path';
import { defineConfig } from 'vite';

// MV3 considerations:
// - No dynamic code evaluation (no eval).
// - Keep background & content as single bundles (inlineDynamicImports).
// - We are in a transitional phase: manifest still points to legacy root JS files.
//   New build artifacts will live in dist/ for verification before switching manifest paths.

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@popup': resolve(__dirname, 'src/popup'),
      '@content': resolve(__dirname, 'src/content')
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: false, // do not delete existing root JS while migrating
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.ts')
      },
      output: {
        // Separate entry bundles (no inlineDynamicImports due to multiple inputs)
        // Keep names stable for future manifest swap.
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js';
            if (chunk.name === 'content') return 'content.js';
            if (chunk.name === 'popup') return 'popup/index.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
    target: 'es2022',
    minify: false // keep readable during migration; can enable 'esbuild' later
  }
});
