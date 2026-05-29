@~/maruken-shared/CLAUDE.md

# hyperauto — 自動化バックエンド主軸

## プロジェクトの役割
マルケン電工の業務自動化バックエンド。
GASエージェント・Pythonツール・定期実行ジョブの主軸。

## 各エージェントの役割
- `gas/Code_sales_team.gs` — 営業チーム自動化（メール受信→AI判定→LINE通知）
- `gas/Code_admin_team.gs` — 管理チーム向け自動化
- `gas/Code_estimation_team.gs` — 見積チーム向け自動化
- `gas/Code_billing_team.gs` — 請求チーム向け自動化
- `gas/Code_jeca_team.gs` — JECA関連自動化
- `gas/Code_site_team.gs` — 現場チーム向け自動化
- `gas/Code_arsfast.gs` — アースファスト作業報告書の自動送信

※ 営業AIシステム（prospecting）は `~/hyperauto-prospecting/` に分離済み

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

### push方法
```bash
cd ~/hyperauto && clasp push
```

### このプロジェクトが管理するWebApp URL（arsfast）
```
https://script.google.com/macros/s/AKfycbwehtYPJyObKIqDRnj6QVCD4eEYJggG__5XJTQrfsCi/exec
```
- デフォルト（pageなし）→ アースファスト作業報告書
- `?page=card` → JECA名刺登録フォーム
- `?page=prospecting` → hyperauto-prospectingへ自動リダイレクト

## バックログ

未対応の改善課題は [BACKLOG.md](BACKLOG.md) で管理する。
辛口評価で出た問題点は必ずそこに追記すること。

## 注意

maruken-shared の TypeScript/Next.js 品質ルールはこのプロジェクトには適用しない（GAS/Python のため）。
