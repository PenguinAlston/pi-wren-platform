"""滑动窗口限流（进程内存实现，单副本部署语义）。

- 聊天接口按 用户/ IP 限流（LLM 成本防护）
- 登录接口按 IP 限流（暴力破解防护）
多副本部署时需换 Redis 等共享存储，见 architecture.md 待加固清单。
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

_PRUNE_INTERVAL_SECONDS = 300.0


class SlidingWindowRateLimiter:
    """固定窗口内最多 limit 次；超限返回 False。线程安全。"""

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
