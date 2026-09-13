# 可观测性指南

> 2026-09-13 P2 落地：Prometheus 指标（后端 + 编排层）、Sentry 错误追踪（可选）、Redis 限流共享态。
> 采集配置见 `infra/prometheus.yml` 与 `docker-compose.prod.yml` 的 `monitoring` profile。

## 1. Prometheus 指标

两个进程各自暴露 Prometheus 文本格式端点，零第三方依赖（自研渲染器）：

| 进程 | 端点 | 鉴权 |
|---|---|---|
| Python 后端 | `GET /api/metrics` | AUTH_ENABLED 时需 admin 会话 / `X-Admin-Token`；或 `X-Metrics-Token: <METRICS_TOKEN>` / `Authorization: Bearer <METRICS_TOKEN>` |
| Pi 编排层 | `GET /metrics` | 与其余端点一致：`X-Internal-Token` 或 `Authorization: Bearer <INTERNAL_API_TOKEN>` |

### 指标清单（前缀 `piwren_` / `piwrenpi_`）

后端（`app/metrics.py`，标签直方图）：

- `piwren_http_requests_total{kind,method,status}` — HTTP 请求计数，kind 为粗分类（chat / assistant_proxy / internal_ask_data / internal_traditional_query / internal_graph / traditional_api / graph_api / sessions_api / auth_api / admin_api / feedback_api）
- `piwren_http_duration_milliseconds{kind}` — 请求时延直方图
- `piwren_chat_total{agent,status}` / `piwren_chat_duration_milliseconds` — 经典问数结果与时延
- `piwren_ratelimit_reject_total{scope}` — 限流拒绝（chat / assistant / login）
- `piwren_feedback_total{rating}` — 点赞/点踩
- `piwren_sse_disconnect_total{agent}` — SSE 断连
- `piwren_process_uptime_seconds`

编排层（`services/pi-orchestrator/src/metrics.mjs`）：

- `piwrenpi_http_requests_total{route,status}` — route: sse_run / sessions_* / health / metrics / other
- `piwrenpi_tool_calls_total{tool,status}` — 三工具调用成功/失败
- `piwrenpi_tool_duration_milliseconds{tool}` — 工具耗时直方图
- `piwrenpi_guardrail_rejects_total{tool}` — 护栏拒绝（超次数）
- `piwrenpi_answers_total{status}` / `piwrenpi_answer_duration_milliseconds` — 单轮回答结果与总时长
- `piwrenpi_sse_run_duration_milliseconds` — SSE 全链路时长
- `piwrenpi_process_uptime_seconds`

### 采集接入

```bash
# .env 配置 METRICS_TOKEN 后：
docker compose -f docker-compose.prod.yml --profile monitoring up -d prometheus
# http://<host>:9090/targets 应出现 backend / pi-orchestrator 两个 UP
```

1.6G 小内存主机建议不常驻 Prometheus，把 `infra/prometheus.yml` 复制到外部监控机，
targets 改为 `http://<host>:18080/api/metrics` 与编排层端口即可。

## 2. Sentry 错误追踪（可选，未配置零开销）

- 后端：`.env` 配置 `SENTRY_DSN`（`pip install 'sentry-sdk[fastapi]'` 已入依赖），启动时自动 init，FastAPI 异常自动上报
- 编排层：同名变量 `SENTRY_DSN`（`@sentry/node` 已入依赖），入口文件顶部按需 init
- 采样：`SENTRY_TRACES_SAMPLE_RATE`（默认 0，只上报错误不上报性能采样）

## 3. Redis 限流共享态

- `.env` 配置 `REDIS_URL`（如 `redis://redis:6379/0`）→ 限流（chat/assistant/login）切 Redis ZSET 滑动窗口，多副本一致
- 未配置或连接失败 → 自动降级进程内存（单副本语义，启动日志会注明实际后端）
- 实现：`app/ratelimit.py`（`RedisSlidingWindowRateLimiter` + `AsyncRateLimiter` 统一门面），路由层无感

## 建议的告警规则（示例）

```yaml
# 5xx 突增
- alert: PiwrenHigh5xx
  expr: sum(rate(piwren_http_requests_total{status=~"5.."}[5m])) by (kind) > 0.1
# 问数全错（LLM/语义层故障）
- alert: PiwrenChatAllFailing
  expr: sum(rate(piwren_chat_total{status="error"}[5m])) / sum(rate(piwren_chat_total[5m])) > 0.5
# 工具护栏频繁触发（提示语或模型行为异常）
- alert: PiwrenGuardrailStorm
  expr: rate(piwrenpi_guardrail_rejects_total[10m]) > 0.2
# 编排层上游错误（internal 工具回调 5xx）
- alert: PiwrenInternalToolErrors
  expr: sum(rate(piwren_http_requests_total{kind=~"internal_.*",status=~"5.."}[5m])) > 0
```
