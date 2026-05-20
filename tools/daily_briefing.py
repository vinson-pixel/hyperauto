#!/usr/bin/env python3
"""
毎朝6時に実行: task_queue.md を読んで今日の優先タスクをLINEに送る
Hermes cronから: python3 /Users/lione/hyperauto/tools/daily_briefing.py
"""

import sys
import os
import re
from pathlib import Path
from datetime import datetime

# hyperauto設定（LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_IDS を.envから読む）
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

sys.path.insert(0, str(Path(__file__).parent))
from line_notifier import send_message, ROLE_MANAGER

TASK_QUEUE = Path(__file__).parent.parent.parent / "hyperauto" / "task_queue.md"
# フォールバック（絶対パス）
if not TASK_QUEUE.exists():
    TASK_QUEUE = Path("/Users/lione/hyperauto/task_queue.md")


def parse_tasks(md: str) -> dict:
    sections = {"urgent": [], "high": [], "medium": []}
    current = None
    for line in md.splitlines():
        if "🔴" in line or "今週中" in line:
            current = "urgent"
        elif "🟠" in line or "今月中" in line:
            current = "high"
        elif "🟡" in line or "来月" in line:
            current = "medium"
        elif "完了済み" in line or "✅" in line and "##" in line:
            current = None

        if current and line.strip().startswith("- [ ]"):
            # タスク名だけ取り出す（**太字**を除去）
            name = re.sub(r"\*\*(.+?)\*\*", r"\1", line.strip()[5:].strip())
            name = name.split("\n")[0].strip()
            if name:
                sections[current].append(name)
    return sections


def build_message(tasks: dict) -> str:
    today = datetime.now().strftime("%m/%d（%a）")
    lines = [f"📋 {today} 今日のタスク"]

    if tasks["urgent"]:
        lines.append("\n🔴 URGENT（期限近い）")
        for t in tasks["urgent"]:
            lines.append(f"  • {t}")

    if tasks["high"]:
        lines.append("\n🟠 HIGH（今月中）")
        for t in tasks["high"]:
            lines.append(f"  • {t}")

    if not tasks["urgent"] and not tasks["high"]:
        lines.append("\n✅ 急ぎタスクなし")
        if tasks["medium"]:
            lines.append("\n🟡 来月タスク（先取り可）")
            for t in tasks["medium"][:3]:
                lines.append(f"  • {t}")

    lines.append("\n📂 /hyperauto/task_queue.md")
    return "\n".join(lines)


def main():
    if not TASK_QUEUE.exists():
        print(f"[ERROR] task_queue.md が見つかりません: {TASK_QUEUE}")
        sys.exit(1)

    md = TASK_QUEUE.read_text(encoding="utf-8")
    tasks = parse_tasks(md)
    msg = build_message(tasks)
    print(msg)

    ok = send_message(msg, roles=[ROLE_MANAGER])
    if ok:
        print("[OK] LINE送信完了")
    else:
        print("[ERROR] LINE送信失敗（.envのLINE_CHANNEL_ACCESS_TOKEN を確認）")
        sys.exit(1)


if __name__ == "__main__":
    main()
