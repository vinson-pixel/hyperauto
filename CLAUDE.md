@~/maruken-shared/CLAUDE.md

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

## 技術スタック
- Google Apps Script（GAS）
- Python
- LINE Messaging API
- Grok API

## デプロイルール（重要）

### GASバージョン上限について
- このプロジェクトはGASバージョン上限200に達している
- **`clasp deploy` は絶対に実行しない**（バージョンが消費されるため）
- コード変更は **`clasp push` のみ** で反映する
- 営業AIシステムは @HEAD デプロイで運用中（pushで即反映される）

### 営業AIシステムの正しいURL
```
https://script.google.com/macros/s/AKfycbwehtYPJyObKIqDRnj6QVCD4eEYJggG__5XJTQrfsCi/exec?page=prospecting
```

### 将来的な分離方針
- prospecting関連ファイル（Code_prospecting_*.gs, Code_crm.gs, index_prospecting.html）は
  将来的に別GASプロジェクトに分割する
- 新プロジェクト作成時は `clasp create --type webapp` で専用プロジェクトを作る

## バックログ

未対応の改善課題は [BACKLOG.md](BACKLOG.md) で管理する。
辛口評価で出た問題点は必ずそこに追記すること。

## 注意

maruken-shared の TypeScript/Next.js 品質ルールはこのプロジェクトには適用しない（GAS/Python のため）。
