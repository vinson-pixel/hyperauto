# 営業AIシステム バックログ

> **ルール**: 辛口評価で出た問題点はここに記録し、次セッション冒頭で確認する。
> 対応済みは `[x]` にしてファイルに残す。

---

## ✅ 完了済み（2026-05-29 本セッション対応）

- [x] `setupAllTriggers()` 欠落トリガー追加: morning_8/noon_12/evening_18/monthly_1 が未作成だったバグ修正（6件に）
- [x] LINEボタン応答改善: 電話対応済み・対応完了ボタン押下時にスプシから顧客名・現場名を読んで返信に含める
- [x] `_setupCaseSheet()` / `setupMainSheet()` ヘッダーをCOL_S定義（23列）と統一（古い14列定義が混在していた）
- [x] `skip` アクションのスプシ更新漏れ修正: LINEの🗑スキップがステータスを「スキップ」に更新するよう修正
- [x] `callClaude __CLAUDE_ERR__` チェック漏れ修正: エラー文字列がGmail下書きに入る危険を排除（S-01/02/04）
- [x] 移転済み自動リード発掘関数を削除: hyperauto側のpauseAutoDiscover等を削除（hyperauto-prospectingに移転済み）
- [x] hyperauto-prospecting: callClaude __CLAUDE_ERR__ チェック漏れ修正（generatePersonalizedEmail / autoFillCompanyDetails）
- [x] **全エージェント callClaude __CLAUDE_ERR__ 完全網羅**: 全デプロイ対象ファイルをスキャンしチェック漏れを全修正
  - hyperauto: S-05スクリプト・断り文句、A-01/02/03 LINE報告、F-01請求書本文・メール添え状・F-04月次サマリー、E-04写真キャプション、P-02日報・P-03発注メール本文・写真キャプション、runSystemCheck
  - hyperauto-prospecting: batch.gs 週次フィードバック・Gmail下書き、ops.gs 業種補完スプシ書き込み
- [x] 自動発掘ステータスUI（統計タブ）のコミット漏れを解消: index_prospecting.html の変更をコミット＆clasp push

## ✅ 完了済み（2026-05-29 /goal 全件対応）

- [x] ① AI検索タイムアウト対策: 経過秒数カウンター表示 + 60秒ガイド（`_searchAreaLoop_`）
- [x] ③ 架電ログ会社名検索: 統計タブに検索UI追加（`getCallLogs` APIも新規追加）
- [x] ④ 下請け管理 全員要確認リセットボタン（`resetAllSubconStatus()`）
- [x] ⑩ アポ日date picker改善: 明日/1週後/2週後/来週月曜 クイックボタン追加
- [x] ⑪ 商談メモ改行保持: `white-space:pre-wrap` をフェーズカードメモに追加
- [x] ⑫ 架電ログページネーション: `_callLogLimit=50` + 「もっと見る(+50件)」ボタン
- [x] ⑯ 下請け管理 評価ソートトグルボタン（★評価順）
- [x] ⑱ 面談済み管理フィルタ保持: 追い中/見積提出フィルタ + localStorage保持
- [x] ⑲ 成約タブ 受注日新しい順ソート（apo→callDate降順）
- [x] ㉑ モバイルタップ範囲: call-btn に min-height:44px（モバイル時）
- [x] 緊急: 詳細パネルがオーバーレイクリックで閉じて入力が消えるバグ修正
- [x] 自動発掘ステータスUI: 統計タブに⏸停止/▶再開ボタン追加（`getAutoDiscoverStatus` API）
- [x] `_loadLimit = 99999`（全件表示）
- [x] `prospectApi` limit `|| 300` → `|| 99999`
- [x] `getSheetByGid_` を utils.gs に追加（ReferenceError修正）
- [x] `pauseAutoDiscover` / `resumeAutoDiscover` を prospectApi に公開

## ✅ 完了済み（以前のセッション）

- [x] ⑬ 「追い中」をUI上「面談済み」に統一
- [x] ⑭ 成約タブの受注日表示修正
- [x] ⑤⑥ syncWonToCustomers N+1問題修正
- [x] ⑨ 発信者名バックフィル機能
- [x] ⑳ GASエラーをUI上バナー表示
- [x] ⑰ 顧客ごとの連絡サイクル設定
- [x] ② 顧客カードに「📞 今日」ワンタップボタン
- [x] EV充電インフラ事業者 商材プリセット追加
- [x] 成約/顧客管理から面談済み管理への差し戻しボタン
- [x] 案件管理機能（見積→発注→工事→請求→完了）
- [x] 受注ステージ会社の顧客管理への自動同期
- [x] ゴミデータフィルタ（電話・URL・住所が全部空ならスキップ）
- [x] hyperauto-prospecting プロジェクト分離（2026-05-29）
- [x] メールAI判定・LINEボタン・スプシ登録の大規模修正（2026-05-29）
  - classifier プロンプト改善（完了報告・請求を「返信必要」に）
  - s01_crmWriter を「案件」のみに限定（「返信必要」はスプシ登録しない）
  - [ID:msgId] を備考列に埋め込み、LINEボタンのWebhook検索に使用
  - _handleCalled / _handleStatusUpdate をM列（備考）検索に修正
  - runEmailBackfill の forEach→for ループ修正（50件上限が機能するように）
  - 全角スペース含む重複チェック改善

- [x] **hyperauto の古い prospecting ファイル削除**: Code_prospecting_*.gs, Code_crm.gs, Code_hiroshima_list.gs を削除（参照なし確認済み、2026-05-29）
- [x] **メールAI精度の根本改善**: s01_classifier 完全再設計（2026-05-29）
  - 「マルケン電工は受注側」を system prompt に明示
  - few-shot 8例（案件/返信必要/不要）を追加
  - 判断ルールを決定ツリー形式（✅/❌）に再構成
  - `confidence` フィールド追加（0.0〜1.0）
  - confidence < 0.7 の案件は「要確認」にダウングレード → スプシ自動登録なし
  - `s01_uncertainNotifier` 追加: 🟠 LINE通知で人間が「📋 案件登録」「✅ 返信必要」「🗑 不要」を選択
- [x] **checkProspectingSetup() 追加**: hyperauto-prospecting の GASエディタから実行するとスクリプトプロパティ・トリガーの設定状態を Logger に出力

---

## 📌 アーキテクチャ債務（将来対応）

- **スクリプトプロパティの確認**: hyperauto-prospecting GASエディタで `checkProspectingSetup()` を実行して確認（CLAUDE_API_KEY, XAI_API_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_IDS, PROSPECT_SS_ID）
- **setupProspectingTriggers() の実行**: hyperauto-prospecting GASエディタで手動実行（夜間バッチトリガー設定）。不要なら実行しない
- **スプレッドシートスキーマのバージョン管理**: 列追加マイグレーションが散在
- **LINE button テスト**: 実際のメール受信→LINEボタン押下→スプシ更新フローを本番で確認
