"""PBKDF2 口令哈希测试。"""
from app.auth.passwords import hash_password, verify_password


def test_hash_format_and_roundtrip():
    stored = hash_password("s3cret-密码")
    assert stored.startswith("pbkdf2_sha256$600000$")
    parts = stored.split("$")
    assert len(parts) == 4 and len(parts[2]) == 32  # salt hex(16B)
    assert verify_password("s3cret-密码", stored)


def test_wrong_password_rejected():
    stored = hash_password("correct")
    assert not verify_password("wrong", stored)
    assert not verify_password("", stored)


def test_unique_salts():
    assert hash_password("same") != hash_password("same")


def test_malformed_stored_hash_rejected():
    assert not verify_password("x", "not-a-valid-hash")
    assert not verify_password("x", "md5$1000$ab$cd")
    assert not verify_password("x", "")


def test_password_length_bounds():
    assert hash_password("a" * 1024)
    try:
        hash_password("")
    except ValueError:
        pass
    else:
        raise AssertionError("empty password should raise")
