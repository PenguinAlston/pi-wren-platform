import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node20',
  noExternal: [/^@pi-wren\//],
});
