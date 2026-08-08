"""crypto 测试（AES-256-GCM，验证 TS 兼容格式双向）。"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.registry.crypto import decrypt_secret, encrypt_secret

SECRET = "test-secret-key-32-bytes-long!!!"


def test_encrypt_decrypt_roundtrip():
    plaintext = '{"host":"localhost","port":5432,"user":"demo"}'
    encrypted = encrypt_secret(plaintext, SECRET)
    assert decrypt_secret(encrypted, SECRET) == plaintext
    assert encrypted != plaintext


def test_ts_compatible_format_layout():
    """密文必须是 TS 布局：base64(iv(12) + tag(16) + ciphertext)。"""
    plaintext = "hello"
    encrypted = encrypt_secret(plaintext, SECRET)
    raw = base64.b64decode(encrypted)
    # iv(12) + tag(16) + ciphertext(len(plaintext))
    assert len(raw) == 12 + 16 + len(plaintext)
    iv, tag, ct = raw[:12], raw[12:28], raw[28:]
    # 用 Python AESGCM 验证能解（iv + ct + tag 重组）
    key = hashlib.sha256(SECRET.encode()).digest()
    assert AESGCM(key).decrypt(iv, ct + tag, None) == plaintext.encode()


def test_decrypt_ts_generated_ciphertext():
    """模拟 TS 端加密（iv+tag+ciphertext），Python 应能解。"""
    key = hashlib.sha256(SECRET.encode()).digest()
    aesgcm = AESGCM(key)
    iv = os.urandom(12)
    enc = aesgcm.encrypt(iv, b'{"database":"piwren"}', None)  # ct + tag
    ct, tag = enc[:-16], enc[-16:]
    ts_b64 = base64.b64encode(iv + tag + ct).decode()  # TS 布局
    assert decrypt_secret(ts_b64, SECRET) == '{"database":"piwren"}'


def test_wrong_secret_fails():
    encrypted = encrypt_secret("secret-data", SECRET)
    import pytest
    with pytest.raises(Exception):
        decrypt_secret(encrypted, "wrong-secret-key")
