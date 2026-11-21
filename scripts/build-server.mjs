import { build } from 'esbuild';

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/server.mjs',
  external: ['fsevents', 'vite', 'node-llama-cpp'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

console.log('Server bundle built cleanly -> dist-server/server.mjs');
