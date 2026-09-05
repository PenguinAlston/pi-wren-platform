"""滑动窗口限流器测试。"""
from app.ratelimit import SlidingWindowRateLimiter


def test_allows_up_to_limit_then_blocks():
    limiter = SlidingWindowRateLimiter(limit=3, window_seconds=60)
    assert limiter.allow("k", now=0) is True
    assert limiter.allow("k", now=1) is True
    assert limiter.allow("k", now=2) is True
    assert limiter.allow("k", now=3) is False  # 超限
    assert limiter.allow("k", now=4) is False


def test_window_slides():
    limiter = SlidingWindowRateLimiter(limit=2, window_seconds=60)
    assert limiter.allow("k", now=0) is True
    assert limiter.allow("k", now=10) is True
    assert limiter.allow("k", now=20) is False
    assert limiter.allow("k", now=61) is True  # 最早一次已滑出窗口
    assert limiter.allow("k", now=70.5) is True  # 第二次（now=10）在 70 后滑出


def test_keys_are_independent():
    limiter = SlidingWindowRateLimiter(limit=1)
    assert limiter.allow("user:U1", now=0) is True
    assert limiter.allow("user:U2", now=0) is True
    assert limiter.allow("user:U1", now=1) is False


def test_zero_limit_disables():
    limiter = SlidingWindowRateLimiter(limit=0)
    for _ in range(100):
        assert limiter.allow("k", now=0) is True


def test_retry_after_positive():
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    limiter.allow("k", now=100)
    assert limiter.retry_after("k", now=101) == 60
    assert limiter.retry_after("missing", now=101) == 1


def test_prune_prevents_growth(monkeypatch):
    monkeypatch.setattr("app.ratelimit._PRUNE_INTERVAL_SECONDS", 0.0)  # 每次调用都清理
    limiter = SlidingWindowRateLimiter(limit=1, window_seconds=1)
    limiter._last_prune = 0.0  # 对齐合成时钟（默认为真实 time.time()）
    for i in range(100):
        limiter.allow(f"k{i}", now=i)
    assert len(limiter._events) < 100
