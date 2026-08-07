'use client';

import { Cursor } from 'animal-island-ui';

/**
 * animal-island-ui 的样式依赖模块在浏览器端求值时自动注入（<style> + :root 令牌）。
 * Next 的 Server Component 不会把模块送到浏览器执行，因此必须由这个 'use client'
 * Provider 在布局里强制浏览器端求值一次，保证全局样式与 --animal-* 令牌生效。
 */
export default function AnimalIslandProvider({ children }: { children: React.ReactNode }) {
  return <Cursor>{children}</Cursor>;
}
