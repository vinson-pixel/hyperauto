"""
LINE Messaging API 通知モジュール
LINE Notify（2025/3/31終了）の代替実装

送信モード:
  - push:      特定ユーザー1人に送信
  - multicast: 複数ユーザーに一斉送信（最大500人）
"""

import os
import json
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Optional


_PUSH_ENDPOINT       = "https://api.line.me/v2/bot/message/push"
_MULTICAST_ENDPOINT  = "https://api.line.me/v2/bot/message/multicast"


# ─────────────────────────────────────────
# 社員ロール定義
# 通知を絞る際にここで制御する
# ─────────────────────────────────────────
ROLE_ALL      = "all"       # 全社員
ROLE_MANAGER  = "manager"   # 管理者（vinson）のみ
ROLE_OWNER    = "owner"     # 会社オーナーのみ


@dataclass
class LineConfig:
    channel_access_token: str
    # ロール→ユーザーIDのマッピング
    # 例: {"manager": "Uabc...", "owner": "Uxyz...", "staff1": "Ufoo..."}
    users: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "LineConfig":
        token = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")
        if not token:
            raise ValueError("環境変数 LINE_CHANNEL_ACCESS_TOKEN が未設定です")

        # LINE_USER_IDS=manager:Uabc,owner:Uxyz,staff1:Ufoo の形式
        users: dict[str, str] = {}
        raw = os.environ.get("LINE_USER_IDS", "")
        if raw:
            for entry in raw.split(","):
                if ":" in entry:
                    role, uid = entry.strip().split(":", 1)
                    users[role.strip()] = uid.strip()

        # 後方互換: 旧来の LINE_USER_ID（単一）も受け入れる
        single = os.environ.get("LINE_USER_ID", "")
        if single and "manager" not in users:
            users["manager"] = single

        return cls(channel_access_token=token, users=users)

    def get_ids(self, roles: list[str]) -> list[str]:
        """指定ロールのユーザーIDリストを返す。'all' 指定で全員。"""
        if ROLE_ALL in roles:
            return list(self.users.values())
        return [self.users[r] for r in roles if r in self.users]


# ─────────────────────────────────────────
# 内部送信ヘルパー
# ─────────────────────────────────────────

def _post(endpoint: str, payload: dict, token: str) -> bool:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status == 200
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[LINE] HTTPエラー {e.code}: {body}")
        return False
    except urllib.error.URLError as e:
        print(f"[LINE] 接続エラー: {e.reason}")
        return False


# ─────────────────────────────────────────
# 公開API
# ─────────────────────────────────────────

def send_message(
    text: str,
    roles: Optional[list[str]] = None,
    config: Optional[LineConfig] = None,
) -> bool:
    """
    テキストメッセージを送信する。

    roles: 送信先ロールのリスト（例: ["manager", "owner"]）
           省略または None → 全社員に multicast
    """
    if config is None:
        config = LineConfig.from_env()

    target_roles = roles if roles is not None else [ROLE_ALL]
    user_ids = config.get_ids(target_roles)

    if not user_ids:
        print(f"[LINE] 送信対象ユーザーが見つかりません（roles={target_roles}）")
        return False

    messages = [{"type": "text", "text": text}]

    if len(user_ids) == 1:
        return _post(
            _PUSH_ENDPOINT,
            {"to": user_ids[0], "messages": messages},
            config.channel_access_token,
        )
    else:
        return _post(
            _MULTICAST_ENDPOINT,
            {"to": user_ids, "messages": messages},
            config.channel_access_token,
        )


def notify_new_lead(
    priority: str,
    data: dict,
    sheet_id: str = "",
    config: Optional[LineConfig] = None,
) -> bool:
    """
    Agent-004向け: 東京案件の新規メール通知。

    優先度ルール:
      high   → 全社員に通知
      medium → manager（vinson）のみ
      low    → 送信しない
    """
    if priority == "low":
        return True

    roles = [ROLE_ALL] if priority == "high" else [ROLE_MANAGER]

    badge = "🔴高優先度" if priority == "high" else "🟡中優先度"
    amount_str = (
        f"{int(data.get('estAmount', 0)):,}円"
        if data.get("estAmount")
        else "要見積"
    )
    lines = [
        f"{badge}【東京案件】",
        f"顧客: {data.get('customer', '不明')}",
        f"場所: {data.get('location', '不明')}",
        f"工事: {data.get('workType', '不明')}",
        f"金額: {amount_str}",
        data.get("notes", ""),
    ]
    if sheet_id:
        lines.append(f"案件表: https://docs.google.com/spreadsheets/d/{sheet_id}")

    return send_message("\n".join(filter(None, lines)), roles=roles, config=config)


def notify_agent_error(
    agent_name: str,
    error: str,
    config: Optional[LineConfig] = None,
) -> bool:
    """
    Agent-002（Watchdog）向け: エージェント異常通知。
    管理者（manager）にのみ送る。
    """
    text = f"🚨【Watchdog警告】\nAgent: {agent_name}\nエラー: {error}"
    return send_message(text, roles=[ROLE_MANAGER], config=config)


def notify_daily_summary(
    processed: int,
    tokyo: int,
    errors: int,
    config: Optional[LineConfig] = None,
) -> bool:
    """
    日次バッチ完了通知。全社員に送る。
    """
    text = (
        f"📊【日次処理完了】\n"
        f"処理メール数: {processed}件\n"
        f"東京案件: {tokyo}件\n"
        f"エラー: {errors}件"
    )
    return send_message(text, roles=[ROLE_ALL], config=config)


if __name__ == "__main__":
    # 動作確認用
    # cp .env.example .env → 値を埋めてから実行
    result = send_message(
        "✅ LINE Messaging API 接続テスト（hyperauto）",
        roles=[ROLE_MANAGER],
    )
    print("送信成功" if result else "送信失敗")
