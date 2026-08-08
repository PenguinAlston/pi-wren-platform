"""跨层共享的 Pydantic 模型（对应 TS packages/shared-types）。

API 契约层，保持与前端 Next.js 的 JSON schema 一致。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# --- Chat ---
ChatRole = Literal["system", "user", "assistant", "tool"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str


# --- Agent events ---
AgentEventType = Literal["plan", "tool_call", "tool_result", "observation", "answer", "error"]


class AgentEvent(BaseModel):
    id: str
    type: AgentEventType
    label: str
    detail: str | None = None
    timestamp: str


class AgentToolCall(BaseModel):
    name: str
    input: Any = None
    output: Any = None
    durationMs: int = 0
    ok: bool = True


class AgentRunResult(BaseModel):
    sessionId: str
    answer: str
    sql: str | None = None
    data: list[dict[str, Any]] | None = None
    trace: list[str] = Field(default_factory=list)
    events: list[AgentEvent] = Field(default_factory=list)
    toolCalls: list[AgentToolCall] = Field(default_factory=list)
    durationMs: int = 0
    error: str | None = None


# --- Data ---
class QueryResult(BaseModel):
    rows: list[dict[str, Any]]
    count: int | None = None


# --- Agent listing ---
class AgentInfo(BaseModel):
    id: str
    label: str
    description: str = ""
    metrics: list[dict[str, Any]] = Field(default_factory=list)
    source: Literal["builtin", "custom"] = "builtin"


# --- Chat request ---
class ChatRequest(BaseModel):
    message: str
    sessionId: str | None = None
