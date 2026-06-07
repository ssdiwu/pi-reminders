#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import select
import subprocess
import time
from dataclasses import dataclass
from typing import Any

DEFAULT_LIST = "近期待办"
DEFAULT_DUE = "2026-06-08 11:30"
UI_NO_REPLY_METHODS = {"notify", "setStatus", "setWidget", "set_editor_text", "setTitle"}


@dataclass
class RpcSession:
    proc: subprocess.Popen[str]

    @classmethod
    def start(cls) -> "RpcSession":
        proc = subprocess.Popen(
            ["pi", "--mode", "rpc", "--no-session"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return cls(proc=proc)

    def send(self, obj: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

    def read_event(self, timeout: float) -> dict[str, Any] | None:
        assert self.proc.stdout is not None
        readable, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not readable:
            return None
        line = self.proc.stdout.readline()
        if not line:
            return None
        return json.loads(line.rstrip("\n"))

    def close(self) -> str:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        assert self.proc.stderr is not None
        return self.proc.stderr.read().strip()


def rem_json(args: list[str], check: bool = True) -> Any:
    cp = subprocess.run(["rem", *args, "-o", "json"], text=True, capture_output=True)
    if check and cp.returncode != 0:
        details = cp.stderr.strip() or cp.stdout.strip()
        raise RuntimeError(f"rem {' '.join(args)} failed: {details}")
    return json.loads(cp.stdout) if cp.stdout.strip() else None


def handle_ui_request(session: RpcSession, event: dict[str, Any], expected_title: str | None = None) -> None:
    method = event.get("method")
    request_id = event.get("id")
    if method == "confirm":
        session.send({"type": "extension_ui_response", "id": request_id, "confirmed": True})
        return
    if method == "select":
        options = event.get("options") or []
        selected = pick_option(options, expected_title)
        session.send({"type": "extension_ui_response", "id": request_id, "value": selected})
        return
    if method in UI_NO_REPLY_METHODS:
        return
    raise RuntimeError(f"Unhandled extension UI method: {method}")


def pick_option(options: list[str], expected_title: str | None) -> str:
    if not options:
        raise RuntimeError("select request has no options")
    if not expected_title:
        return options[0]
    for option in options:
        if expected_title in option:
            return option
    return options[0]


def wait_for_response(
    session: RpcSession,
    request_id: str,
    timeout: float,
    expected_title: str | None = None,
) -> list[str]:
    seen: list[str] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        event = session.read_event(2)
        if event is None:
            continue
        event_type = str(event.get("type"))
        seen.append(event_type)
        if event_type == "extension_ui_request":
            handle_ui_request(session, event, expected_title=expected_title)
            continue
        if event_type == "response" and event.get("id") == request_id:
            if not event.get("success"):
                raise RuntimeError(f"RPC command failed: {event}")
            return seen
    raise TimeoutError(f"Timed out waiting for response: {request_id}; seen={seen}")


def verify_command_registered(session: RpcSession) -> None:
    session.send({"id": "commands", "type": "get_commands"})
    wait_for_response(session, "commands", timeout=20)


def ensure_reminder_added(list_name: str, title: str) -> str:
    items = rem_json(["list", "-l", list_name, "--search", title, "--incomplete"])
    if not items:
        raise RuntimeError(f"add verification failed: reminder not found: {title}")
    return str(items[0]["id"])


def ensure_reminder_deleted(reminder_id: str) -> None:
    cp = subprocess.run(["rem", "show", reminder_id, "-o", "json"], text=True, capture_output=True)
    if cp.returncode == 0:
        raise RuntimeError(f"delete verification failed: reminder still exists: {reminder_id}")


def run_cycle(index: int, list_name: str, due: str) -> dict[str, Any]:
    title = f"PI_RPC_TEST_{index}_{int(time.time())}"
    session = RpcSession.start()
    try:
        verify_command_registered(session)
        session.send({"id": "add", "type": "prompt", "message": f"/reminders add {title} {due}"})
        add_seen = wait_for_response(session, "add", timeout=30)
        reminder_id = ensure_reminder_added(list_name, title)

        session.send({"id": "list", "type": "prompt", "message": f"/reminders list {title}"})
        list_seen = wait_for_response(session, "list", timeout=30, expected_title=title)

        session.send({"id": "complete", "type": "prompt", "message": f"/reminders complete {title}"})
        complete_seen = wait_for_response(session, "complete", timeout=30)

        session.send({"id": "delete", "type": "prompt", "message": f"/reminders delete {title}"})
        delete_seen = wait_for_response(session, "delete", timeout=40)
        ensure_reminder_deleted(reminder_id)
        return {
            "status": "ok",
            "title": title,
            "id": reminder_id,
            "events": {
                "add": add_seen,
                "list": list_seen,
                "complete": complete_seen,
                "delete": delete_seen,
            },
        }
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"session_stderr": stderr}, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Real pi RPC regression test for the /reminders extension command flow.")
    parser.add_argument("--runs", type=int, default=1, help="How many add→list→complete→delete cycles to run")
    parser.add_argument("--list", default=DEFAULT_LIST, help="Reminder list name")
    parser.add_argument("--due", default=DEFAULT_DUE, help="Absolute due date passed to /reminders add")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for index in range(1, args.runs + 1):
        result = run_cycle(index=index, list_name=args.list, due=args.due)
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
