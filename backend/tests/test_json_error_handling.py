"""非法请求体处理：编码错误/坏 JSON → 400（而非 500）。"""
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import create_app


def _build() -> TestClient:
    """不跑 lifespan（避免真实依赖），注入最小 AppState 桩满足中间件。"""
    app = create_app()
    app.state.app_state = SimpleNamespace(
        settings=SimpleNamespace(AUTH_ENABLED=False, AUTH_COOKIE_NAME="piwren_session"),
        agents={},
    )
    return TestClient(app)


def test_gbk_bytes_body_returns_400():
    client = _build()
    # GBK 编码的中文 body（历史上会被误报 500）
    body = '{"message":"各险种"}'.encode("gbk")
    response = client.post(
        "/api/agent/chat",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert "UTF-8" in response.json()["error"]


def test_broken_json_returns_400():
    client = _build()
    response = client.post(
        "/api/agent/chat",
        content=b"{not-json",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
