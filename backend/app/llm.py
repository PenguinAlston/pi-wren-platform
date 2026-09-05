"""LLM 构建统一入口：OpenAI 兼容接口（base_url 可指向 DashScope/DeepSeek/vLLM 等）。"""
from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.config import Settings


def _disable_thinking(model: str) -> dict:
    """qwen3 系列默认思考会把回答放进 reasoning_content 导致 content 为空；
    DashScope OpenAI 兼容接口用顶层 enable_thinking=false 禁用思考。"""
    if "qwen" in (model or "").lower():
        return {"extra_body": {"enable_thinking": False}}
    return {}


def build_llm(settings: Settings) -> ChatOpenAI:
    return ChatOpenAI(
        model=settings.OPENAI_MODEL or "gpt-4o-mini",
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        temperature=0,
        max_tokens=800,
        timeout=100,
        **_disable_thinking(settings.OPENAI_MODEL or ""),
    )
