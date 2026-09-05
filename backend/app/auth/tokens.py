"""会话令牌：HMAC-SHA256 签名的无状态 token（base64url 载荷 + 签名）。

格式：base64url(json{uid,role,exp}) + "." + base64url(hmac)
无状态校验（不查库），禁用用户的最长生效窗口 = 会话有效期。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign_token(secret: str, user_id: str, role: str, ttl_seconds: int,
               now: float | None = None) -> str:
    payload = {
        "uid": user_id,
        "role": role,
        "exp": int((now if now is not None else time.time()) + ttl_seconds),
    }
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64encode(sig)}"


def verify_token(secret: str, token: str,
                 now: float | None = None) -> dict | None:
    """校验签名与有效期，返回 {uid, role, exp}；任何不合法返回 None。"""
    if not token or token.count(".") != 1:
        return None
    body, sig = token.split(".")
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(_b64decode(sig), expected):
            return None
        payload = json.loads(_b64decode(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or "uid" not in payload:
        return None
    if payload.get("exp", 0) <= (now if now is not None else time.time()):
        return None
    return payload
