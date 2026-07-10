#!/usr/bin/env python3
"""Bounded real-RPC smoke tests for the /reminders command router."""
from __future__ import annotations

import json
import select
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EMPTY_LIST_TIMEOUT = 45
HANDOFF_TIMEOUT = 30
QUIESCENCE_TIMEOUT = 2
HANDOFF_TEXT = "请列出近期待办"
EXTENSION_PATH = str(Path(__file__).resolve().parents[1] / "index.ts")


@dataclass
class RpcSession:
    proc: subprocess.Popen[str]

    @classmethod
    def start(cls) -> "RpcSession":
        return cls(
            proc=subprocess.Popen(
                ["pi", "--mode", "rpc", "--no-session", "--no-extensions", "--extension", EXTENSION_PATH],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        )

    def send(self, event: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(event, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def read_event(self, timeout: float) -> dict[str, Any] | None:
        assert self.proc.stdout is not None
        readable, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not readable:
            return None
        line = self.proc.stdout.readline()
        return json.loads(line) if line else None

    def close(self) -> str:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        assert self.proc.stderr is not None
        return self.proc.stderr.read().strip()


def is_own_extension_error(event: dict[str, Any]) -> bool:
    return str(event.get("extensionPath")) in {"<runtime>", EXTENSION_PATH}


def summarize_event(event: dict[str, Any]) -> str:
    event_type = str(event.get("type"))
    if event_type == "extension_ui_request":
        return f"ui:{event.get('method')}"
    if event_type == "response":
        return f"response:{event.get('id')}:{event.get('success')}"
    if event_type == "tool_execution_start":
        return f"tool_start:{event.get('toolName')}"
    return event_type


def reply_to_ui(session: RpcSession, event: dict[str, Any], expect_default_list: bool = False) -> bool:
    if event.get("method") != "select":
        return False
    if expect_default_list and not str(event.get("title", "")).startswith("近期待办（"):
        raise RuntimeError(f"empty /reminders selected the wrong list: {event}")
    options = event.get("options") or []
    if not options:
        raise RuntimeError("empty /reminders list select has no options")
    session.send({"type": "extension_ui_response", "id": event["id"], "value": options[0]})
    return True


def wait_for_response(session: RpcSession, request_id: str, timeout: float) -> tuple[dict[str, Any], list[str]]:
    seen: list[str] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        event = session.read_event(2)
        if event is None:
            continue
        if event.get("type") == "extension_error" and is_own_extension_error(event):
            raise RuntimeError(f"Extension error: {event}")
        seen.append(summarize_event(event))
        if event.get("type") == "extension_ui_request":
            reply_to_ui(session, event)
            continue
        if event.get("type") == "response" and event.get("id") == request_id:
            if not event.get("success"):
                raise RuntimeError(f"RPC command failed: {event}")
            return event, seen
    raise TimeoutError(f"Timed out waiting for response {request_id}; seen={seen}")


def verify_single_reminders_command(session: RpcSession) -> None:
    session.send({"id": "commands", "type": "get_commands"})
    response, _seen = wait_for_response(session, "commands", timeout=20)
    commands = response.get("data", {}).get("commands", [])
    matches = [command for command in commands if command.get("name") == "reminders"]
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one reminders command, got {matches}")
    command_path = matches[0].get("sourceInfo", {}).get("path", matches[0].get("path", ""))
    if Path(str(command_path)).resolve() != Path(EXTENSION_PATH).resolve():
        raise RuntimeError(f"reminders command was not loaded from {EXTENSION_PATH}: {matches[0]}")


def probe_empty_list(session: RpcSession) -> list[str]:
    session.send({"id": "empty", "type": "prompt", "message": "/reminders"})
    seen: list[str] = []
    response_seen = False
    select_seen = False
    deadline = time.time() + EMPTY_LIST_TIMEOUT
    while time.time() < deadline:
        event = session.read_event(2)
        if event is None:
            continue
        if event.get("type") == "extension_error" and is_own_extension_error(event):
            raise RuntimeError(f"Extension error: {event}")
        summary = summarize_event(event)
        seen.append(summary)
        if event.get("type") == "extension_ui_request":
            select_seen = reply_to_ui(session, event, expect_default_list=True) or select_seen
            continue
        if event.get("type") == "response" and event.get("id") == "empty":
            if not event.get("success"):
                raise RuntimeError(f"empty /reminders rejected: {event}")
            response_seen = True
        if response_seen and select_seen:
            quiet_deadline = time.time() + QUIESCENCE_TIMEOUT
            while time.time() < quiet_deadline:
                tail = session.read_event(min(0.5, quiet_deadline - time.time()))
                if tail is None:
                    continue
                if tail.get("type") == "extension_error" and is_own_extension_error(tail):
                    raise RuntimeError(f"Extension error: {tail}")
                seen.append(summarize_event(tail))
                if tail.get("type") == "extension_ui_request":
                    reply_to_ui(session, tail, expect_default_list=True)
            if "agent_start" in seen or any(item.startswith("tool_start:") for item in seen):
                raise RuntimeError(f"empty /reminders unexpectedly delegated to agent: {seen}")
            return seen
    raise TimeoutError(f"Timed out waiting for empty /reminders list; seen={seen}")


def message_text(message: dict[str, Any]) -> str:
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return ""


def assert_handoff_message(session: RpcSession) -> None:
    session.send({"id": "messages", "type": "get_messages"})
    response, _seen = wait_for_response(session, "messages", timeout=HANDOFF_TIMEOUT)
    messages = response.get("data", {}).get("messages", [])
    if not any(message.get("role") == "user" and message_text(message) == HANDOFF_TEXT for message in messages):
        raise RuntimeError(f"handoff text was not delivered to the current session: {messages}")


def probe_nonempty_handoff(session: RpcSession) -> list[str]:
    session.send({"id": "handoff", "type": "prompt", "message": f"/reminders {HANDOFF_TEXT}"})
    seen: list[str] = []
    response_seen = False
    agent_started = False
    deadline = time.time() + HANDOFF_TIMEOUT
    while time.time() < deadline:
        event = session.read_event(2)
        if event is None:
            continue
        if event.get("type") == "extension_error" and is_own_extension_error(event):
            raise RuntimeError(f"Extension error: {event}")
        seen.append(summarize_event(event))
        if event.get("type") == "extension_ui_request":
            reply_to_ui(session, event)
            continue
        if event.get("type") == "response" and event.get("id") == "handoff":
            if not event.get("success"):
                raise RuntimeError(f"nonempty /reminders rejected: {event}")
            response_seen = True
        if event.get("type") == "agent_start":
            if not response_seen:
                raise RuntimeError(f"agent started before nonempty handoff response: {seen}")
            agent_started = True
        if response_seen and agent_started:
            assert_handoff_message(session)
            return seen
    raise TimeoutError(f"Timed out waiting for nonempty /reminders handoff; seen={seen}")


def main() -> int:
    session = RpcSession.start()
    try:
        verify_single_reminders_command(session)
        empty_events = probe_empty_list(session)
        handoff_events = probe_nonempty_handoff(session)
        print(json.dumps({"status": "ok", "empty": empty_events, "handoff": handoff_events}, ensure_ascii=False))
        return 0
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"session_stderr": stderr}, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
