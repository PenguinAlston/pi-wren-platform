'use client';

/**
 * 统一 fetch 包装：
 * - 仅"会话未登录"的 401（后端带 authRequired:true 标记）跳转登录页
 * - 管理面缺 Token/权限的 401 不跳转（跳登录也无济于事，反而会与登录页互相弹跳），交由页面提示
 * - /api/auth/* 自身的 401（如口令错误）不跳转
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const authRequired = response.status === 401 ? await responseHasAuthRequired(response) : false;
  if (decide401Redirect(path, typeof window === 'undefined' ? '' : window.location.pathname, authRequired)) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  return response;
}

/** 纯函数：这个 401 是否应跳转登录页（抽出来便于测试）。 */
export function decide401Redirect(path: string, currentPath: string, authRequired: boolean): boolean {
  if (!authRequired) return false; // 管理面缺 Token/权限：交给页面提示，不跳登录
  if (path.includes('/api/auth/')) return false; // 登录接口自身的 401（口令错误）
  return !currentPath.startsWith('/login'); // 已在登录页则不再跳
}

async function responseHasAuthRequired(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { authRequired?: boolean };
    return body.authRequired === true;
  } catch {
    return false;
  }
}
