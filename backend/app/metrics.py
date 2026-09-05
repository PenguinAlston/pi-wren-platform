"""进程内指标（Prometheus 文本格式暴露，零第三方依赖）。

计数器带标签（如 agent/status）；直方图为固定桶（毫秒）。
线程安全：asyncio 事件循环与 asyncio.to_thread 两侧调用均加锁。
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict

DEFAULT_BUCKETS_MS = (1_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000)


def _render_labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    inner = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
    return "{" + inner + "}"


class Metrics:
    def __init__(self, buckets_ms: tuple[int, ...] = DEFAULT_BUCKETS_MS):
        self._lock = threading.Lock()
        self._counters: dict[str, dict[tuple, int]] = defaultdict(lambda: defaultdict(int))
        self._histograms: dict[str, dict[tuple, dict]] = defaultdict(dict)
        self._buckets = tuple(sorted(buckets_ms))
        self._process_start = time.time()

    def inc_counter(self, name: str, value: int = 1, **labels: str) -> None:
        key = tuple(sorted(labels.items()))
        with self._lock:
            self._counters[name][key] += value

    def observe(self, name: str, value_ms: float) -> None:
        with self._lock:
            bucket_state = self._histograms[name].setdefault(
                (), {"counts": [0] * (len(self._buckets) + 1), "sum": 0.0, "count": 0}
            )
            idx = len(self._buckets)
            for i, bound in enumerate(self._buckets):
                if value_ms <= bound:
                    idx = i
                    break
            bucket_state["counts"][idx] += 1
            bucket_state["sum"] += value_ms
            bucket_state["count"] += 1

    # --- 暴露 ---

    def render(self) -> str:
        with self._lock:
            lines: list[str] = []
            uptime = time.time() - self._process_start
            lines.append("# HELP piwren_process_uptime_seconds Process uptime in seconds")
            lines.append("# TYPE piwren_process_uptime_seconds gauge")
            lines.append(f"piwren_process_uptime_seconds {uptime:.1f}")

            for name, series in sorted(self._counters.items()):
                metric = f"piwren_{name}_total"
                lines.append(f"# HELP {metric} Counter {name}")
                lines.append(f"# TYPE {metric} counter")
                for key, value in sorted(series.items()):
                    lines.append(f"{metric}{_render_labels(dict(key))} {value}")

            for name, _ in sorted(self._histograms.items()):
                metric = f"piwren_{name}_milliseconds"
                lines.append(f"# HELP {metric} Histogram {name} in milliseconds")
                lines.append(f"# TYPE {metric} histogram")
                state = self._histograms[name].get(())
                if not state:
                    continue
                cumulative = 0
                for bound, cnt in zip(self._buckets, state["counts"]):
                    cumulative += cnt
                    lines.append(f'{metric}_bucket{{le="{bound}"}} {cumulative}')
                cumulative += state["counts"][-1]
                lines.append(f'{metric}_bucket{{le="+Inf"}} {cumulative}')
                lines.append(f'{metric}_sum {state["sum"]:.1f}')
                lines.append(f'{metric}_count {state["count"]}')
            return "\n".join(lines) + "\n"


metrics = Metrics()
