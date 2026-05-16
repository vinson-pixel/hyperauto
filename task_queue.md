# マルケン電工 全社タスクキュー

> **ルール**: 全プロジェクト共通の引き継ぎファイル。どのセッションで作業を始めても最初にここを読む。
> 完了したら `[x]` にして priority を `done` に変更。
> エージェントが毎朝6時に読んで当日の作業計画をLINEに送る。

---

## 🔴 今週中（期限: 2026-05-29 JECA FAIR 展示会当日）

- [ ] **J-01-TEST** JECA名刺登録フォームの実機テスト
  - priority: urgent
  - project: hyperauto
  - detail: |
      スマホでフォームURLを開いて名刺を撮影 → CRMシートに登録されるか確認 → LINE通知届くか確認
      フォームURL: https://script.google.com/macros/s/AKfycbzIQOfWwv1Ty1FiBjIYicw2rsF8cK5ynyHzIgPCFivPulBloPCx7SVm2ghieqS-y-iHtA/exec
      CRMシート: https://docs.google.com/spreadsheets/d/1I1owPZ8Bna5_SrVSXsYnAGyYRVImpqcudC4UikXR8kE/edit
      GASエディタ: https://script.google.com/d/1w8MRAoaU5d5aDfkP8ypGOBGl--tpXWqes4kD3ErtnKZulFN1QrglvQkE/edit
      確認項目: CLAUDE_API_KEY、JECA_SHEET_ID がスクリプトプロパティに設定されているか

- [ ] **JECA-FLOW** 展示会当日フローの最終確認
  - priority: urgent
  - project: hyperauto
  - detail: |
      名刺持ち帰り → 翌日シートに手入力 → runThankYouBatch('draft') → Gmail下書き確認・送信 → runFollowUpCampaign()
      展示会: 2026-05-29 東京ビッグサイト

---

## 🟠 今月中（2026年5月）

- [ ] **HIROSHIMA-SCRAPE** 広島電気スクレイピング完了
  - priority: high
  - project: Desktop
  - detail: |
      現在1350/1772社完了（76%）。残り422社。
      スクリプト: /Users/lione/Desktop/scrape_hiroshima_denki.py
      途中結果: /Users/lione/Desktop/partial_10.csv, partial_20.csv
      完了後の出力先: /Users/lione/hyperauto/data/hiroshima_denki_emails.csv
      実行: cd /Users/lione/Desktop && python scrape_hiroshima_denki.py

- [ ] **S-01-UNIVERSAL** S-01 メール判定エージェント全社汎用化
  - priority: high
  - project: hyperauto
  - file: gas/Code_agent004.gs
  - detail: |
      「東京案件」フィルタを削除 → 地域/案件種別/緊急度の3軸判定に変更
      全メール対象（愛知・東京問わず）
      GAS: https://script.google.com/d/1_A0og40v-uNBy3h8lOnZPkJgKeBm7b8JkngD82z7j5nVdcfmy06a2j46/edit

- [ ] **TASKS-FEATURE** タスク管理機能の実装
  - priority: medium
  - project: eigyo-auto または genba-platform（要確認）
  - detail: |
      /Users/lione/Desktop/タスク管理_引き継ぎ.md に完全なコードあり
      Supabaseにtasksテーブル作成 → API実装 → ページ追加 → ダッシュボードにリンク追加
      どのプロジェクトに入れるか決定が必要

---

## 🟡 来月（2026年6月）

- [ ] **S-03** 名刺管理・リードスコアリング（JECA後に汎用化）
  - priority: normal
  - project: hyperauto
  - detail: JECA_CRMシートのリードに対してスコアリングを汎用CRMに発展させる

- [ ] **F-01** 請求書自動生成エージェント
  - priority: normal
  - project: hyperauto
  - detail: 案件シートの完了案件 → 請求書PDF自動生成 → Gmail添付送信

- [ ] **S-04** フォローアップメール自動送信
  - priority: normal
  - project: hyperauto

- [ ] **EIGYO-REVIEW** eigyo-auto コードレビュー & 改善
  - priority: normal
  - project: eigyo-auto
  - detail: |
      CLAUDE.mdの毎セッションチェックリストを実行
      maxDuration未設定API / any型 / console.log残留 / エラーハンドリング

- [ ] **GENBA-NEXT** genba-platform 次機能
  - priority: normal
  - project: genba-platform
  - detail: 未定。社長ノウハウ追加候補が出たら記入する

- [ ] **BRO-STATUS** broccoli/Bro CEO 稼働状況確認
  - priority: normal
  - project: broccoli
  - detail: |
      /Users/lione/broccoli/ の稼働状態を確認
      起動中か停止中か確認して、必要なら再起動・修正

---

## 完了済み ✅

- [x] S-01 初期デプロイ（東京案件判定・LINE通知）- 2026-05-09
- [x] E-01 見積書自動生成 - 稼働中
- [x] A-01 業務報告エージェント POC - 完成
- [x] **J-01** 名刺スキャン→CRM登録 実装・GASデプロイ完了 - 2026-05-16
- [x] **J-02** 展示会後一斉御礼メール（runThankYouBatch）- GAS実装完了 - 2026-05-16
- [x] **J-03** 個別フォローメール（runFollowUpCampaign）- GAS実装完了 - 2026-05-16

---

## プロジェクト別リンク集

| プロジェクト | パス | 目的 |
|------------|------|------|
| hyperauto | /Users/lione/hyperauto | 業務自動化エージェント群（GAS + Python） |
| genba-platform | /Users/lione/genba-platform | 現場管理プラットフォーム（Next.js + Supabase） |
| eigyo-auto | /Users/lione/eigyo-auto | 営業自動化UI（Next.js + Supabase） |
| broccoli | /Users/lione/broccoli | Bro CEO 自律型エージェント |
