"""HMAC 会话令牌测试。"""
import time

from app.auth.tokens import sign_token, verify_token

SECRET = "test-secret-0123456789abcdef"


def test_sign_verify_roundtrip():
    token = sign_token(SECRET, "U123", "admin", 3600)
    payload = verify_token(SECRET, token)
    assert payload == {"uid": "U123", "role": "admin", "exp": payload["exp"]}


def test_expired_token_rejected():
    now = time.time()
    token = sign_token(SECRET, "U123", "user", 100, now=now - 200)
    assert verify_token(SECRET, token, now=now) is None


def test_wrong_secret_rejected():
    token = sign_token(SECRET, "U123", "user", 3600)
    assert verify_token("another-secret-0123456789", token) is None


def test_tampered_payload_rejected():
    token = sign_token(SECRET, "U123", "user", 3600)
    body, sig = token.split(".")
    # 换成 admin 角色的伪造载荷，旧签名应失效
    forged = body[:-2] + "XX" if body[-2:] != "XX" else body[:-2] + "YY"
    assert verify_token(SECRET, f"{forged}.{sig}") is None


def test_malformed_token_rejected():
    assert verify_token(SECRET, "") is None
    assert verify_token(SECRET, "abc") is None
    assert verify_token(SECRET, "a.b.c") is None
    assert verify_token(SECRET, "!!?.??") is None
