# 営業AIシステム DB+バックエンド移行計画

作成日: 2026-05-27  
対象: GAS + Googleスプレッドシート → Next.js + Supabase  
想定開発者: 1名（ヴィンソン）

---

## 1. 推奨技術スタック

### 結論: eigyo-auto（既存）を拡張する

新規プロジェクトを立ち上げるのではなく、既存の `eigyo-auto`（Next.js + Supabase `qppsurknarwkodfagayo.supabase.co`）にテーブルとAPIルートを追加する形を強く推奨する。

**理由:**
- eigyo-auto はすでに「営業自動化UI」として構築されており、目的が完全に一致している
- Supabase プロジェクトがすでに存在する（新規プロビジョニング不要）
- デプロイ環境（Vercel）、認証基盤、TypeScript設定がそのまま流用できる
- 新規プロジェクトを立ち上げると、インフラ管理コストが増える

### 他の選択肢との比較

| 選択肢 | メリット | デメリット | 判断 |
|--------|----------|------------|------|
| eigyo-auto に追加（推奨） | 既存インフラ流用、工数最小 | 既存コードとの設計統一が必要 | 採用 |
| 新規 Next.js + Supabase | クリーンな設計 | インフラ管理が増える、工数+1週間 | 不採用 |
| genba-platform に統合 | 現場管理と連携しやすい | 用途が異なりすぎる | 不採用 |
| GAS + Supabase ハイブリッド | 最小変更 | バックエンドの二重管理が続く | 不採用 |
| Firebase/PlanetScale 等 | — | 既存スタックと異なる、学習コスト大 | 不採用 |

---

## 2. データモデル設計

### 設計方針

現状の問題「1社1行の限界」を解消するため、**会社（company）と案件（deal）を分離**する。  
call_logs は prospect_id への外部キーで紐付け、整合性を保証する。  
顧客管理と営業リストの「二重持ち」問題は、companies テーブルの `relationship_type` カラムで解消する。

---

### テーブル定義

#### companies（会社マスタ）

```
現状の「営業リスト」と「顧客管理」を統合した会社マスタ。
1社1レコード。ステージ管理はここではなく deals テーブルで行う。
```

| カラム名 | 型 | 制約 | 説明 |
|----------|----|------|------|
| id | uuid | PK, default gen_random_uuid() | |
| name | text | NOT NULL | 会社名（正規化済み） |
| name_kana | text | | 読み仮名（ソート用） |
| industry | text | | 業種 |
| pref | text | | 所在地（都道府県） |
| address | text | | 住所詳細 |
| phone | text | | 代表電話番号 |
| url | text | | 会社URL |
| corp_num | text | UNIQUE | 法人番号 |
| capital | bigint | | 資本金（円） |
| relationship_type | text | NOT NULL default 'prospect' | 'prospect' / 'customer' / 'subcon' / 'archived' |
| ai_score | smallint | | AIスコア（1〜10） |
| top_product | text | | 推奨商材 |
| source | text | | 流入経路 |
| list_type | text | | リスト種別 |
| memo | text | | 自由メモ |
| created_at | timestamptz | NOT NULL default now() | |
| updated_at | timestamptz | NOT NULL default now() | |

**インデックス:** name, corp_num, pref, relationship_type, ai_score

---

#### contacts（担当者）

```
現状の「担当者リスト（JSON列）」を正規化。1社に複数担当者を持てる。
```

| カラム名 | 型 | 制約 | 説明 |
|----------|----|------|------|
| id | uuid | PK | |
| company_id | uuid | FK → companies.id ON DELETE CASCADE | |
| name | text | | 担当者名 |
| role | text | | 役職 |
| phone | text | | 直通電話 |
| email | text | | メールアドレス |
| is_primary | boolean | default false | メイン担当者フラグ |
| memo | text | | |
| created_at | timestamptz | NOT NULL default now() | |

---

#### deals（案件）

```
受注後フロー（見積→発注→工事→請求）の中核テーブル。
1社複数案件に対応。ステージ管理もここで行う。
```

| カラム名 | 型 | 制約 | 説明 |
|----------|----|------|------|
| id | uuid | PK | |
| company_id | uuid | FK → companies.id | |
| contact_id | uuid | FK → contacts.id, nullable | 主担当者 |
| title | text | NOT NULL | 案件名（例: 「〇〇ビル電気工事」） |
| stage | text | NOT NULL default '未架電' | 下記ステージ一覧参照 |
| amount | bigint | | 見積金額（円） |
| ordered_at | date | | 受注日 |
| scheduled_date | date | | アポ日時 / 工事予定日 |
| source | text | | 流入経路 |
| memo | text | | |
| created_at | timestamptz | NOT NULL default now() | |
| updated_at | timestamptz | NOT NULL default now() | |

**ステージ一覧（現状GASのステージを踏襲）:**  
未架電 / 架電済 / 興味あり / 追い中 / アポ確定 / 商談中 / 再架電待ち / 失注 / 受注 / 廃業 / 再アプローチ可

**インデックス:** company_id, stage, created_at

---

#### call_logs（架電ログ）

```
現状の call_logs シート（9列）を正規化。company_id で紐付け。
deal_id との紐付けはオプション（1社複数案件対応のため）。
```

| カラム名 | 型 | 制約 | 説明 |
|----------|----|------|------|
| id | uuid | PK | |
| company_id | uuid | FK → companies.id | |
| deal_id | uuid | FK → deals.id, nullable | 案件が特定できる場合 |
| called_at | timestamptz | NOT NULL default now() | 架電日時 |
| result | text | NOT NULL | アポ取れた / NG / 興味あり / 留守電 … |
| caller | text | | 架電者名 |
| contact_name | text | | 応対者名（担当者名） |
| note | text | | メモ |
| call_count_snapshot | smallint | | この時点での累計架電回数 |

**インデックス:** company_id, deal_id, called_at

---

#### subcontractors（下請け管理）

```
現状の「下請け管理」シート（13列）に対応。
companies テーブルとは分離（元請けとは性質が異なる）。
```

| カラム名 | 型 | 制約 | 説明 |
|----------|----|------|------|
| id | uuid | PK | |
| company_name | text | NOT NULL | |
| contact_name | text | | 担当者名 |
| phone | text | | |
| email | text | | |
| specialty | text | | 得意工種 |
| area | text | | 対応エリア |
| status | text | default '要確認' | 空き / 稼働中 / 要確認 |
| rate_day | integer | | 昼単価（円） |
| rate_night | integer | | 夜単価（円） |
| night_ok | boolean | default false | 夜勤可否 |
| payment_terms | text | | 支払サイト |
| rating | numeric(2,1) | | 評価（0〜5） |
| memo | text | | 実績・メモ |
| created_at | timestamptz | NOT NULL default now() | |
| updated_at | timestamptz | NOT NULL default now() | |

---

#### quotes（見積書）※フェーズ2以降

```
現状のGASで生成しているGmail下書き見積書を将来的に管理するテーブル。
フェーズ1では不要だが、設計時に外部キーの余地を残しておく。
```

| カラム名 | 型 | 説明 |
|----------|----|------|
| id | uuid | PK |
| deal_id | uuid | FK → deals.id |
| amount | bigint | 見積金額 |
| issued_at | date | 発行日 |
| status | text | draft / sent / accepted / rejected |
| pdf_url | text | ストレージURL |
| memo | text | |
| created_at | timestamptz | |

---

### ER図（テキスト）

```
companies (1) ─── (N) contacts
companies (1) ─── (N) deals
companies (1) ─── (N) call_logs
deals     (1) ─── (N) call_logs
deals     (1) ─── (N) quotes
```

---

### 現状シートとの対応表

| 現状シート | 移行先テーブル | 備考 |
|------------|----------------|------|
| 営業リスト（22列） | companies + deals + contacts | 1社1行 → 1社複数案件 |
| call_logs（9列） | call_logs | company_id で外部キー化 |
| 顧客管理（8列） | companies（relationship_type='customer'） | 統合して二重管理解消 |
| 下請け管理（13列） | subcontractors | 独立テーブルとして維持 |
| 案件一覧（SHEET_IDスプシ） | deals | GASの案件管理と統合 |

---

## 3. 移行戦略

### 採用戦略: 段階的移行（Strangler Figパターン）

ビッグバン移行（一気に切り替え）は採用しない。理由:
- 開発中も実業務が継続している
- GASのトリガー・LINE通知など移行しないコンポーネントがある
- データ移行ミスのリスクをフェーズ分けで局所化できる

### 段階的移行の考え方

```
フェーズ1: 新DBにデータをミラーリングしつつ、GASを正として運用
            （新UIで読み取りのみ開始）
フェーズ2: 書き込みをSupabase経由に切り替え。GASはRead専用に降格
フェーズ3: GAS UIを廃止。GASはトリガー・通知専用に残す
```

### GASとの並行期間の考え方

フェーズ1〜2の間（推定2〜3ヶ月）はGASとSupabaseを並行稼働させる。  
並行期間中のデータ整合性の管理方法:

- GAS側での更新は GAS → Supabase Webhook で反映する（GAS の `appendCallLog_` 等の末尾に UrlFetchApp での POST を追加）
- または毎夜バッチでスプレッドシート → Supabase に同期するスクリプトをGASに追加する

どちらを選ぶかはフェーズ1着手時に決める。小規模（数百社）であればバッチ同期で十分。

---

## 4. 実装優先順位

### フェーズ1（目安: 2〜3週間）— 読み取りとデータ基盤

**目標: 現状のGAS UIと並行して、Supabase上にクリーンなデータを持つ**

1. Supabase マイグレーションファイル作成（companies / contacts / deals / call_logs / subcontractors）
2. スプレッドシートからの初期データ移行スクリプト（Node.js）
   - 営業リスト → companies + deals（1社1案件として初期登録）
   - call_logs → call_logs（company_id マッピング付き）
   - 顧客管理 → companies（relationship_type='customer'）
   - 下請け管理 → subcontractors
3. eigyo-auto に APIルート追加（読み取り専用から開始）
   - `GET /api/prospects` — companies + deals の一覧（ページネーション付き）
   - `GET /api/prospects/:id` — 会社詳細 + 架電履歴
   - `GET /api/call-stats` — 架電統計
4. フロントエンドの読み取りのみ切り替え（既存GAS UIはそのまま残す）

**完了基準:** 新UIでリスト閲覧ができる。書き込みはまだGAS経由。

---

### フェーズ2（目安: 3〜4週間）— 書き込みの切り替え

**目標: 架電ログ・ステージ更新をSupabase経由に一本化**

1. 書き込み APIルート追加
   - `POST /api/call-logs` — 架電記録
   - `PATCH /api/prospects/:id` — ステージ更新・担当者更新
   - `POST /api/prospects` — 新規見込み客追加
   - `POST /api/customers` — 受注転記（deals.stage='受注' + companies.relationship_type='customer'）
   - CRUD for contacts / subcontractors
2. GAS側の対応
   - index_prospecting.html の API コール先を GAS → eigyo-auto APIに変更
   - または新規フロントエンドUIをフルリプレイス
3. RLS（Row Level Security）設定
   - anon ユーザーは読み取り不可
   - 認証済みユーザーのみ操作可（eigyo-auto の既存認証基盤を流用）

**完了基準:** 架電記録・ステージ更新がSupabase経由になる。GASのCall系関数が使われなくなる。

---

### フェーズ3（目安: 2〜3週間）— 受注後フロー実装

**目標: 見積→発注→工事→請求の基本フローをUIで追跡できる**

1. quotes テーブルのマイグレーション追加
2. 案件詳細画面の実装（deal のステージ遷移 + 見積書紐付け）
3. GAS の見積書生成（Code_estimation_team.gs）を呼び出す Webhook API を eigyo-auto に追加
   - フロント → eigyo-auto API → GAS Web App → Gmail 下書き生成
   - 見積書生成後に quotes テーブルに記録
4. GAS UIの廃止（index_prospecting.html を非公開に）
5. GASはトリガー・LINE通知専用として維持（後述）

**完了基準:** 営業フローが全て eigyo-auto UI で完結する。

---

## 5. 推定工数（1人開発）

| フェーズ | 作業内容 | 推定工数 |
|----------|----------|---------|
| フェーズ1 | DBスキーマ + 初期移行 + 読み取りAPI | 2〜3週間 |
| フェーズ2 | 書き込みAPI + UI切り替え + RLS | 3〜4週間 |
| フェーズ3 | 受注後フロー + GAS UI廃止 | 2〜3週間 |
| **合計** | | **7〜10週間**（平日の空き時間想定） |

**前提条件:**
- 平日の主業務（アポ電話）と並行するため、開発は朝・夜・週末
- テスト環境は Supabase の別プロジェクトを立てず、eigyo-auto のステージング環境を流用
- TypeScript strict モード、`any` 型禁止（maruken-shared ルール適用）

**リスク要因（工数が伸びる場合）:**
- 初期データ移行でのデータ品質問題（会社名の表記揺れ、重複レコード）
- eigyo-auto の既存コードとの API 設計衝突
- RLS ポリシーの設計複雑化

---

## 6. GASから移行しない方が良いもの

以下のコンポーネントは **移行コストに対してメリットが小さい**、または **GASが最適な実行環境** のため、移行せず GAS 上で継続稼働させる。

### 継続稼働させるもの（理由付き）

#### 定期トリガー（orchestrator.gs の trigger_* 関数群）
- 15分毎・毎朝8時・毎夜23時〜翌5時に各バッチを実行
- GAS の時間トリガーはゼロコスト・無設定で動く
- Vercel の Cron Jobs で代替可能だが、無料枠の制約（月60回まで）があるため GAS のほうが優位
- **継続方針:** GAS トリガーはそのまま。ただし処理結果の記録先を Supabase に変更していく

#### LINE Webhook doPost（orchestrator.gs の LINE Webhook セクション）
- LINE Message API の Webhook URL として GAS のデプロイURLを指定している
- Vercel へ移行すると Webhook URL の変更が必要で、既存 LINE チャンネルの設定変更が発生する
- 処理量が少ない（1日数十件）ため GAS で十分
- **継続方針:** GAS で LINE Webhook を受け付けたまま。Supabase への書き込みは GAS から UrlFetch で実行

#### メール受信・AI判定（Code_agent004.gs + Code_sales_team.gs のメール系）
- Gmail の `GmailApp.search()` は GAS 内でのみ動作する Google API
- Vercel（Node.js）で Gmail を扱うには OAuth2 認証フローの実装が必要で工数が大きい
- LINE 通知との連動（メール受信 → LINE 通知）も GAS 内で完結している
- **継続方針:** メール系処理は完全に GAS で継続

#### 見積書・請求書の PDF 生成（Code_estimation_team.gs / Code_billing_team.gs）
- Google Docs テンプレートを使って PDF を生成する処理
- Vercel では `DocumentApp` が使えないため、代替ライブラリ（Puppeteer 等）が必要で工数大
- **継続方針:** フェーズ3でも GAS を Webhook で呼び出す形を維持。完全移行はフェーズ3以降の検討事項

#### AIスコアリング・リード発掘バッチ（Code_prospecting_ai.gs / Code_prospecting_batch.gs）
- xAI (Grok) API を呼び出してバックグラウンド処理をする夜間バッチ
- GAS のトリガーで毎夜実行されており、無料で動いている
- 処理結果（AIスコア等）だけ Supabase に書き込む形にすれば十分
- **継続方針:** バッチは GAS で継続。処理完了後に Supabase の companies.ai_score を更新する

#### 資本金・法人番号の自動補完（enrichCapitals / autoFillCorpNum）
- 外部サイトスクレイピングと国税庁 API の呼び出し
- UrlFetchApp でそのまま動いており、移行メリットなし
- **継続方針:** GAS で継続。補完結果を Supabase に書き込むように改修

---

## 実装開始時のチェックリスト

移行開始前に確認・準備すること:

- [ ] eigyo-auto の既存テーブル定義を確認し、命名規則を統一する
- [ ] Supabase の `qppsurknarwkodfagayo` プロジェクトで新テーブルを作成する権限を確認
- [ ] 営業リストのスプレッドシートから CSV エクスポートし、データ品質を確認（重複・表記揺れ）
- [ ] `node scripts/migrate.js` パターン（genba-platform で実績あり）で移行スクリプトを書く
- [ ] RLS の方針を決める（社員全員が全データにアクセスできる状態から始めるか、ユーザー単位に制限するか）
- [ ] GAS Web App の deplyID（AKfycbwx...）を控えておく（フェーズ3の Webhook 呼び出しで必要）

---

## 付録: 現状GASの主要ファイル一覧（参照用）

| ファイル | 行数 | 移行後の扱い |
|----------|------|-------------|
| orchestrator.gs | 1,693行 | トリガー・LINE Webhook は継続。APIルート部分（handleProspectingApi_）は廃止 |
| Code_prospecting_core.gs | 648行 | Supabase移行後に廃止（データ操作の中核） |
| Code_prospecting_ops.gs | 〜300行 | 同上 |
| Code_prospecting_ai.gs | 588行 | GASで継続（AIバッチ）、結果書き込み先をSupabaseに変更 |
| Code_crm.gs | 289行 | Supabase移行後に廃止（顧客・下請け管理） |
| Code_billing_team.gs | 1,109行 | GASで継続（PDF生成） |
| Code_estimation_team.gs | 1,001行 | GASで継続（見積書生成）、Webhookで呼び出し |
| Code_sales_team.gs | 2,197行 | メール系・LINE系はGAS継続、架電系は段階的廃止 |
| index_prospecting.html | 5,325行 | フェーズ3で廃止（eigyo-auto UIに置き換え） |
