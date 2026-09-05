"""AES-256-GCM 连接串加密（对应 TS services/agent-registry/src/crypto.ts）。

密文格式与 TS 完全兼容：base64(iv(12) + tag(16) + ciphertext)。
阶段 0 已验证双向互通。
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _derive_key(secret: str) -> bytes:
    return hashlib.sha256(secret.encode()).digest()


def encrypt_secret(plaintext: str, secret: str) -> str:
    """加密为 TS 兼容格式：base64(iv + tag + ciphertext)。"""
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    iv = os.urandom(12)
    enc = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)  # ciphertext + tag
    ct, tag = enc[:-16], enc[-16:]
    return base64.b64encode(iv + tag + ct).decode()


def decrypt_secret(b64_ciphertext: str, secret: str) -> str:
    """解密 TS 兼容格式：读 iv(12) + tag(16) + ciphertext。"""
    key = _derive_key(secret)
    aesgcm = AESGCM(key)
    raw = base64.b64decode(b64_ciphertext)
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    return aesgcm.decrypt(iv, ct + tag, None).decode("utf-8")
