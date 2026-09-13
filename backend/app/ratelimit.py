"""滑动窗口限流：进程内存实现（单副本）与 Redis 实现（多副本共享）。

- 聊天接口按 用户/ IP 限流（LLM 成本防护）
- 登录接口按 IP 限流（暴力破解防护）
- 配置 REDIS_URL 时自动切 Redis 后端（ZSET 滑动窗口），否则进程内存
"""
from __future__ import annotations

import secrets
import threading
import time
from collections import defaultdict, deque

_PRUNE_INTERVAL_SECONDS = 300.0


class SlidingWindowRateLimiter:
    """固定窗口内最多 limit 次；超限返回 False。线程安全（进程内存实现）。"""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        if limit < 0:
            raise ValueError("limit must be >= 0")
        self._limit = limit
        self._window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_prune = time.time()

    @property
    def limit(self) -> int:
        return self._limit

    def allow(self, key: str, now: float | None = None) -> bool:
        """通过则记账并返回 True；超限不记账返回 False。limit=0 表示不限流。"""
        if self._limit == 0:
            return True
        now = time.time() if now is None else now
        with self._lock:
            self._prune_if_due(now)
            events = self._events[key]
            threshold = now - self._window
            while events and events[0] <= threshold:
                events.popleft()
            if len(events) >= self._limit:
                return False
            events.append(now)
            return True

    def retry_after(self, key: str, now: float | None = None) -> int:
        """建议的重试等待秒数（用于 Retry-After 响应头）。"""
        now = time.time() if now is None else now
        with self._lock:
            events = self._events.get(key)
            if not events:
                return 1
            oldest = events[0]
            return max(1, int(oldest + self._window - now) + 1)

    def _prune_if_due(self, now: float) -> None:
        """定期清理全空/过期 key，防止内存无限增长。"""
        if now - self._last_prune < _PRUNE_INTERVAL_SECONDS:
            return
        self._last_prune = now
        threshold = now - self._window
        stale = [k for k, q in self._events.items() if not q or q[-1] <= threshold]
        for k in stale:
            del self._events[k]


class RedisSlidingWindowRateLimiter:
    """Redis ZSET 滑动窗口（多副本共享语义），接口与内存版一致（方法为 async）。"""

    def __init__(self, redis, limit: int, window_seconds: float = 60.0, prefix: str = "piwren:rl"):
        if limit < 0:
            raise ValueError("limit must be >= 0")
        self._redis = redis
        self._limit = limit
        self._window = window_seconds
        self._prefix = prefix

    @property
    def limit(self) -> int:
        return self._limit

    def _key(self, key: str) -> str:
        return f"{self._prefix}:{key}"

    async def allow(self, key: str, now: float | None = None) -> bool:
        """通过则记账并返回 True；超限不记账返回 False。limit=0 表示不限流。"""
        if self._limit == 0:
            return True
        now = time.time() if now is None else now
        zkey = self._key(key)
        threshold = now - self._window
        # 先清理过期成员再看窗口内数量；记账单独写（超限请求不占用配额）
        pipeline = self._redis.pipeline(transaction=True)
        pipeline.zremrangebyscore(zkey, "-inf", threshold)
        pipeline.zcard(zkey)
        _, count = await pipeline.execute()
        if count >= self._limit:
            return False
        # 成员必须唯一（同秒多次请求）：score=时间戳，member=时间戳+随机后缀
        member = f"{now:.6f}:{secrets.token_hex(8)}"
        await self._redis.zadd(zkey, {member: now})
        await self._redis.expire(zkey, int(self._window) + 60)
        return True

    async def retry_after(self, key: str, now: float | None = None) -> int:
        """建议的重试等待秒数（用于 Retry-After 响应头）。"""
        now = time.time() if now is None else now
        oldest = await self._redis.zrange(self._key(key), 0, 0, withscores=True)
        if not oldest:
            return 1
        return max(1, int(oldest[0][1] + self._window - now) + 1)


class AsyncRateLimiter:
    """限流器统一异步门面：屏蔽内存/Redis 后端差异，路由层统一 await 使用。"""

    def __init__(self, backend):
        self._backend = backend

    @property
    def limit(self) -> int:
        return self._backend.limit

    @property
    def backend(self) -> str:
        return "redis" if isinstance(self._backend, RedisSlidingWindowRateLimiter) else "memory"

    async def allow(self, key: str) -> bool:
        result = self._backend.allow(key)
        if hasattr(result, "__await__"):
            return await result
        return result

    async def retry_after(self, key: str) -> int:
        result = self._backend.retry_after(key)
        if hasattr(result, "__await__"):
            return await result
        return result
