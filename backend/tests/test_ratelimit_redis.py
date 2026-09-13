"""Redis 限流后端测试：ZSET 滑动窗口语义 + AsyncRateLimiter 统一门面（假 Redis，无真实连接）。"""
import time

import pytest

from app.ratelimit import AsyncRateLimiter, RedisSlidingWindowRateLimiter, SlidingWindowRateLimiter


class FakePipeline:
    """pipeline(transaction=True) 内按序执行 ZREM-RANGEBYSCORE / ZCARD。"""

    def __init__(self, fake):
        self._fake = fake
        self._ops = []

    def zremrangebyscore(self, key, lo, hi):
        self._ops.append(("zrem", key, lo, hi))
        return self

    def zcard(self, key):
        self._ops.append(("zcard", key))
        return self

    async def execute(self):
        results = []
        for op in self._ops:
            if op[0] == "zrem":
                _, key, lo, hi = op
                zs = self._fake.zsets.setdefault(key, {})
                lo_v = float("-inf") if lo == "-inf" else float(lo)
                hi_v = float("inf") if hi == "+inf" else float(hi)
                for member in [m for m, s in list(zs.items()) if lo_v <= s <= hi_v]:
                    del zs[member]
                results.append(len(zs))
            else:
                results.append(len(self._fake.zsets.get(op[1], {})))
        self._ops = []
        return results


class FakeRedis:
    """最小 ZSET 假实现：只覆盖 RedisSlidingWindowRateLimiter 用到的命令。"""

    def __init__(self):
        self.zsets = {}

    def pipeline(self, transaction: bool = True):
        return FakePipeline(self)

    async def zadd(self, key, mapping):
        zs = self.zsets.setdefault(key, {})
        zs.update(mapping)

    async def expire(self, key, seconds):
        self.ttls = getattr(self, "ttls", {})
        self.ttls[key] = seconds

    async def zrange(self, key, start, stop, withscores=False):
        zs = self.zsets.get(key, {})
        items = sorted(zs.items(), key=lambda kv: kv[1])
        sliced = items[start:] if stop == -1 else items[start:stop + 1]
        return [(m, s) for m, s in sliced] if withscores else [m for m, _ in sliced]


@pytest.fixture
def fake_redis():
    return FakeRedis()


async def test_allow_within_limit_then_reject(fake_redis):
    limiter = RedisSlidingWindowRateLimiter(fake_redis, limit=2, window_seconds=60)
    assert await limiter.allow("user:u1", now=1000.0) is True
    assert await limiter.allow("user:u1", now=1001.0) is True
    assert await limiter.allow("user:u1", now=1002.0) is False
    # 超限请求不占用配额：窗口内仍只有 2 个成员
    assert len(fake_redis.zsets["piwren:rl:user:u1"]) == 2


async def test_sliding_window_expiry_frees_quota(fake_redis):
    limiter = RedisSlidingWindowRateLimiter(fake_redis, limit=1, window_seconds=60)
    assert await limiter.allow("user:u1", now=1000.0) is True
    # 60s 内：拒绝
    assert await limiter.allow("user:u1", now=1030.0) is False
    # 60s 后：过期成员被清理，配额释放
    assert await limiter.allow("user:u1", now=1061.0) is True


async def test_keys_are_isolated(fake_redis):
    limiter = RedisSlidingWindowRateLimiter(fake_redis, limit=1, window_seconds=60)
    assert await limiter.allow("user:u1", now=1000.0) is True
    assert await limiter.allow("user:u2", now=1000.0) is True


async def test_retry_after_uses_oldest_member(fake_redis):
    limiter = RedisSlidingWindowRateLimiter(fake_redis, limit=1, window_seconds=60)
    await limiter.allow("user:u1", now=1000.0)
    retry = await limiter.retry_after("user:u1", now=1010.0)
    assert retry == 51  # 1000 + 60 - 1010 + 1
    assert await limiter.retry_after("user:u1", now=2000.0) == 1  # 窗口已空


async def test_limit_zero_disables(fake_redis):
    limiter = RedisSlidingWindowRateLimiter(fake_redis, limit=0)
    assert await limiter.allow("user:u1") is True


async def test_async_facade_over_both_backends(fake_redis):
    """AsyncRateLimiter 门面：内存/Redis 后端统一 await 语义。"""
    memory = AsyncRateLimiter(SlidingWindowRateLimiter(limit=1, window_seconds=60))
    redis_backed = AsyncRateLimiter(RedisSlidingWindowRateLimiter(fake_redis, limit=1, window_seconds=60))
    assert memory.backend == "memory"
    assert redis_backed.backend == "redis"

    now = time.time()
    for limiter in (memory, redis_backed):
        assert await limiter.allow("k") is True
        assert await limiter.allow("k") is False
        assert await limiter.retry_after("k") >= 1
    assert now  # 时间来源由后端自身决定，门面不感知
