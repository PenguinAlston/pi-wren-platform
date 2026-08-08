"""自研 jsonl 会话仓库（对应 TS services/pi-bridge/src/session-store.ts）。

Pi jsonl 格式：每行一个 JSON entry。会话元数据行 {type: "session", version, id, timestamp, cwd}，
自定义 entry 行 {type: "custom", customType: "conversation_record", data: {...}}。
Python 用标准库 json + asyncio 锁串行化写入，兼容现有文件格式。
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

_RECORD_ENTRY_TYPE = "conversation_record"
_META_ENTRY_TYPE = "session_meta"
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _session_file_path(root: Path, session_id: str) -> Path:
    """Pi 的目录布局：<root>/<cwd-hash>/<timestamp>_<sessionId>.jsonl"""
    cwd_dir = root / f"--{str(Path.cwd()).replace(':', '').replace('\\\\', '-').replace('/', '-')}--"
    cwd_dir.mkdir(parents=True, exist_ok=True)
    ts = _now().replace(":", "-").replace(".", "-")
    return cwd_dir / f"{ts}_{session_id}.jsonl"


class JsonlSessionStore:
    """jsonl 多轮会话仓库：save/get/getHistory/list/rename/delete。"""

    def __init__(self, sessions_root: str | Path | None = None):
        self.root = Path(sessions_root) if sessions_root else Path.cwd() / "data" / "sessions"
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    # --- 写 ---
    async def save(self, session_id: str, question: str, answer: str, sql: str | None, data: list) -> None:
        if not _SESSION_ID_RE.match(session_id):
            raise ValueError(f"invalid sessionId: {session_id}")
        record = {
            "sessionId": session_id,
            "question": question,
            "answer": answer,
            "sql": sql,
            "data": data,
            "createdAt": _now(),
        }
        async with self._lock(session_id):
            path = self._find_session_file(session_id) or self._create_session_file(session_id)
            with open(path, "a", encoding="utf-8") as f:
                entry = {"type": "custom", "customType": _RECORD_ENTRY_TYPE, "data": record}
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    async def rename(self, session_id: str, name: str) -> None:
        if not _SESSION_ID_RE.match(session_id):
            raise ValueError("invalid sessionId")
        title = name.strip()
        if not title:
            raise ValueError("name is required")
        async with self._lock(session_id):
            path = self._find_session_file(session_id)
            if not path:
                raise FileNotFoundError("session not found")
            entry = {
                "type": "custom",
                "customType": _META_ENTRY_TYPE,
                "data": {"title": title, "updatedAt": _now()},
            }
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    async def delete(self, session_id: str) -> bool:
        path = self._find_session_file(session_id)
        if not path:
            return False
        path.unlink(missing_ok=True)
        self._locks.pop(session_id, None)
        return True

    # --- 读 ---
    async def get_history(self, session_id: str) -> list[dict]:
        path = self._find_session_file(session_id)
        if not path:
            return []
        return self._read_records(path)

    async def get(self, session_id: str) -> dict | None:
        records = await self.get_history(session_id)
        return records[-1] if records else None

    async def list_sessions(self) -> list[dict]:
        """会话列表（按最近更新倒序），name 优先重命名，否则首条提问截断。"""
        summaries: list[dict] = []
        for path in sorted(self.root.rglob("*.jsonl")):
            records = self._read_records(path)
            if not records:
                continue
            title = self._read_title(path)
            first = records[0]
            last = records[-1]
            summaries.append({
                "sessionId": first.get("sessionId", path.stem),
                "name": title or self._default_name(first.get("question", "")),
                "createdAt": first.get("createdAt", ""),
                "updatedAt": last.get("createdAt", ""),
                "messageCount": len(records),
            })
        summaries.sort(key=lambda s: s["updatedAt"], reverse=True)
        return summaries

    async def get_session(self, session_id: str) -> dict | None:
        path = self._find_session_file(session_id)
        if not path:
            return None
        records = self._read_records(path)
        if not records:
            return None
        return {
            "name": self._read_title(path) or self._default_name(records[0].get("question", "")),
            "records": records,
        }

    # --- 内部 ---
    def _find_session_file(self, session_id: str) -> Path | None:
        """在 <root>/<cwd-dir>/*.jsonl 中按文件名结尾匹配 sessionId。"""
        for path in self.root.rglob("*.jsonl"):
            if path.stem.endswith(f"_{session_id}") or path.stem == session_id:
                return path
        return None

    def _create_session_file(self, session_id: str) -> Path:
        cwd_dir = self.root / f"--{str(Path.cwd()).replace(':', '').replace('\\\\', '-').replace('/', '-')}--"
        cwd_dir.mkdir(parents=True, exist_ok=True)
        ts = _now().replace(":", "-").replace(".", "-")
        path = cwd_dir / f"{ts}_{session_id}.jsonl"
        header = {
            "type": "session",
            "version": 3,
            "id": session_id,
            "timestamp": _now(),
            "cwd": str(Path.cwd()),
        }
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(header, ensure_ascii=False) + "\n")
        return path

    def _read_records(self, path: Path) -> list[dict]:
        records: list[dict] = []
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if entry.get("type") == "custom" and entry.get("customType") == _RECORD_ENTRY_TYPE:
                        data = entry.get("data", {})
                        if isinstance(data, dict) and data.get("question"):
                            records.append(data)
        except OSError:
            pass
        records.sort(key=lambda r: r.get("createdAt", ""))
        return records

    def _read_title(self, path: Path) -> str | None:
        title: str | None = None
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if entry.get("type") == "custom" and entry.get("customType") == _META_ENTRY_TYPE:
                        t = entry.get("data", {}).get("title")
                        if isinstance(t, str) and t.strip():
                            title = t
        except OSError:
            pass
        return title

    @staticmethod
    def _default_name(question: str) -> str:
        single = " ".join(question.split())
        return single[:30] + "…" if len(single) > 30 else single
