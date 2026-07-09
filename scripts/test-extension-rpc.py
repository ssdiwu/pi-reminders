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


def osa_run(script: str) -> str:
    cp = subprocess.run(["osascript"], input=script, capture_output=True, text=True)
    return cp.stdout.strip()


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
    script = f'''
    tell application "Reminders"
      repeat with r in reminders of list "{list_name}"
        if name of r is "{title}" then return (id of r) as string
      end repeat
      return "NOT_FOUND"
    end tell'''
    out = osa_run(script)
    if out == "NOT_FOUND":
        raise RuntimeError(f"add verification failed: reminder not found: {title}")
    return out


def ensure_multiple_reminders_added(list_name: str, titles: list[str]) -> list[str]:
    return [ensure_reminder_added(list_name, title) for title in titles]


def ensure_reminder_deleted(reminder_id: str) -> None:
    full_id = reminder_id if reminder_id.startswith("x-apple-reminder://") else "x-apple-reminder://" + reminder_id
    script = f'''
    tell application "Reminders"
      repeat with lst in lists
        repeat with r in reminders of lst
          if (id of r as string) is "{full_id}" then return "EXISTS"
        end repeat
      end repeat
      return "GONE"
    end tell'''
    out = osa_run(script)
    if "EXISTS" in out:
        raise RuntimeError(f"delete verification failed: reminder still exists: {reminder_id}")


def ensure_reminder_completed(reminder_id: str) -> None:
    full_id = reminder_id if reminder_id.startswith("x-apple-reminder://") else "x-apple-reminder://" + reminder_id
    script = f'''
    tell application "Reminders"
      repeat with lst in lists
        repeat with r in reminders of lst
          if (id of r as string) is "{full_id}" then return (completed of r as string)
        end repeat
      end repeat
      return "NOT_FOUND"
    end tell'''
    out = osa_run(script)
    if out != "true":
        raise RuntimeError(f"complete verification failed: reminder not completed: {reminder_id} (got {out})")


def read_reminder_fields(reminder_id: str) -> dict[str, str]:
    full_id = reminder_id if reminder_id.startswith("x-apple-reminder://") else "x-apple-reminder://" + reminder_id
    script = f'''
    use framework "Foundation"
    tell application "Reminders"
      set us to character id 31
      set df to current application's NSDateFormatter's alloc()'s init()
      df's setDateFormat:"yyyy-MM-dd HH:mm"
      repeat with lst in lists
        repeat with r in reminders of lst
          if (id of r as string) is "{full_id}" then
            set rName to name of r
            set rDue to ""
            try
              set d to due date of r
              if d is not missing value then set rDue to (df's stringFromDate:(d as date)) as string
            end try
            set rBody to ""
            try
              set theBody to body of r
              if theBody is not missing value then set rBody to theBody
            end try
            return rName & us & rDue & us & rBody
          end if
        end repeat
      end repeat
      return "NOT_FOUND"
    end tell'''
    out = osa_run(script)
    if out == "NOT_FOUND":
        raise RuntimeError(f"reminder not found: {reminder_id}")
    parts = out.split("\x1f")
    while len(parts) < 3:
        parts.append("")
    return {"name": parts[0], "due": parts[1], "body": parts[2]}


def ensure_reminder_field(reminder_id: str, field: str, expected: str) -> None:
    fields = read_reminder_fields(reminder_id)
    actual = fields[field]
    if actual != expected:
        raise RuntimeError(f"update {field} verification failed: expected '{expected}', got '{actual}'")


def run_cycle(index: int, list_name: str, due: str) -> dict[str, Any]:
    title = f"PI_RPC_TEST_{index}_{int(time.time())}"
    session = RpcSession.start()
    try:
        verify_command_registered(session)
        session.send({"id": "add", "type": "prompt", "message": f"/reminders add {title} {due}"})
        add_seen = wait_for_response(session, "add", timeout=30)
        reminder_id = ensure_reminder_added(list_name, title)
        pure_id = reminder_id.replace("x-apple-reminder://", "")

        new_title = f"{title}_U"
        session.send({"id": "upd_title", "type": "prompt", "message": f'/reminders update {pure_id} --title "{new_title}"'})
        upd_title_seen = wait_for_response(session, "upd_title", timeout=30)
        ensure_reminder_field(reminder_id, "name", new_title)

        new_due = "2026-07-09 13:37"
        session.send({"id": "upd_due", "type": "prompt", "message": f'/reminders update {pure_id} --due "{new_due}"'})
        upd_due_seen = wait_for_response(session, "upd_due", timeout=30)
        ensure_reminder_field(reminder_id, "due", new_due)

        new_body = "更新备注 body"
        session.send({"id": "upd_body", "type": "prompt", "message": f'/reminders update {pure_id} --body "{new_body}"'})
        upd_body_seen = wait_for_response(session, "upd_body", timeout=30)
        ensure_reminder_field(reminder_id, "body", new_body)

        session.send({"id": "list", "type": "prompt", "message": f"/reminders list {new_title}"})
        list_seen = wait_for_response(session, "list", timeout=30, expected_title=new_title)

        session.send({"id": "complete", "type": "prompt", "message": f"/reminders complete {new_title}"})
        complete_seen = wait_for_response(session, "complete", timeout=30)
        ensure_reminder_completed(reminder_id)

        session.send({"id": "delete", "type": "prompt", "message": f"/reminders delete {new_title}"})
        delete_seen = wait_for_response(session, "delete", timeout=40)
        ensure_reminder_deleted(reminder_id)
        return {
            "status": "ok",
            "title": title,
            "id": reminder_id,
            "events": {
                "add": add_seen,
                "update_title": upd_title_seen,
                "update_due": upd_due_seen,
                "update_body": upd_body_seen,
                "list": list_seen,
                "complete": complete_seen,
                "delete": delete_seen,
            },
        }
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"session_stderr": stderr}, ensure_ascii=False))


def run_batch_cycle(index: int, list_name: str, item_count: int) -> dict[str, Any]:
    now = int(time.time())
    titles = [f"PI_RPC_BATCH_{chr(65 + idx)}_{index}_{now}" for idx in range(item_count)]
    due_values = ["2026-06-09 09:00", "2026-06-09 11:00", "2026-06-09 15:00"][:item_count]
    segments = [f"{title} {due}" for title, due in zip(titles, due_values, strict=True)]
    prompt = "/reminders add " + "; ".join(segments)
    request_id = f"batch_add_{item_count}"
    session = RpcSession.start()
    try:
        verify_command_registered(session)
        session.send({"id": request_id, "type": "prompt", "message": prompt})
        add_seen = wait_for_response(session, request_id, timeout=30)
        reminder_ids = ensure_multiple_reminders_added(list_name, titles)

        for idx, title in enumerate(titles):
            delete_id = f"delete_{item_count}_{idx}"
            session.send({"id": delete_id, "type": "prompt", "message": f"/reminders delete {title}"})
            wait_for_response(session, delete_id, timeout=40)
        for reminder_id in reminder_ids:
            ensure_reminder_deleted(reminder_id)

        return {"status": "ok", "titles": titles, "ids": reminder_ids, "events": {request_id: add_seen}}
    finally:
        stderr = session.close()
        if stderr:
            print(json.dumps({"session_stderr": stderr}, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Real pi RPC regression test for the /reminders extension command flow.")
    parser.add_argument("--runs", type=int, default=1, help="How many add→list→complete→delete cycles to run")
    parser.add_argument("--list", default=DEFAULT_LIST, help="Reminder list name")
    parser.add_argument("--due", default=DEFAULT_DUE, help="Absolute due date passed to /reminders add")
    parser.add_argument("--batch-runs", type=int, default=0, help="How many 2-item batch add cycles to run")
    parser.add_argument("--triple-batch-runs", type=int, default=0, help="How many 3-item batch add cycles to run")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for index in range(1, args.runs + 1):
        result = run_cycle(index=index, list_name=args.list, due=args.due)
        print(json.dumps(result, ensure_ascii=False))
    for index in range(1, args.batch_runs + 1):
        result = run_batch_cycle(index=index, list_name=args.list, item_count=2)
        print(json.dumps(result, ensure_ascii=False))
    for index in range(1, args.triple_batch_runs + 1):
        result = run_batch_cycle(index=index, list_name=args.list, item_count=3)
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
