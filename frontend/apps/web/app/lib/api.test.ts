import { describe, expect, it } from 'vitest';
import { decide401Redirect } from './api';

describe('decide401Redirect', () => {
  it('会话未登录（authRequired）→ 跳登录页', () => {
    expect(decide401Redirect('/api/sessions', '/chat', true)).toBe(true);
  });

  it('管理面缺 Token/权限（无 authRequired 标记）→ 不跳转，由页面提示', () => {
    expect(decide401Redirect('/api/admin/users', '/users', false)).toBe(false);
    expect(decide401Redirect('/api/admin/agents', '/agents', false)).toBe(false);
  });

  it('登录接口自身的 401（口令错误）→ 不跳转', () => {
    expect(decide401Redirect('/api/auth/login', '/login', true)).toBe(false);
  });

  it('已在登录页 → 不再跳转（防互相弹跳）', () => {
    expect(decide401Redirect('/api/sessions', '/login', true)).toBe(false);
    expect(decide401Redirect('/api/sessions', '/login?next=%2Fusers', true)).toBe(false);
  });
});
