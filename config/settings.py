"""
環境変数・設定管理
.env または OS環境変数から読み込む
"""

import os
from pathlib import Path

_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    with open(_env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


class Settings:
    # Claude API
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

    # xAI (Grok)
    XAI_API_KEY: str = os.environ.get("XAI_API_KEY", "")

    # LINE Messaging API
    LINE_CHANNEL_ACCESS_TOKEN: str = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "")

    # 社員LINEユーザーID（role:UID,role:UID 形式）
    # 例: "manager:Uabc123,owner:Uxyz456,staff1:Ufoo789,staff2:Ubar012"
    LINE_USER_IDS: str = os.environ.get("LINE_USER_IDS", "")

    # 後方互換（単一ユーザーのみの場合）
    LINE_USER_ID: str = os.environ.get("LINE_USER_ID", "")

    # Google スプレッドシートID
    SHEET_ID: str = os.environ.get("SHEET_ID", "")

    # GASオーナーメール
    GAS_OWNER_EMAIL: str = "info@marukendenkou.com"

    # 社員メール一覧（通知・権限管理用）
    STAFF_EMAILS: list[str] = [
        "info@marukendenkou.com",
        "vinson@marukendenkou.com",
        # 他2名は判明次第追加
    ]

    def validate(self) -> list[str]:
        """未設定のキーを返す。空リストなら全OK。"""
        missing = []
        required = [
            "ANTHROPIC_API_KEY",
            "XAI_API_KEY",
            "LINE_CHANNEL_ACCESS_TOKEN",
        ]
        for key in required:
            if not getattr(self, key):
                missing.append(key)

        # LINE_USER_IDS か LINE_USER_ID のどちらかがあればOK
        if not self.LINE_USER_IDS and not self.LINE_USER_ID:
            missing.append("LINE_USER_IDS（または LINE_USER_ID）")

        return missing


settings = Settings()
