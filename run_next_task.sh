#!/bin/bash
# hyperauto バックグラウンドタスクランナー
# LaunchAgent から4時間ごとに呼ばれる

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
source ~/.zshrc 2>/dev/null || true

QUEUE="$HOME/hyperauto/task_queue.md"
LOG="$HOME/hyperauto/logs/task_runner.log"
CLAUDE_BIN="/opt/homebrew/bin/claude"

mkdir -p "$HOME/hyperauto/logs"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') 開始 ===" >> "$LOG"

# 最優先の未完了タスクを探す（urgent > high > medium > normal）
find_next_task() {
  local file="$QUEUE"
  local priority_order=("urgent" "high" "medium" "normal")

  for priority in "${priority_order[@]}"; do
    # - [ ] で始まり、priority: {level} の行を含むブロックを探す
    task=$(awk -v p="$priority" '
      /^- \[ \]/ { task=$0; found=0 }
      task && /priority: / && $0 ~ "priority: " p { found=1 }
      task && found && /^$|^- / && NR > 1 { if (found) print task; task=""; found=0 }
      END { if (task && found) print task }
    ' "$file" 2>/dev/null | head -1)

    if [ -n "$task" ]; then
      echo "$task|$priority"
      return 0
    fi
  done
  return 1
}

TASK_RESULT=$(find_next_task || true)

if [ -z "$TASK_RESULT" ]; then
  echo "未処理タスクなし。終了。" >> "$LOG"
  exit 0
fi

TASK_LINE=$(echo "$TASK_RESULT" | cut -d'|' -f1)
PRIORITY=$(echo "$TASK_RESULT" | cut -d'|' -f2)

echo "対象タスク[$PRIORITY]: $TASK_LINE" >> "$LOG"

# task_queue.md の詳細コンテキストをClaude用プロンプトに渡す
TASK_QUEUE_CONTENT=$(cat "$QUEUE")
TODAY=$(date '+%Y-%m-%d')

PROMPT="あなたはマルケン電工の自動化エンジニアです。

以下のタスクキューから最優先タスクを実行してください。

## 現在のタスクキュー
$TASK_QUEUE_CONTENT

## 指示
1. priority: $PRIORITY のタスクを1つ選んで実装する
2. dirに指定されたディレクトリで作業する
3. 実装が完了したら /Users/lione/hyperauto/task_queue.md の該当行を「- [x]」に変更し、末尾に「- $TODAY 完了」を追記する
4. 完了後に以下のコマンドでLINE通知を送る:
   cd /Users/lione/hyperauto && python3 tools/line_notifier.py '実装完了: {タスク名}' 2>/dev/null || true

重要な制約:
- GASファイルは /Users/lione/hyperauto/gas/ 以下に実装する
- clasp pushはしない（ユーザーが手動でやる）
- APIキーは環境変数から取得（ハードコード禁止）
- 1タスクだけ完了させて終了すること（複数やらない）"

echo "Claudeを呼び出し中..." >> "$LOG"

# claude CLIで非インタラクティブ実行
"$CLAUDE_BIN" \
  --print \
  --model claude-sonnet-4-6 \
  --no-streaming \
  -p "$PROMPT" \
  >> "$LOG" 2>&1 || {
    echo "Claude実行エラー" >> "$LOG"
    exit 1
  }

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 完了 ===" >> "$LOG"
