# hyperauto — 自動化バックエンド主軸

## プロジェクトの役割
マルケン電工の業務90%をAI自動化するプロジェクト。
GASエージェント・Pythonツール・定期実行ジョブの主軸。

## 各エージェントの役割
- `gas/Code_agent004.gs` — メール受信→LINE転送→案件表自動反映
- `gas/Code_sales_team.gs` — 営業チーム向け自動化
- `gas/Code_admin_team.gs` — 管理チーム向け自動化
- `gas/Code_estimation_team.gs` — 見積チーム向け自動化
- `gas/Code_billing_team.gs` — 請求チーム向け自動化
- `gas/Code_jeca_team.gs` — JECA関連自動化
- `gas/Code_site_team.gs` — 現場チーム向け自動化
- `gas/Code_arsfast.gs` — アースファスト作業報告書の自動送信（旧arsfast-script）
- `tools/line_notifier.py` — LINE通知ツール

## 今後の方針
- eigyo-autoのバックエンド自動化処理もここに統合予定
- 新しい自動化エージェントは必ずここに追加する

## 技術スタック
- Google Apps Script（GAS）
- Python
- LINE Messaging API
- Grok API
