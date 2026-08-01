import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  // 原生 CJS 依赖（pg/yaml/pi 生态）在 ESM bundle 中 require 内置模块会报错，
  // 统一输出 CJS 并全量打包，产出自包含的单文件（仅 @pi-wren 与传递依赖全部内联）。
  format: ['cjs'],
  clean: true,
  sourcemap: true,
  target: 'node20',
  noExternal: [/^@pi-wren\//],
});
