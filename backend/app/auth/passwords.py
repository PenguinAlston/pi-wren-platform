"""口令哈希：PBKDF2-HMAC-SHA256（标准库实现，无第三方依赖）。

存储格式：pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

_ITERATIONS = 600_000  # OWASP 2023 建议 PBKDF2-SHA256 至少 60 万次
_SALT_BYTES = 16
_KEY_BYTES = 32
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    if not password or len(password) > 1024:
        raise ValueError("password length must be 1-1024")
    salt = secrets.token_hex(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), _ITERATIONS, dklen=_KEY_BYTES,
    )
    return f"{_ALGO}${_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations_s, salt, expected = stored.split("$")
        if algo != _ALGO:
            return False
        iterations = int(iterations_s)
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), iterations, dklen=len(expected) // 2,
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False
