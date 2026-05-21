# マルケン電工 全社タスクキュー

> **ルール**: 全プロジェクト共通の引き継ぎファイル。どのセッションで作業を始めても最初にここを読む。
> 完了したら `[x]` にして priority を `done` に変更。
> エージェントが毎朝6時に読んで当日の作業計画をLINEに送る。

---

## 🔴 今週中（期限: 2026-05-29 JECA FAIR 展示会当日）

- [x] **J-01-TEST** JECA名刺登録フォームの実機テスト - 2026-05-17完了
- [x] **JECA-FLOW** 展示会当日フローの最終確認 - 2026-05-17完了
      バッチ登録・カテゴリ分類・御礼メール下書き生成まで動作確認済み

---

## 🟠 今月中（2026年5月）

- [x] **HIROSHIMA-SCRAPE** 広島電気1772社→prospectingに組み込み完了（2026-05-19）
      Google Places APIで電話番号補完しながら60社ずつバッチインポート。営業リスト管理UIのリード発掘タブから実行可能。

- [x] **S-01-UNIVERSAL** S-01 メール判定エージェント全社汎用化 - コード確認済み・実装済み（2026-05-17）

- [x] **TASKS-FEATURE** タスク管理機能の実装 - 社長の総合プラットフォームに組み込み済み（2026-05-19）

---

## 🟡 来月（2026年6月）

- [x] **S-03** 名刺管理・リードスコアリング汎用化 - 完了（2026-05-19）
      CardForm URLに ?event=イベント名 を付けると prospectingシートに直接登録。カテゴリ→listType・ランク→ステージ自動変換。

- [x] **F-01** 請求書自動生成エージェント - 社長が作成済み（2026-05-20）

- [x] **S-04** フォローアップメール自動送信 - 完了（2026-05-19）
      毎朝8時トリガー・Claude Haiku個別生成・下書きモード・30社/回上限。UIのメールタブから設定。

- [x] **EIGYO-REVIEW** eigyo-auto コードレビュー & 改善 - 問題なし（2026-05-20）
      全チェック通過：maxDuration/any型/console.log/エラーハンドリング すべて問題なし

- [x] **GENBA-NEXT-3** 作業後報告システム（新規）- 完了（2026-05-20）
      worker_completion_reports テーブル・/api/worker-report・/w/[token]/report・報告タブ実装済み
      残: Supabase SQL Editor でマイグレーション実行が必要

- [ ] **GENBA-NEXT-2** 手順書UI改善（素人向け）
  - priority: normal
  - project: genba-platform
  - detail: |
      ② WorkerView のUI改善
      　- ステップカード大きく・シンプルに
      　- 専門用語に補足
      　- ⚠️危険・📸写真必須アイコン大きく
      　- スマホ最適化

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
