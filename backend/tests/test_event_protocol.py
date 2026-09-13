"""事件协议双端契约：后端 pydantic 模型字段与 Node 侧 JSON Schema 对齐（防漂移）。

schema 权威文件：services/pi-orchestrator/protocol/events.schema.json
"""
import json
from pathlib import Path

from app.models.schemas import AgentEvent, AgentRunResult

SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "services" / "pi-orchestrator" / "protocol" / "events.schema.json"
)


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_ui_event_fields_match_agent_event():
    props = set(_schema()["$defs"]["uiEvent"]["properties"])
    model_fields = set(AgentEvent.model_fields)
    # schema 是 Node 侧产出契约：字段应与后端 AgentEvent 完全一致
    assert props == model_fields, f"uiEvent 字段漂移: schema={props}, model={model_fields}"


def test_ui_event_types_cover_agent_event_types():
    schema_types = set(_schema()["$defs"]["uiEvent"]["properties"]["type"]["enum"])
    model_types = set(AgentEvent.model_fields["type"].annotation.__args__)
    assert schema_types == model_types, f"事件类型漂移: schema={schema_types}, model={model_types}"


def test_done_frame_fields_match_agent_run_result():
    done = _schema()["$defs"]["doneFrame"]
    required = set(done["required"])
    model_fields = set(AgentRunResult.model_fields)
    # done 帧是 AgentRunResult 的子集（trace 不下发；messageId/error/sql/data 可为 null）
    missing = required - model_fields
    undeclared = set(done["properties"]) - model_fields
    assert not missing, f"doneFrame 必填字段在 AgentRunResult 中缺失: {missing}"
    assert not undeclared, f"doneFrame 声明了 AgentRunResult 不存在的字段: {undeclared}"


def test_answer_delta_def_exists_for_streaming():
    assert "answerDelta" in _schema()["$defs"]
