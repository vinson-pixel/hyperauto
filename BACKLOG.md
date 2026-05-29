# 営業AIシステム バックログ

> **ルール**: 辛口評価で出た問題点はここに記録し、次セッション冒頭で確認する。
> 対応済みは `[x]` にしてファイルに残す。

---

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

---

## 📌 アーキテクチャ債務（将来対応）

- **hyperauto の古い prospecting ファイル削除**: 慎重に確認してから削除（現状はそのまま残存）
- **スクリプトプロパティのコピー**: hyperauto-prospecting に CLAUDE_API_KEY, XAI_API_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_IDS, PROSPECT_SS_ID が設定されているか確認
- **setupProspectingTriggers() の実行**: hyperauto-prospecting で夜間バッチトリガーを設定（不要なら実行しない）
- **スプレッドシートスキーマのバージョン管理**: 列追加マイグレーションが散在
- **メールAI精度の根本改善**: 新規案件の定義をAIに正確に理解させる再設計
