"""登录身份 → 数据访问范围（机构行级权限）。

三态模型（fail-closed）：
- unrestricted：admin 或认证未启用（后者为兼容旧行为，仅限开发环境）
- org：普通用户已分配机构 → 机构维度业务数据强制 org_code 等值过滤
- deny：普通用户未分配机构 → 拒绝访问机构维度业务数据（升级后未分配即无权限，
  由 admin 在用户管理页分配）

AI 链路（chat）与传统查询（traditional）共用本判定；SQL 级强制在
app/semantic/org_scope.py。自定义 Agent 连外部库、无机构维度，不适用。
"""
from __future__ import annotations

from dataclasses import dataclass

MODE_UNRESTRICTED = "unrestricted"
MODE_ORG = "org"
MODE_DENY = "deny"


@dataclass(frozen=True)
class OrgAccess:
    """一次请求的数据访问范围。"""

    mode: str  # unrestricted | org | deny
    org_code: str | None = None  # mode=org 时的机构编码

    @classmethod
    def unrestricted(cls) -> "OrgAccess":
        return cls(MODE_UNRESTRICTED)

    @classmethod
    def for_user(cls, user) -> "OrgAccess":
        """user: AuthUser | None（None = 认证未启用，沿用旧行为不限制）。"""
        if user is None:
            return cls.unrestricted()
        if user.role == "admin":
            return cls.unrestricted()
        if not user.org_id:
            return cls(MODE_DENY)
        return cls(MODE_ORG, user.org_id)

    @property
    def restricted(self) -> bool:
        """是否受机构权限约束（False = 与旧行为一致，全量可见）。"""
        return self.mode != MODE_UNRESTRICTED
