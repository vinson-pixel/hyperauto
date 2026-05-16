// ============================================================
// Code_sales_team.gs — 営業チーム マルチエージェントシステム
// マルケン電工 hyperauto プロジェクト
//
// エージェント構成:
//   S-01: EmailIntakeTeam       — メール受信・案件判定チーム
//   S-02: HearingTeam           — ヒアリング自動返信チーム
//   S-03: LeadScoringTeam       — リード管理・スコアリングチーム
//   S-04: FollowUpTeam          — フォローアップチーム
//   S-05: TalkScriptTeam        — 電話営業サポートチーム
//   S-06: EigyoActionProcessor  — eigyo-auto タスクキュー実行（5分ごと）
//   S-07: EigyoPipelineScheduler — eigyo-auto 朝イチ起動（毎朝8時）
//
// スクリプトプロパティ:
//   SHEET_ID                  案件管理スプシID
//   EXISTING_SHEET_ID         既存案件スプシID
//   CRM_SHEET_ID              CRMリード管理スプシID
//   FOLLOWUP_SHEET_ID         フォローアップ専用スプシID
//   XAI_API_KEY               xAI (Grok) API キー
//   CLAUDE_API_KEY            Anthropic API キー
//   LINE_CHANNEL_ACCESS_TOKEN LINE Messaging API トークン
//   LINE_USER_IDS             manager:Uabc,owner:Uxyz 形式
//   EIGYO_SUPABASE_URL        eigyo-auto Supabase URL
//   EIGYO_SUPABASE_KEY        eigyo-auto Supabase サービスロールキー
//   EIGYO_AUTO_URL            eigyo-auto Vercel デプロイURL（S-07用）
//
// GASオーナー: info@marukendenkou.com
// ============================================================

// ─── 案件管理スプシ 列定数 (S-01用) ─────────────────────────
const COL_S = {
  DATE:      1,  // A: 記録日時
  EMAIL_ID:  2,  // B: メールID（重複防止）
  SUBJECT:   3,  // C: 件名
  FROM:      4,  // D: 送信元
  CATEGORY:  5,  // E: 分類（案件/返信必要/不要）
  PRIORITY:  6,  // F: 優先度
  CUSTOMER:  7,  // G: 顧客名
  LOCATION:  8,  // H: 現場住所
  WORK_TYPE: 9,  // I: 工事種別
  AMOUNT:    10, // J: 推定金額
  STATUS:    11, // K: ステータス
  REGION:    12, // L: 地域
  URGENCY:   13, // M: 緊急度
  NOTES:     14, // N: 備考
};

// ─── CRMスプシ 列定数 (S-03用) ───────────────────────────────
const COL_CRM = {
  DATE:        1,  // A: 登録日
  COMPANY:     2,  // B: 会社名
  NAME:        3,  // C: 担当者名
  TITLE:       4,  // D: 役職
  EMAIL:       5,  // E: メール
  PHONE:       6,  // F: 電話番号
  INDUSTRY:    7,  // G: 業種
  SCORE:       8,  // H: 優先度スコア
  MATCH:       9,  // I: マッチングサービス
  PAIN:        10, // J: 推定課題
  STATUS:      11, // K: ステータス
  LAST_ACTION: 12, // L: 最終アクション日
  NOTES:       13, // M: 備考
};

// ─── フォローアップスプシ 列定数 (S-04用) ────────────────────
const COL_FU = {
  DATE:         1,  // A: 案件完了日 or 最終接触日
  CUSTOMER:     2,  // B: 顧客名
  EMAIL:        3,  // C: メールアドレス
  WORK_TYPE:    4,  // D: 工事内容
  LOCATION:     5,  // E: 現場
  HISTORY:      6,  // F: やり取り履歴メモ
  LAST_CONTACT: 7,  // G: 最終連絡日
  FOLLOWUP_FLG: 8,  // H: フォローアップ済みフラグ
  NOTES:        9,  // I: 備考
};

// ============================================================
// S-01: EmailIntakeTeam — メール受信・案件判定チーム
// ============================================================
// Agent-004の汎用化版。東京限定フィルタを削除し全社・全国対応。
// サブエージェントがパイプラインで順番に処理する。

/**
 * S-01-①: 未処理Gmailを取得するサブエージェント
 * 「AI処理済み」ラベルのないメールを検索して返す。
 * 件名キャッシュを使って転送・RE: の重複を排除する。
 * @returns {{threads: GoogleAppsScript.Gmail.GmailThread[], processed: string[]}} 処理対象スレッド一覧とキャッシュ
 */
function s01_emailFetcher() {
  agentLog('S-01-①', 'START', 'メール取得開始');

  const label = getOrCreateLabel('AI処理済み');
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  const threads = GmailApp.search('in:inbox -label:AI処理済み after:' + todayStr);

  // 件名重複チェック用キャッシュ（6時間有効）
  const cache = CacheService.getScriptCache();
  const cachedRaw = cache.get('s01_processed_subjects');
  const processedSubjects = cachedRaw ? JSON.parse(cachedRaw) : [];

  agentLog('S-01-①', 'OK', '取得スレッド数: ' + threads.length);
  return { threads, processedSubjects, label };
}

/**
 * S-01-②: Grokでメールを分類するサブエージェント
 * カテゴリ（案件/返信必要/不要）＋地域・工事種別・緊急度・推定金額を判定。
 * @param {{id:string, subject:string, from:string, body:string, date:string}} emailData メールデータ
 * @returns {{category:string, priority:string, customer:string, location:string, workType:string, estAmount:number|null, region:string, urgency:string, notes:string}}
 */
function s01_classifier(emailData) {
  agentLog('S-01-②', 'START', '分類開始: ' + emailData.subject);

  const systemPrompt = `あなたはマルケン電工（愛知県の電気工事会社）のメール仕分けAIです。
全国の電気工事案件を対象に分析します。JSONのみで返答してください。`;

  const userPrompt = `以下のメールを分析してください。

件名: ${emailData.subject}
送信元: ${emailData.from}
本文:
${emailData.body}

【分類基準】
category:
  「案件」= 見積依頼・工事依頼・発注・現場相談など仕事になる可能性があるメール
  「返信必要」= 案件ではないが返信が必要（質問・確認・取引先連絡・パートナー問い合わせ）
  「不要」= 一方的な営業メール・スパム・自動配信・明らかに関係ない
priority: high=緊急または大型案件 / medium=通常 / low=急がない
region: 都道府県または地域名（不明は「不明」）
urgency: 「緊急」「通常」「余裕あり」のいずれか

以下JSON形式のみで返答:
{
  "category": "案件"|"返信必要"|"不要",
  "priority": "high"|"medium"|"low",
  "customer": "顧客名または会社名（不明はnull）",
  "location": "現場住所または地域（不明はnull）",
  "workType": "工事種別（不明はnull）",
  "estAmount": 数値またはnull,
  "region": "都道府県名（不明は不明）",
  "urgency": "緊急"|"通常"|"余裕あり",
  "notes": "判断理由（1文）"
}`;

  const result = callGrokJSON(systemPrompt, userPrompt, 'grok-3-mini-fast');

  if (!result) {
    agentLog('S-01-②', 'ERROR', 'Grok分類失敗 → デフォルト: 返信必要');
    return { category: '返信必要', priority: 'low', region: '不明', urgency: '通常', notes: 'AI判定エラー' };
  }

  agentLog('S-01-②', 'OK', result.category + ' | ' + result.priority + ' | ' + result.region);
  return result;
}

/**
 * S-01-③: Claudeで返信文案を生成するサブエージェント
 * 案件・返信必要カテゴリのメールに対して丁寧な返信文を生成する。
 * @param {{id:string, subject:string, from:string, body:string}} emailData メールデータ
 * @param {{category:string, customer:string, workType:string, location:string, notes:string}} result 分類結果
 * @returns {string} 返信文案（署名なし）
 */
function s01_draftComposer(emailData, result) {
  agentLog('S-01-③', 'START', '返信文生成: ' + emailData.subject);

  const context = [
    result.customer  ? '顧客: ' + result.customer : null,
    result.workType  ? '工事種別: ' + result.workType : null,
    result.location  ? '現場: ' + result.location : null,
    result.estAmount ? '推定金額: ' + Number(result.estAmount).toLocaleString() + '円' : null,
    result.region    ? '地域: ' + result.region : null,
    result.notes     ? '判断メモ: ' + result.notes : null,
  ].filter(Boolean).join('\n');

  const systemPrompt = `あなたはマルケン電工（愛知県名古屋市の電気工事会社）の営業担当者として、
受信メールへの返信文を作成します。
${MARUKEN_PROFILE}

【必須ルール】
- 書き出し: 「お世話になっております。株式会社マルケン電工でございます。」
- 相手のメール内容（件名・本文）に具体的に言及して返信する
- 案件・見積依頼なら「担当者より改めてご連絡いたします」と記載
- 質問があれば誠実に回答または「確認の上ご連絡いたします」と記載
- 締め: 「ご不明な点はお気軽にご連絡ください。どうぞよろしくお願いいたします。」
- 署名は書かない（自動付加されます）
- 丁寧・簡潔・具体的。600字以内。`;

  const userPrompt = `【受信メール】
件名: ${emailData.subject}
送信元: ${emailData.from}
本文:
${emailData.body.substring(0, 3000)}

【AI分析結果】
${context}`;

  const draft = callClaude(systemPrompt, userPrompt, 'claude-haiku-4-5', 1024);

  if (!draft) {
    agentLog('S-01-③', 'ERROR', 'Claude返信文生成失敗');
    return 'お世話になっております。株式会社マルケン電工でございます。\n\nご連絡いただきありがとうございます。\n担当者より改めてご連絡いたします。\n\nどうぞよろしくお願いいたします。';
  }

  agentLog('S-01-③', 'OK', '返信文生成完了 ' + draft.length + '文字');
  return draft.trim();
}

/**
 * S-01-④: スプレッドシートに案件を記録するサブエージェント
 * 案件・返信必要カテゴリをCOL_S定義に従い案件管理スプシに記録する。
 * さらに案件カテゴリの場合は既存スプシ（一覧）にも転写する。
 * @param {{id:string, subject:string, from:string, date:string}} emailData メールデータ
 * @param {{category:string, priority:string, customer:string, location:string, workType:string, estAmount:number|null, region:string, urgency:string, notes:string}} result 分類結果
 * @returns {boolean} 記録成功フラグ
 */
function s01_crmWriter(emailData, result) {
  agentLog('S-01-④', 'START', 'スプシ記録: ' + result.category);

  // 案件管理スプシ（メインシート）
  const sheet = getSheet('SHEET_ID', '案件一覧');
  if (sheet) {
    // 重複チェック（EMAIL_ID列でルックアップ）
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const ids = sheet.getRange(2, COL_S.EMAIL_ID, lastRow - 1).getValues().flat();
      if (ids.includes(emailData.id)) {
        agentLog('S-01-④', 'SKIP', 'メールID重複: ' + emailData.id);
        return false;
      }
    }

    const row = new Array(14).fill('');
    row[COL_S.DATE      - 1] = nowStr();
    row[COL_S.EMAIL_ID  - 1] = emailData.id;
    row[COL_S.SUBJECT   - 1] = emailData.subject;
    row[COL_S.FROM      - 1] = emailData.from;
    row[COL_S.CATEGORY  - 1] = result.category  || '';
    row[COL_S.PRIORITY  - 1] = result.priority  || '';
    row[COL_S.CUSTOMER  - 1] = result.customer  || '';
    row[COL_S.LOCATION  - 1] = result.location  || '';
    row[COL_S.WORK_TYPE - 1] = result.workType  || '';
    row[COL_S.AMOUNT    - 1] = result.estAmount || '';
    row[COL_S.STATUS    - 1] = '新規';
    row[COL_S.REGION    - 1] = result.region    || '不明';
    row[COL_S.URGENCY   - 1] = result.urgency   || '通常';
    row[COL_S.NOTES     - 1] = result.notes     || '';

    appendRow(sheet, row);
    agentLog('S-01-④', 'OK', '案件一覧に記録完了');
  }

  // 案件のみ既存スプシ（一覧シート）にも転写
  if (result.category === '案件') {
    const existingSheet = getSheet('EXISTING_SHEET_ID', '一覧');
    if (existingSheet) {
      const exRow = new Array(13).fill('');
      exRow[0]  = result.customer  || '';   // A: 元受け会社
      exRow[1]  = result.location  || '';   // B: 現場名
      exRow[2]  = result.workType  || '';   // C: 施工内容
      exRow[3]  = '';                       // D: 施工日（未定）
      exRow[4]  = '';                       // E: 完了日（未定）
      exRow[5]  = nowStr();                 // F: AI記録日
      exRow[6]  = '';                       // G: 担当者
      exRow[7]  = '';                       // H: 日程連絡
      exRow[8]  = '';                       // I: カレンダー入力
      exRow[9]  = '';                       // J: 完了報告
      exRow[10] = '新規';                   // K: ステータス
      exRow[11] = result.estAmount || '';   // L: 金額
      exRow[12] = result.notes     || '';   // M: 備考
      appendRow(existingSheet, exRow);
      agentLog('S-01-④', 'OK', '既存スプシ（一覧）に転写完了');
    }
  }

  return true;
}

/**
 * S-01-⑤: LINEに通知するサブエージェント
 * 案件・返信必要カテゴリをクイックリプライ付きでLINE通知する。
 * @param {{category:string, priority:string, customer:string, location:string, workType:string, estAmount:number|null, urgency:string, notes:string}} result 分類結果
 * @param {string} msgId メールID
 * @param {boolean} draftCreated 下書き作成済みか
 */
function s01_notifier(result, msgId, draftCreated) {
  agentLog('S-01-⑤', 'START', 'LINE通知: ' + result.category);

  const badge = result.category === '案件'
    ? (result.priority === 'high' ? '🔴【案件】' : '🟡【案件】')
    : '🔵【返信必要】';

  const amtStr = result.estAmount
    ? Number(result.estAmount).toLocaleString() + '円'
    : null;

  const lines = [
    badge,
    result.customer  ? '顧客: ' + result.customer       : null,
    result.location  ? '場所: ' + result.location        : null,
    result.workType  ? '工事: ' + result.workType        : null,
    amtStr           ? '金額: ' + amtStr                 : null,
    result.region    ? '地域: ' + result.region          : null,
    result.urgency   ? '緊急度: ' + result.urgency       : null,
    result.notes     ? result.notes                      : null,
    draftCreated     ? '✉️ 返信文をGmailに下書き保存済み' : null,
  ].filter(Boolean).join('\n');

  const quickReplyItems = [
    lineQR('📞 電話対応済み', 'action=called&id='      + msgId),
    lineQR('✅ 対応完了',     'action=done&id='         + msgId),
    lineQR('🗑 スキップ',     'action=skip&id='         + msgId),
  ];

  sendLineToManager(lines, quickReplyItems);
  agentLog('S-01-⑤', 'OK', 'LINE通知完了');
}

/**
 * S-01 メイン: EmailIntakeTeam — 全サブエージェントをパイプライン実行
 * トリガー設定: 15分ごと
 */
function runEmailIntakeTeam() {
  agentLog('S-01', 'START', '=== EmailIntakeTeam 開始 ===');

  // ① メール取得
  const { threads, processedSubjects, label } = s01_emailFetcher();
  if (threads.length === 0) {
    agentLog('S-01', 'END', '新着メールなし');
    return;
  }

  const cache = CacheService.getScriptCache();
  let processed = 0;
  let skipped = 0;

  threads.forEach(thread => {
    try {
      const msg = thread.getMessages()[0];
      const msgId = msg.getId();
      const subject = msg.getSubject();
      const normSub = subject.replace(/^(Re:|RE:|Fw:|FW:|転送:|【転送】)\s*/gi, '').trim().toLowerCase();

      // 件名重複チェック（転送・RE:などの重複排除）
      if (processedSubjects.includes(normSub)) {
        agentLog('S-01', 'SKIP', '件名重複: ' + subject);
        thread.addLabel(label);
        skipped++;
        return;
      }

      const emailData = {
        id:      msgId,
        subject: subject,
        from:    msg.getFrom(),
        body:    msg.getPlainBody().substring(0, 6000),
        date:    msg.getDate().toString(),
      };

      // ② 分類（Grok）
      const result = s01_classifier(emailData);

      if (result.category === '不要') {
        // 不要メールは自動アーカイブ
        thread.moveToArchive();
        thread.addLabel(label);
        agentLog('S-01', 'SKIP', '自動アーカイブ: ' + subject);
        skipped++;

      } else {
        // ③ 返信文生成（Claude）
        const draftBody = s01_draftComposer(emailData, result);

        // ④ CRM記録（スプシ）
        s01_crmWriter(emailData, result);

        // Gmail下書き作成
        let draftCreated = false;
        try {
          GmailApp.createDraft(
            emailData.from,
            'Re: ' + emailData.subject,
            draftBody + MARUKEN_SIGNATURE,
            { name: '株式会社マルケン電工' }
          );
          draftCreated = true;
        } catch(draftErr) {
          agentLog('S-01', 'WARN', '下書き作成エラー: ' + draftErr);
        }

        // ⑤ LINE通知
        s01_notifier(result, msgId, draftCreated);

        // S-02 ヒアリングチームに引き渡し（見積依頼の場合）
        if (result.category === '案件') {
          runHearingTeam(emailData, result);
        }

        processed++;
      }

      // 件名キャッシュ更新
      processedSubjects.push(normSub);
      if (processedSubjects.length > 200) processedSubjects.shift();
      cache.put('s01_processed_subjects', JSON.stringify(processedSubjects), 21600);

      thread.addLabel(label);

    } catch(e) {
      agentLog('S-01', 'ERROR', e.toString());
    }
  });

  agentLog('S-01', 'END', '=== EmailIntakeTeam 完了 | 処理: ' + processed + '件 / スキップ: ' + skipped + '件 ===');
}


// ============================================================
// S-02: HearingTeam — ヒアリング自動返信チーム
// ============================================================
// 見積依頼メールに対して、案件種別に応じた確認事項を自動生成し
// ヒアリングメールの下書きを作成する。

/**
 * S-02-①: 見積依頼かどうかを判定するサブエージェント
 * @param {{subject:string, body:string}} emailData メールデータ
 * @returns {boolean} 見積依頼かどうか
 */
function s02_inquiryDetector(emailData) {
  agentLog('S-02-①', 'START', '見積依頼判定: ' + emailData.subject);

  const keywords = [
    '見積', '積算', 'お見積', 'お見積り', 'ご依頼', '依頼', '工事お願い',
    'quote', '発注', '施工', '検討', 'ご相談', '相談',
  ];
  const text = (emailData.subject + ' ' + emailData.body).toLowerCase();
  const isInquiry = keywords.some(kw => text.includes(kw));

  agentLog('S-02-①', isInquiry ? 'OK' : 'SKIP', '見積依頼: ' + isInquiry);
  return isInquiry;
}

/**
 * S-02-②: 案件種別に応じた確認事項を生成するサブエージェント
 * @param {{subject:string, body:string}} emailData メールデータ
 * @returns {string[]} 確認事項リスト
 */
function s02_questionGenerator(emailData) {
  agentLog('S-02-②', 'START', '確認事項生成');

  const systemPrompt = `あなたはマルケン電工（電気工事会社）の見積担当者です。
${MARUKEN_PROFILE}
受信した見積依頼メールの内容から、正確な見積を出すために必要な確認事項を生成してください。
JSONのみで返答。`;

  const userPrompt = `以下の見積依頼メールに対して、見積に必要な確認事項を5〜8項目生成してください。

件名: ${emailData.subject}
本文:
${emailData.body.substring(0, 3000)}

JSON形式:
{
  "workType": "工事種別（推定）",
  "questions": [
    "確認事項1",
    "確認事項2",
    ...
  ]
}`;

  const result = callGrokJSON(systemPrompt, userPrompt, 'grok-3-mini-fast');

  if (!result || !Array.isArray(result.questions)) {
    // フォールバック: 汎用確認事項
    agentLog('S-02-②', 'FALLBACK', '汎用確認事項を使用');
    return [
      '施工場所（住所・建物名）をお教えください',
      '工事の具体的な内容（範囲）をお知らせください',
      '希望の施工時期・納期はいつ頃でしょうか',
      '現在の電気設備の状況（図面・写真があればご共有ください）',
      'ご予算の目安はございますか',
      'ご担当者様のお名前・ご連絡先をお教えください',
    ];
  }

  agentLog('S-02-②', 'OK', '確認事項 ' + result.questions.length + '件生成');
  return result.questions;
}

/**
 * S-02-③: ヒアリングメール文案を生成するサブエージェント（Claude）
 * @param {{subject:string, from:string, body:string}} emailData メールデータ
 * @param {string[]} questions 確認事項リスト
 * @returns {string} ヒアリングメール本文
 */
function s02_hearingComposer(emailData, questions) {
  agentLog('S-02-③', 'START', 'ヒアリングメール生成');

  const systemPrompt = `あなたはマルケン電工の営業担当者として、見積依頼に対するヒアリングメールを作成します。
${MARUKEN_PROFILE}

【ルール】
- 書き出し: 「お世話になっております。株式会社マルケン電工でございます。」
- 見積依頼へのお礼を述べる
- 正確な見積のために確認事項を丁寧にリスト形式で列挙
- 「ご回答いただけましたら、速やかにお見積書を作成いたします。」と記載
- 締め: 「ご多忙のところ恐れ入りますが、よろしくお願いいたします。」
- 署名は書かない（自動付加）
- 全体で600字以内`;

  const questionsText = questions.map((q, i) => `【${i + 1}】${q}`).join('\n');

  const userPrompt = `【受信した見積依頼メール】
件名: ${emailData.subject}
送信元: ${emailData.from}
本文:
${emailData.body.substring(0, 2000)}

【確認事項（以下をメールに含めてください）】
${questionsText}`;

  const body = callClaude(systemPrompt, userPrompt, 'claude-haiku-4-5', 1024);

  if (!body) {
    agentLog('S-02-③', 'ERROR', 'Claude生成失敗 → フォールバック');
    return `お世話になっております。株式会社マルケン電工でございます。

この度はお見積のご依頼をいただきありがとうございます。
正確なお見積書をご提出するため、以下の点をご確認させてください。

${questionsText}

ご回答いただけましたら、速やかにお見積書を作成いたします。
ご多忙のところ恐れ入りますが、よろしくお願いいたします。`;
  }

  agentLog('S-02-③', 'OK', 'ヒアリングメール生成完了');
  return body.trim();
}

/**
 * S-02-④: Gmail下書きを作成するサブエージェント
 * @param {{from:string, subject:string}} emailData メールデータ
 * @param {string} body メール本文
 * @returns {boolean} 作成成功フラグ
 */
function s02_draftCreator(emailData, body) {
  agentLog('S-02-④', 'START', '下書き作成: Re: ' + emailData.subject);
  const ok = createDraft(emailData.from, 'Re: ' + emailData.subject, body);
  agentLog('S-02-④', ok ? 'OK' : 'ERROR', '下書き作成: ' + (ok ? '成功' : '失敗'));
  return ok;
}

/**
 * S-02 メイン: HearingTeam — 見積依頼のみ実行
 * S-01 から呼び出される（直接トリガー不要）。
 * @param {{id:string, subject:string, from:string, body:string}} emailData メールデータ
 * @param {{category:string, workType:string}} classifyResult S-01分類結果
 */
function runHearingTeam(emailData, classifyResult) {
  agentLog('S-02', 'START', '=== HearingTeam 開始: ' + emailData.subject + ' ===');

  // ① 見積依頼判定
  const isInquiry = s02_inquiryDetector(emailData);
  if (!isInquiry) {
    agentLog('S-02', 'SKIP', '見積依頼でないためスキップ');
    return;
  }

  // ② 確認事項生成
  const questions = s02_questionGenerator(emailData);

  // ③ ヒアリングメール生成（Claude）
  const hearingBody = s02_hearingComposer(emailData, questions);

  // ④ Gmail下書き作成
  const draftOk = s02_draftCreator(emailData, hearingBody);

  agentLog('S-02', 'END', '=== HearingTeam 完了 | 下書き: ' + (draftOk ? '作成済み' : '失敗') + ' ===');
}


// ============================================================
// S-03: LeadScoringTeam — リード管理・スコアリングチーム
// ============================================================
// 名刺テキストや新規連絡先を受け取り、会社リサーチ→サービスマッチング
// →優先度スコアリング→CRM登録を自動で行う。

/**
 * S-03-①: 名刺テキストから連絡先情報を抽出するサブエージェント（Claude）
 * @param {string} rawText 名刺テキスト（OCR結果や手入力）
 * @returns {{name:string, company:string, title:string, email:string, phone:string, address:string}} 名刺情報
 */
function s03_cardParser(rawText) {
  agentLog('S-03-①', 'START', '名刺パース開始');

  const systemPrompt = `あなたは名刺情報の抽出AIです。
テキストから名前・会社・役職・メール・電話・住所を抽出してJSON形式で返してください。
不明な項目はnullにしてください。JSONのみで返答。`;

  const userPrompt = `以下のテキストから名刺情報を抽出してください:

${rawText}

JSON形式:
{
  "name": "担当者名",
  "company": "会社名",
  "title": "役職",
  "email": "メールアドレス",
  "phone": "電話番号",
  "address": "住所",
  "industry": "業種（推定）"
}`;

  const result = callClaudeJSON(systemPrompt, userPrompt, 'claude-haiku-4-5');

  if (!result) {
    agentLog('S-03-①', 'ERROR', '名刺パース失敗');
    return { name: null, company: rawText.substring(0, 50), title: null, email: null, phone: null, address: null, industry: null };
  }

  agentLog('S-03-①', 'OK', '名刺パース: ' + (result.company || '会社名不明'));
  return result;
}

/**
 * S-03-②: 会社の特性・電気工事ニーズを推定するサブエージェント（Claude）
 * @param {string} company 会社名
 * @param {string} industry 業種
 * @returns {{size:string, electricNeeds:string[], renewalCycle:string, potential:string, notes:string}} 会社情報
 */
function s03_companyResearcher(company, industry) {
  agentLog('S-03-②', 'START', '会社リサーチ: ' + company);

  const systemPrompt = `あなたは電気工事業界に詳しいビジネスアナリストです。
会社名と業種から、その会社が持ちそうな電気設備ニーズを分析してください。
${MARUKEN_SERVICES_LIST.map(s => '- ' + s).join('\n')}
JSONのみで返答。`;

  const userPrompt = `会社名: ${company}
業種: ${industry || '不明'}

以下の観点で分析してください:
{
  "size": "大企業|中小企業|個人事業",
  "electricNeeds": ["ニーズ1", "ニーズ2", ...],
  "renewalCycle": "設備更新サイクルの推定（例: 10年ごと・随時など）",
  "potential": "high|medium|low（受注ポテンシャル）",
  "mainBuilding": "想定建物タイプ（工場・オフィス・店舗など）",
  "notes": "アプローチ上の特記事項（1〜2文）"
}`;

  const result = callClaudeJSON(systemPrompt, userPrompt, 'claude-haiku-4-5');

  if (!result) {
    agentLog('S-03-②', 'FALLBACK', '会社リサーチ失敗 → デフォルト');
    return { size: '不明', electricNeeds: ['一般電気工事'], renewalCycle: '不明', potential: 'medium', notes: '' };
  }

  agentLog('S-03-②', 'OK', 'ポテンシャル: ' + result.potential);
  return result;
}

/**
 * S-03-③: マルケン電工のサービスとのマッチングスコアを算出するサブエージェント
 * @param {{electricNeeds:string[], mainBuilding:string, potential:string}} companyInfo 会社情報
 * @returns {{matchedServices:string[], matchScore:number, topService:string}} マッチング結果
 */
function s03_serviceMatcher(companyInfo) {
  agentLog('S-03-③', 'START', 'サービスマッチング');

  const needs = (companyInfo.electricNeeds || []).join(' ').toLowerCase();
  const building = (companyInfo.mainBuilding || '').toLowerCase();

  const serviceScores = MARUKEN_SERVICES_LIST.map(service => {
    let score = 0;
    const sLow = service.toLowerCase();

    // ニーズとのキーワードマッチ
    if (needs.includes('led') || needs.includes('照明'))   { if (sLow.includes('led'))    score += 30; }
    if (needs.includes('省エネ'))                          { if (sLow.includes('省エネ'))  score += 25; }
    if (needs.includes('太陽光') || needs.includes('solar')){ if (sLow.includes('太陽光')) score += 30; }
    if (needs.includes('ev') || needs.includes('充電'))    { if (sLow.includes('ev'))     score += 30; }
    if (needs.includes('工場') || building.includes('工場')){ if (sLow.includes('工場'))   score += 20; }
    if (needs.includes('点検') || needs.includes('保守'))  { if (sLow.includes('点検'))   score += 20; }
    if (needs.includes('緊急') || needs.includes('修理'))  { if (sLow.includes('緊急'))   score += 25; }
    if (needs.includes('新設') || needs.includes('増設'))  { if (sLow.includes('新設'))   score += 20; }

    // ポテンシャルによるボーナス
    if (companyInfo.potential === 'high')   score += 10;
    if (companyInfo.potential === 'medium') score += 5;

    return { service, score };
  });

  serviceScores.sort((a, b) => b.score - a.score);
  const matched = serviceScores.filter(s => s.score > 0).map(s => s.service);
  const matchScore = Math.min(100, serviceScores[0].score);
  const topService = serviceScores[0].service;

  agentLog('S-03-③', 'OK', 'マッチスコア: ' + matchScore + ' | トップ: ' + topService);
  return { matchedServices: matched.slice(0, 3), matchScore, topService };
}

/**
 * S-03-④: 総合優先度スコアを算出するサブエージェント
 * @param {{name:string, company:string, title:string}} cardInfo 名刺情報
 * @param {{potential:string, size:string}} companyInfo 会社情報
 * @param {{matchScore:number, matchedServices:string[]}} serviceMatch マッチング結果
 * @returns {number} 0〜100の優先度スコア
 */
function s03_priorityScorer(cardInfo, companyInfo, serviceMatch) {
  agentLog('S-03-④', 'START', '優先度スコア算出');

  let score = 0;

  // 会社ポテンシャル（最大40点）
  score += companyInfo.potential === 'high' ? 40
         : companyInfo.potential === 'medium' ? 25
         : 10;

  // 会社規模（最大20点）
  score += companyInfo.size === '大企業'    ? 20
         : companyInfo.size === '中小企業'  ? 15
         : 10;

  // サービスマッチング（最大30点）
  score += Math.round(serviceMatch.matchScore * 0.3);

  // 役職ボーナス（意思決定者なら+10点）
  const title = (cardInfo.title || '').toLowerCase();
  const isDecisionMaker = ['社長', '取締役', '部長', '課長', 'ceo', 'coo', '代表', 'director'].some(kw => title.includes(kw));
  if (isDecisionMaker) score += 10;

  const finalScore = Math.min(100, score);
  agentLog('S-03-④', 'OK', '優先度スコア: ' + finalScore + '/100');
  return finalScore;
}

/**
 * S-03-⑤: CRMシートにリード情報を登録するサブエージェント
 * @param {{name:string, company:string, title:string, email:string, phone:string, industry:string}} cardInfo 名刺情報
 * @param {number} score 優先度スコア
 * @param {{matchedServices:string[], topService:string}} serviceMatch マッチング結果
 * @param {{electricNeeds:string[], notes:string}} companyInfo 会社情報
 * @returns {boolean} 登録成功フラグ
 */
function s03_crmWriter(cardInfo, score, serviceMatch, companyInfo) {
  agentLog('S-03-⑤', 'START', 'CRM登録: ' + cardInfo.company);

  const sheet = getSheet('CRM_SHEET_ID', 'リード一覧');
  if (!sheet) {
    agentLog('S-03-⑤', 'ERROR', 'CRM_SHEET_ID未設定');
    return false;
  }

  const row = new Array(13).fill('');
  row[COL_CRM.DATE        - 1] = today();
  row[COL_CRM.COMPANY     - 1] = cardInfo.company  || '';
  row[COL_CRM.NAME        - 1] = cardInfo.name     || '';
  row[COL_CRM.TITLE       - 1] = cardInfo.title    || '';
  row[COL_CRM.EMAIL       - 1] = cardInfo.email    || '';
  row[COL_CRM.PHONE       - 1] = cardInfo.phone    || '';
  row[COL_CRM.INDUSTRY    - 1] = cardInfo.industry || '';
  row[COL_CRM.SCORE       - 1] = score;
  row[COL_CRM.MATCH       - 1] = (serviceMatch.matchedServices || []).join(' / ');
  row[COL_CRM.PAIN        - 1] = (companyInfo.electricNeeds || []).join(' / ');
  row[COL_CRM.STATUS      - 1] = '未連絡';
  row[COL_CRM.LAST_ACTION - 1] = today();
  row[COL_CRM.NOTES       - 1] = companyInfo.notes || '';

  const ok = appendRow(sheet, row);
  agentLog('S-03-⑤', ok ? 'OK' : 'ERROR', 'CRM登録: ' + (ok ? '成功' : '失敗'));
  return ok;
}

/**
 * S-03 メイン: LeadScoringTeam — 名刺テキストを受け取り全処理
 * @param {string} rawCardText 名刺テキスト（OCRまたは手入力）
 * @returns {{cardInfo:Object, companyInfo:Object, serviceMatch:Object, score:number}} 処理結果
 */
function runLeadScoringTeam(rawCardText) {
  agentLog('S-03', 'START', '=== LeadScoringTeam 開始 ===');

  if (!rawCardText || rawCardText.trim().length < 5) {
    agentLog('S-03', 'ERROR', '名刺テキストが空または短すぎます');
    return null;
  }

  // ① 名刺パース（Claude）
  const cardInfo = s03_cardParser(rawCardText);

  // ② 会社リサーチ（Claude）
  const companyInfo = s03_companyResearcher(cardInfo.company, cardInfo.industry);

  // ③ サービスマッチング
  const serviceMatch = s03_serviceMatcher(companyInfo);

  // ④ 優先度スコア算出
  const score = s03_priorityScorer(cardInfo, companyInfo, serviceMatch);

  // ⑤ CRM登録
  s03_crmWriter(cardInfo, score, serviceMatch, companyInfo);

  // LINE通知（スコア60以上のみ）
  if (score >= 60) {
    const msg = [
      '🟢【高優先リード登録】',
      '会社: ' + (cardInfo.company || '不明'),
      '担当: ' + (cardInfo.name || '不明') + (cardInfo.title ? '（' + cardInfo.title + '）' : ''),
      'スコア: ' + score + '/100',
      '推奨サービス: ' + serviceMatch.topService,
      '潜在ニーズ: ' + (companyInfo.electricNeeds || []).slice(0, 2).join('、'),
    ].filter(Boolean).join('\n');

    sendLineToManager(msg, [
      lineQR('📞 今すぐ電話する', 'action=call_lead&company=' + encodeURIComponent(cardInfo.company || '')),
      lineQR('✉️ メール送る',     'action=mail_lead&email=' + encodeURIComponent(cardInfo.email || '')),
    ]);
  }

  agentLog('S-03', 'END', '=== LeadScoringTeam 完了 | スコア: ' + score + '/100 ===');
  return { cardInfo, companyInfo, serviceMatch, score };
}


// ============================================================
// S-04: FollowUpTeam — フォローアップチーム
// ============================================================
// 完了案件・既存顧客への定期フォローアップを自動化する。
// デイリーバッチで実行（毎朝8時トリガー推奨）。

/**
 * S-04-①: フォローアップ対象を検出するサブエージェント
 * 最終接触から7日・30日・90日後の顧客を検出する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet フォローアップスプシ
 * @returns {{row:Object[], rowIndex:number, daysSince:number, tier:string}[]} フォローアップ対象リスト
 */
function s04_timingAnalyzer(sheet) {
  agentLog('S-04-①', 'START', 'フォローアップタイミング分析');

  if (!sheet) {
    agentLog('S-04-①', 'ERROR', 'フォローアップシートなし');
    return [];
  }

  const rows = sheet.getDataRange().getValues();
  const today = new Date();
  const targets = [];

  rows.forEach((row, i) => {
    if (i === 0) return; // ヘッダースキップ

    const lastContactDate = row[COL_FU.LAST_CONTACT - 1];
    const followupFlg     = row[COL_FU.FOLLOWUP_FLG - 1];
    const customerEmail   = row[COL_FU.EMAIL - 1];

    // メールアドレスなし or フォローアップ済みはスキップ
    if (!customerEmail || followupFlg === '送付済') return;
    if (!lastContactDate) return;

    const lastDate = new Date(lastContactDate);
    if (isNaN(lastDate.getTime())) return;

    const daysSince = Math.floor((today - lastDate) / 86400000);

    // フォローアップのタイミング判定
    let tier = null;
    if (daysSince >= 88 && daysSince <= 92) {
      tier = '90日';
    } else if (daysSince >= 28 && daysSince <= 32) {
      tier = '30日';
    } else if (daysSince >= 6 && daysSince <= 8) {
      tier = '7日';
    }

    if (tier) {
      targets.push({
        rowData: row,
        rowIndex: i + 1,
        daysSince,
        tier,
        customer: row[COL_FU.CUSTOMER - 1],
        email:    customerEmail,
        workType: row[COL_FU.WORK_TYPE - 1],
        location: row[COL_FU.LOCATION - 1],
        history:  row[COL_FU.HISTORY - 1],
      });
    }
  });

  agentLog('S-04-①', 'OK', 'フォローアップ対象: ' + targets.length + '件');
  return targets;
}

/**
 * S-04-②: 過去のやり取り・工事内容をまとめるサブエージェント
 * @param {string} customer 顧客名
 * @param {string} history 履歴メモ
 * @returns {string} まとめたコンテキスト文
 */
function s04_contextRetriever(customer, history) {
  agentLog('S-04-②', 'START', 'コンテキスト取得: ' + customer);

  const context = [
    '顧客: ' + customer,
    history ? '過去のやり取り: ' + history : null,
  ].filter(Boolean).join('\n');

  agentLog('S-04-②', 'OK', 'コンテキスト準備完了');
  return context;
}

/**
 * S-04-③: 状況に応じたフォローメールを生成するサブエージェント（Claude）
 * @param {{customer:string, workType:string, location:string}} customer 顧客情報
 * @param {string} context コンテキスト文
 * @param {number} daysSince 最終接触からの日数
 * @param {string} tier '7日'|'30日'|'90日'
 * @returns {string} フォローメール本文
 */
function s04_messageComposer(customer, context, daysSince, tier) {
  agentLog('S-04-③', 'START', 'フォローメール生成: ' + tier + '後');

  const tierMessages = {
    '7日':  '工事完了後1週間のご挨拶メール。設備の使い心地・不具合がないか確認する内容。',
    '30日': '工事完了後1か月のフォローメール。定期点検のご案内や追加工事の相談を促す内容。',
    '90日': '長期フォローメール。次のシーズンに向けた電気設備の点検・LED改修など提案する内容。',
  };

  const systemPrompt = `あなたはマルケン電工の営業担当者として、既存顧客へのフォローアップメールを作成します。
${MARUKEN_PROFILE}

【ルール】
- 書き出し: 「お世話になっております。株式会社マルケン電工でございます。」
- 目的: ${tierMessages[tier] || 'フォローアップのご連絡'}
- 具体的な工事内容・場所に触れて親近感を出す
- 押しつけがましくなく、自然に次のアクションへ誘導
- 締め: 「引き続きどうぞよろしくお願いいたします。」
- 署名は書かない（自動付加）
- 400字以内`;

  const userPrompt = `【顧客情報】
${context}
工事内容: ${customer.workType || '不明'}
施工場所: ${customer.location || '不明'}
最終接触からの日数: ${daysSince}日（${tier}フォロー）`;

  const body = callClaude(systemPrompt, userPrompt, 'claude-haiku-4-5', 800);

  if (!body) {
    agentLog('S-04-③', 'ERROR', 'フォローメール生成失敗 → フォールバック');
    return `お世話になっております。株式会社マルケン電工でございます。

先日はご依頼いただきありがとうございました。
その後、設備の状態はいかがでしょうか。

ご不明な点やお気づきの点がございましたら、お気軽にご連絡ください。
引き続きどうぞよろしくお願いいたします。`;
  }

  agentLog('S-04-③', 'OK', 'フォローメール生成完了');
  return body.trim();
}

/**
 * S-04-④: Gmail下書き作成＆スプシ更新するサブエージェント
 * @param {{customer:string, email:string, workType:string}} customer 顧客情報
 * @param {string} message メール本文
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet スプシ
 * @param {number} rowIndex 更新する行番号
 * @returns {boolean} 成功フラグ
 */
function s04_draftCreator(customer, message, sheet, rowIndex) {
  agentLog('S-04-④', 'START', '下書き作成: ' + customer.customer);

  const subject = `【ご確認】${customer.workType || '工事'}のその後について — 株式会社マルケン電工`;
  const ok = createDraft(customer.email, subject, message);

  // スプシのフォローアップフラグを更新
  if (sheet && rowIndex && ok) {
    try {
      sheet.getRange(rowIndex, COL_FU.FOLLOWUP_FLG).setValue('送付済');
      sheet.getRange(rowIndex, COL_FU.LAST_CONTACT).setValue(today());
    } catch(e) {
      agentLog('S-04-④', 'WARN', 'スプシ更新エラー: ' + e);
    }
  }

  agentLog('S-04-④', ok ? 'OK' : 'ERROR', '下書き作成: ' + (ok ? '成功' : '失敗'));
  return ok;
}

/**
 * S-04 メイン: FollowUpTeam — デイリーバッチで実行
 * トリガー設定: 毎朝8時
 */
function runFollowUpTeam() {
  agentLog('S-04', 'START', '=== FollowUpTeam 開始 ===');

  const sheet = getSheet('FOLLOWUP_SHEET_ID', 'フォローアップ');

  // ① タイミング分析
  const targets = s04_timingAnalyzer(sheet);

  if (targets.length === 0) {
    agentLog('S-04', 'END', 'フォローアップ対象なし');
    return;
  }

  let successCount = 0;

  targets.forEach(target => {
    try {
      // ② コンテキスト取得
      const context = s04_contextRetriever(target.customer, target.history);

      // ③ フォローメール生成（Claude）
      const message = s04_messageComposer(target, context, target.daysSince, target.tier);

      // ④ 下書き作成＋スプシ更新
      const ok = s04_draftCreator(target, message, sheet, target.rowIndex);

      if (ok) successCount++;

    } catch(e) {
      agentLog('S-04', 'ERROR', target.customer + ': ' + e.toString());
    }
  });

  // LINE通知（フォローアップ実行サマリ）
  if (successCount > 0) {
    sendLineToManager(
      `📋【フォローアップバッチ完了】\n対象: ${targets.length}件\n下書き作成: ${successCount}件\nGmailをご確認ください`
    );
  }

  agentLog('S-04', 'END', '=== FollowUpTeam 完了 | 下書き作成: ' + successCount + '/' + targets.length + '件 ===');
}


// ============================================================
// S-05: TalkScriptTeam — 電話営業サポートチーム
// ============================================================
// ターゲット会社に合わせた電話営業トークスクリプトを生成する。
// 会社プロフィール→課題推定→ピッチ→スクリプト→断り文句対策まで一貫して生成。

/**
 * S-05-①: ターゲット会社のプロフィールを生成するサブエージェント（Grok）
 * @param {string} companyName 会社名
 * @param {string} industry 業種
 * @param {string} size 規模（大企業/中小企業/個人事業）
 * @returns {{profile:string, buildingType:string, employeeCount:string, mainActivity:string}} プロフィール
 */
function s05_targetProfileBuilder(companyName, industry, size) {
  agentLog('S-05-①', 'START', 'プロフィール生成: ' + companyName);

  const systemPrompt = `あなたはビジネスリサーチの専門家です。
会社名・業種・規模から、電気工事会社が営業する際に役立つ会社プロフィールをJSONで生成してください。
JSONのみで返答。`;

  const userPrompt = `会社名: ${companyName}
業種: ${industry || '不明'}
規模: ${size || '不明'}

以下のJSON形式で出力:
{
  "buildingType": "想定建物タイプ（工場・オフィス・倉庫・店舗など）",
  "employeeCount": "推定従業員規模",
  "mainActivity": "主な事業活動（1〜2文）",
  "electricUsage": "電気使用の特徴（設備の重さ・稼働時間など）",
  "decisionMaker": "購買担当者の役職推定",
  "bestTimeToCall": "電話しやすい時間帯",
  "notes": "営業上の注意点（1文）"
}`;

  const result = callGrokJSON(systemPrompt, userPrompt, 'grok-3-mini-fast');

  if (!result) {
    agentLog('S-05-①', 'FALLBACK', 'プロフィール生成失敗 → デフォルト');
    return {
      buildingType: '建物タイプ不明',
      employeeCount: '不明',
      mainActivity: industry ? industry + 'を行う会社' : '業種不明の会社',
      electricUsage: '通常の業務用電気設備',
      decisionMaker: '総務部長または社長',
      bestTimeToCall: '平日10〜11時、14〜16時',
      notes: '丁寧・簡潔なアプローチを心がける',
    };
  }

  agentLog('S-05-①', 'OK', '建物タイプ: ' + result.buildingType);
  return result;
}

/**
 * S-05-②: 電気設備に関する潜在的課題を推定するサブエージェント（Claude）
 * @param {{buildingType:string, electricUsage:string, mainActivity:string}} profile 会社プロフィール
 * @returns {{painPoints:string[], primaryPain:string, urgency:string}} 課題リスト
 */
function s05_painPointAnalyzer(profile) {
  agentLog('S-05-②', 'START', '潜在課題分析');

  const systemPrompt = `あなたは電気工事業界の営業コンサルタントです。
マルケン電工（電気工事会社）の視点から、ターゲット会社が抱えやすい電気設備の課題を推定してください。
${MARUKEN_SERVICES_LIST.map(s => '- ' + s).join('\n')}
JSONのみで返答。`;

  const userPrompt = `会社の特徴:
- 建物タイプ: ${profile.buildingType}
- 事業内容: ${profile.mainActivity}
- 電気使用状況: ${profile.electricUsage}

この会社が抱えやすい電気設備の課題を3〜5個推定してください:
{
  "painPoints": [
    "課題1（具体的に）",
    "課題2",
    ...
  ],
  "primaryPain": "最も訴求力のある主要課題（1文）",
  "urgency": "high|medium|low（解決の緊急度）",
  "savingPotential": "コスト削減ポテンシャルの推定（例: 年間20〜30%削減可能）"
}`;

  const result = callClaudeJSON(systemPrompt, userPrompt, 'claude-haiku-4-5');

  if (!result) {
    agentLog('S-05-②', 'FALLBACK', '課題分析失敗 → デフォルト');
    return {
      painPoints: [
        '電気代の高騰によるコスト増加',
        '古い照明設備のLED化が未対応',
        '電気設備の定期点検未実施による突発的な故障リスク',
      ],
      primaryPain: '電気代削減とLED化によるコスト最適化',
      urgency: 'medium',
      savingPotential: '年間15〜25%の電気代削減が見込める',
    };
  }

  agentLog('S-05-②', 'OK', '主要課題: ' + result.primaryPain);
  return result;
}

/**
 * S-05-③: マルケン電工との接点・提案ポイントを生成するサブエージェント
 * @param {{buildingType:string, decisionMaker:string}} profile 会社プロフィール
 * @param {{primaryPain:string, savingPotential:string}} painPoints 課題情報
 * @returns {{pitchPoints:string[], openingHook:string, valueProposition:string}} ピッチ内容
 */
function s05_pitchBuilder(profile, painPoints) {
  agentLog('S-05-③', 'START', 'ピッチ生成');

  // マルケン電工の強みと課題を紐付ける
  const pitchPoints = [];

  if (painPoints.primaryPain && painPoints.primaryPain.includes('LED')) {
    pitchPoints.push('LED照明改修で電気代を年間20〜30%削減した実績あり');
  }
  if (painPoints.primaryPain && painPoints.primaryPain.includes('コスト')) {
    pitchPoints.push('省エネ診断（無料）から始められる気軽なファーストステップ');
  }
  if (profile.buildingType && profile.buildingType.includes('工場')) {
    pitchPoints.push('工場の幹線工事・受変電設備の実績が豊富');
  }
  if (painPoints.urgency === 'high') {
    pitchPoints.push('緊急対応・即日見積に対応（名古屋・愛知全域）');
  }

  // 最低3つのピッチポイントを確保
  if (pitchPoints.length < 3) {
    pitchPoints.push('電気工事士資格保有の専任スタッフが対応');
    pitchPoints.push('見積無料・現地調査無料（愛知・全国対応可）');
    pitchPoints.push('施工後の定期保守契約で設備トラブルを予防');
  }

  const openingHook = `${profile.buildingType || '御社'}の電気設備のコスト削減について、5分ほどご提案させていただけますでしょうか`;
  const valueProposition = `${painPoints.savingPotential || 'コスト最適化'}が実現でき、初回見積は完全無料です`;

  agentLog('S-05-③', 'OK', 'ピッチポイント ' + pitchPoints.length + '件');
  return { pitchPoints: pitchPoints.slice(0, 4), openingHook, valueProposition };
}

/**
 * S-05-④: 電話トークスクリプトを生成するサブエージェント（Claude）
 * @param {{companyName:string, decisionMaker:string, bestTimeToCall:string}} profile 会社プロフィール
 * @param {{painPoints:string[], primaryPain:string}} painPoints 課題情報
 * @param {{pitchPoints:string[], openingHook:string, valueProposition:string}} pitch ピッチ内容
 * @returns {string} トークスクリプト全文
 */
function s05_scriptWriter(profile, painPoints, pitch) {
  agentLog('S-05-④', 'START', 'トークスクリプト生成');

  const systemPrompt = `あなたはマルケン電工（愛知県名古屋市の電気工事会社）の電話営業トレーナーです。
${MARUKEN_PROFILE}

【マルケン電工 営業哲学】
- まず「御社の課題解決」のために電話していることを伝える
- 押し売りNG。相手の状況を聞きながら自然な流れで提案
- 「見積無料」「現地調査無料」を積極的に伝えてハードルを下げる
- 担当者が出たら「お忙しいところ恐れ入ります」から始める
- 断られてもすぐ諦めず、次のアポに繋ぐ一言を残す

スクリプトは実際の電話で使えるリアルな台本形式で書いてください。`;

  const pitchText = pitch.pitchPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const userPrompt = `【ターゲット会社情報】
会社名: ${profile.companyName || '御社'}
建物タイプ: ${profile.buildingType}
担当者（推定）: ${profile.decisionMaker}
電話しやすい時間: ${profile.bestTimeToCall}

【主要課題】
${painPoints.primaryPain}

【ピッチポイント】
${pitchText}

【提案フック】
${pitch.openingHook}

【価値提案】
${pitch.valueProposition}

以下の構成でトークスクリプトを作成してください:
1. 受付突破フレーズ（担当者に繋いでもらうための一言）
2. 担当者への導入（挨拶・用件説明）
3. 課題喚起（相手の悩みを引き出す質問）
4. 提案フレーズ（マルケン電工のサービス紹介）
5. クロージング（アポイント取り付け or 資料送付）
6. 断られた場合の返し方

【形式】各フェーズを「── フェーズ名 ──」で区切り、台本形式で記載。`;

  const script = callClaude(systemPrompt, userPrompt, 'claude-sonnet-4-6', 2000);

  if (!script) {
    agentLog('S-05-④', 'ERROR', 'スクリプト生成失敗');
    return `── 受付突破 ──
「お世話になっております。株式会社マルケン電工と申します。電気設備のご担当者様はいらっしゃいますでしょうか」

── 担当者への導入 ──
「お忙しいところ恐れ入ります。マルケン電工の営業担当と申します。
${pitch.openingHook}

── 課題喚起 ──
「最近、電気代のコスト面でお困りなことはございませんでしょうか」

── 提案フレーズ ──
「${pitch.valueProposition}。
まずは無料の現地調査だけでもいかがでしょうか」

── クロージング ──
「来週、30分ほどご都合いただけますでしょうか」

── 断られた場合 ──
「そうでございますか。お時間をいただきありがとうございました。
後ほど資料だけメールでお送りしてもよろしいでしょうか」`;
  }

  agentLog('S-05-④', 'OK', 'スクリプト生成完了 ' + script.length + '文字');
  return script.trim();
}

/**
 * S-05-⑤: 想定断り文句と切り返しを生成するサブエージェント（Claude）
 * @param {{buildingType:string, mainActivity:string}} profile 会社プロフィール
 * @param {string} script トークスクリプト本文
 * @returns {string} 断り文句＆切り返し一覧
 */
function s05_objectionHandler(profile, script) {
  agentLog('S-05-⑤', 'START', '断り文句対策生成');

  const systemPrompt = `あなたはマルケン電工（電気工事会社）の電話営業トレーナーです。
電話営業でよくある断り文句と、自然でしつこくない切り返しトークを生成してください。
${MARUKEN_PROFILE}`;

  const userPrompt = `ターゲット: ${profile.buildingType || '一般企業'}

以下5〜6パターンの断り文句に対する切り返しを作成してください:
1. 「今は必要ない」
2. 「すでに業者がいる」
3. 「予算がない」
4. 「忙しい」
5. 「資料だけ送っておいて」
6. 「担当者が不在」

各パターン:
【断り文句】〇〇
【切り返し】〇〇
（1〜2文で簡潔に。押し付けがましくなく次に繋げる内容）`;

  const objections = callClaude(systemPrompt, userPrompt, 'claude-haiku-4-5', 1200);

  if (!objections) {
    agentLog('S-05-⑤', 'ERROR', '断り文句生成失敗');
    return `【断り文句】今は必要ない
【切り返し】そうでございますか。では、年に一度の電気設備点検だけでもいかがでしょうか。ご費用もかかりません。

【断り文句】業者がいる
【切り返し】ありがとうございます。もし急なトラブルや増設のご相談の際には、ぜひ第二の選択肢としてお声がけいただけますでしょうか。

【断り文句】予算がない
【切り返し】承知いたしました。弊社のLED改修は初期費用ゼロのリース対応も可能です。まずは試算だけでもいかがでしょうか。`;
  }

  agentLog('S-05-⑤', 'OK', '断り文句対策生成完了');
  return objections.trim();
}

/**
 * S-05 メイン: TalkScriptTeam — スクリプト一式を返す
 * @param {string} companyName 会社名
 * @param {string} industry 業種
 * @param {string} size 規模
 * @returns {{profile:Object, painPoints:Object, pitch:Object, script:string, objections:string}} スクリプト一式
 */
function runTalkScriptTeam(companyName, industry, size) {
  agentLog('S-05', 'START', '=== TalkScriptTeam 開始: ' + companyName + ' ===');

  if (!companyName) {
    agentLog('S-05', 'ERROR', '会社名が必要です');
    return null;
  }

  // ① ターゲットプロフィール生成（Grok）
  const profile = s05_targetProfileBuilder(companyName, industry, size);
  profile.companyName = companyName; // 会社名を追加

  // ② 潜在課題分析（Claude）
  const painPoints = s05_painPointAnalyzer(profile);

  // ③ ピッチ生成
  const pitch = s05_pitchBuilder(profile, painPoints);

  // ④ トークスクリプト生成（Claude）
  const script = s05_scriptWriter(profile, painPoints, pitch);

  // ⑤ 断り文句対策生成（Claude）
  const objections = s05_objectionHandler(profile, script);

  agentLog('S-05', 'END', '=== TalkScriptTeam 完了 ===');
  return { profile, painPoints, pitch, script, objections };
}

/**
 * S-05 LINE通知付き版: generateTalkScriptAndNotify
 * LINE経由で会社名を受け取り、スクリプト生成後にLINEで結果を通知する。
 * @param {string} companyName 会社名
 * @param {string} industry 業種（省略可）
 * @param {string} size 規模（省略可）
 */
function generateTalkScriptAndNotify(companyName, industry, size) {
  agentLog('S-05', 'START', 'LINE通知付きスクリプト生成: ' + companyName);

  const result = runTalkScriptTeam(companyName, industry, size);

  if (!result) {
    sendLineToManager('❌ スクリプト生成失敗: 会社名を確認してください');
    return;
  }

  // LINEに結果サマリを通知（スクリプト全文は長いので要点のみ）
  const summaryLines = [
    '📞【トークスクリプト生成完了】',
    '会社: ' + companyName,
    '建物: ' + (result.profile.buildingType || '不明'),
    '主要課題: ' + (result.painPoints.primaryPain || '不明'),
    '最適サービス: ' + (result.pitch.pitchPoints[0] || '不明'),
    '電話おすすめ時間: ' + (result.profile.bestTimeToCall || '不明'),
    '',
    '── スクリプト冒頭 ──',
    result.script.substring(0, 300) + '…',
  ].join('\n');

  sendLineToManager(summaryLines, [
    lineQR('📋 全文をログで確認', 'action=view_script&company=' + encodeURIComponent(companyName)),
  ]);

  // 全文はLoggerに出力
  Logger.log('=== ' + companyName + ' トークスクリプト全文 ===\n' + result.script);
  Logger.log('=== 断り文句対策 ===\n' + result.objections);

  agentLog('S-05', 'END', 'LINE通知完了: ' + companyName);
}


// ============================================================
// スプシ初期セットアップ（Sales系）
// orchestrator.gsのsetupAllSheets()から呼ばれる想定
// ============================================================

/**
 * 案件管理スプシのヘッダーを初期設定する
 */
function setupMainSheet() {
  const sheetId = getProp('SHEET_ID');
  if (!sheetId) { Logger.log('❌ SHEET_ID未設定'); return; }

  const ss    = SpreadsheetApp.openById(sheetId);
  let   sheet = ss.getSheetByName('案件一覧');
  if (!sheet) sheet = ss.insertSheet('案件一覧');

  const headers = [
    '記録日時', 'メールID', '件名', '送信元', '分類', '優先度',
    '顧客名', '現場住所', '工事種別', '推定金額', 'ステータス',
    '地域', '緊急度', '備考',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0D1B3E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140);
  sheet.setColumnWidth(3, 280);
  sheet.setColumnWidth(14, 300);
  Logger.log('✅ 案件管理スプシ セットアップ完了');
}

/**
 * CRM（リード）スプシのヘッダーを初期設定する
 */
function setupCrmSheet() {
  const sheetId = getProp('CRM_SHEET_ID');
  if (!sheetId) { Logger.log('❌ CRM_SHEET_ID未設定'); return; }

  const ss    = SpreadsheetApp.openById(sheetId);
  let   sheet = ss.getSheetByName('リード一覧');
  if (!sheet) sheet = ss.insertSheet('リード一覧');

  const headers = [
    '登録日', '会社名', '担当者名', '役職', 'メール', '電話番号',
    '業種', '優先度スコア', 'マッチングサービス', '推定課題',
    'ステータス', '最終アクション日', '備考',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#1A3A1A').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 180);
  sheet.setColumnWidth(9, 200);
  sheet.setColumnWidth(10, 200);
  Logger.log('✅ CRMスプシ セットアップ完了');
}

/**
 * フォローアップスプシのヘッダーを初期設定する
 */
function setupFollowUpSheet() {
  const sheetId = getProp('FOLLOWUP_SHEET_ID');
  if (!sheetId) { Logger.log('❌ FOLLOWUP_SHEET_ID未設定'); return; }

  const ss    = SpreadsheetApp.openById(sheetId);
  let   sheet = ss.getSheetByName('フォローアップ');
  if (!sheet) sheet = ss.insertSheet('フォローアップ');

  const headers = [
    '案件完了日', '顧客名', 'メール', '工事内容', '現場',
    'やり取り履歴', '最終連絡日', 'フォローアップ済み', '備考',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#3A1A1A').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(6, 250);
  Logger.log('✅ フォローアップスプシ セットアップ完了');
}

// setupAllSheets() は orchestrator.gs に定義（重複防止）


// ============================================================
// テスト関数
// ============================================================

/**
 * S-01 単体テスト（ダミーメールで動作確認）
 */
function testS01_EmailIntakeTeam() {
  Logger.log('=== S-01 EmailIntakeTeam テスト ===');

  const testEmail = {
    id:      'test_s01_' + Date.now(),
    subject: '名古屋市内の工場LED照明改修について',
    from:    'tanaka@factory-example.co.jp',
    body:    'お世話になっております。名古屋市守山区の自動車部品工場です。\n工場内の蛍光灯（約300本）をLEDに交換したいと考えております。\n来月中に現地調査をお願いできますでしょうか。概算費用も教えていただけると助かります。\n担当: 田中 太郎（施設管理部）TEL: 052-XXX-XXXX',
    date:    new Date().toString(),
  };

  Logger.log('--- ② 分類テスト ---');
  const result = s01_classifier(testEmail);
  Logger.log('分類結果: ' + JSON.stringify(result));

  Logger.log('--- ③ 返信文生成テスト ---');
  const draft = s01_draftComposer(testEmail, result);
  Logger.log('返信文案:\n' + draft);

  Logger.log('=== S-01 テスト完了 ===');
}

/**
 * S-02 単体テスト（ダミーメールで動作確認）
 */
function testS02_HearingTeam() {
  Logger.log('=== S-02 HearingTeam テスト ===');

  const testEmail = {
    id:      'test_s02_' + Date.now(),
    subject: '太陽光パネル設置の見積依頼',
    from:    'yamada@solar-company.co.jp',
    body:    'はじめまして。愛知県豊田市で倉庫を経営しております山田と申します。\n屋根に太陽光パネルを設置したいと考えており、お見積をお願いしたいです。\n屋根面積はおよそ500平米です。よろしくお願いします。',
    date:    new Date().toString(),
  };

  const classifyResult = { category: '案件', workType: '太陽光パネル設置', priority: 'medium' };

  Logger.log('--- ① 見積依頼判定 ---');
  const isInquiry = s02_inquiryDetector(testEmail);
  Logger.log('見積依頼: ' + isInquiry);

  if (isInquiry) {
    Logger.log('--- ② 確認事項生成 ---');
    const questions = s02_questionGenerator(testEmail);
    Logger.log('確認事項: ' + JSON.stringify(questions));

    Logger.log('--- ③ ヒアリングメール生成 ---');
    const hearingBody = s02_hearingComposer(testEmail, questions);
    Logger.log('ヒアリングメール:\n' + hearingBody);
  }

  Logger.log('=== S-02 テスト完了 ===');
}

/**
 * S-03 単体テスト（ダミー名刺で動作確認）
 */
function testS03_LeadScoringTeam() {
  Logger.log('=== S-03 LeadScoringTeam テスト ===');

  const testCard = `株式会社アイシン
製造部 施設管理課 課長
鈴木 健太郎
suzu.kentaro@aisin-example.co.jp
TEL: 0566-XX-XXXX
愛知県刈谷市`;

  Logger.log('--- 名刺テキスト ---\n' + testCard);

  const result = runLeadScoringTeam(testCard);
  Logger.log('--- 処理結果 ---');
  Logger.log('会社: ' + result.cardInfo.company);
  Logger.log('スコア: ' + result.score + '/100');
  Logger.log('マッチサービス: ' + result.serviceMatch.topService);
  Logger.log('主要課題: ' + result.painPoints.primaryPain);

  Logger.log('=== S-03 テスト完了 ===');
}

/**
 * S-05 単体テスト（ダミー会社でスクリプト生成確認）
 */
function testS05_TalkScriptTeam() {
  Logger.log('=== S-05 TalkScriptTeam テスト ===');

  const companyName = '株式会社デンソー刈谷工場';
  const industry    = '自動車部品製造';
  const size        = '大企業';

  Logger.log('ターゲット: ' + companyName);

  const result = runTalkScriptTeam(companyName, industry, size);

  Logger.log('--- ① プロフィール ---');
  Logger.log(JSON.stringify(result.profile, null, 2));

  Logger.log('--- ② 潜在課題 ---');
  Logger.log(JSON.stringify(result.painPoints, null, 2));

  Logger.log('--- ③ ピッチ ---');
  Logger.log(JSON.stringify(result.pitch, null, 2));

  Logger.log('--- ④ トークスクリプト ---');
  Logger.log(result.script);

  Logger.log('--- ⑤ 断り文句対策 ---');
  Logger.log(result.objections);

  Logger.log('=== S-05 テスト完了 ===');
}

/**
 * 全エージェントの設定確認テスト
 */
function testAllAgentConfig() {
  Logger.log('=== SalesTeam 設定確認 ===');
  const checks = [
    'SHEET_ID',
    'EXISTING_SHEET_ID',
    'CRM_SHEET_ID',
    'FOLLOWUP_SHEET_ID',
    'XAI_API_KEY',
    'CLAUDE_API_KEY',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_USER_IDS',
    'EIGYO_SUPABASE_URL',
    'EIGYO_SUPABASE_KEY',
  ];
  checks.forEach(key => {
    const val = getProp(key);
    Logger.log(key + ': ' + (val ? '✅ 設定済み' : '❌ 未設定'));
  });
  Logger.log('manager LINE ID: ' + (getManagerLineId() ? '✅ 設定済み' : '❌ 未設定'));
  Logger.log('=== 設定確認完了 ===');
}


// ============================================================
// S-06: EigyoActionProcessor — eigyo-auto pending アクション処理
// ============================================================
// eigyo-auto の Supabase (sales_actions テーブル) に溜まった
// pending アクションを定期的に読み取り、実行する。
//
// 対応アクション:
//   create_gmail_draft    → Gmail 下書き作成
//   create_calendar_event → Google カレンダー登録
//
// スクリプトプロパティ（GASエディタで設定）:
//   EIGYO_SUPABASE_URL  https://qppsurknarwkodfagayo.supabase.co
//   EIGYO_SUPABASE_KEY  eigyo-auto の Service Role Key
//
// トリガー設定: 5分ごと
// ============================================================

function s06_supabaseGet(path) {
  const url = getProp('EIGYO_SUPABASE_URL');
  const key = getProp('EIGYO_SUPABASE_KEY');
  if (!url || !key) return null;

  const res = UrlFetchApp.fetch(url + path, {
    method: 'get',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
}

function s06_supabasePatch(path, body) {
  const url = getProp('EIGYO_SUPABASE_URL');
  const key = getProp('EIGYO_SUPABASE_KEY');
  if (!url || !key) return;

  UrlFetchApp.fetch(url + path, {
    method: 'patch',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
}

function s06_createGmailDraft(payload) {
  const { to, subject, body } = payload;
  if (!to || !subject || !body) {
    agentLog('S-06', 'ERROR', 'Gmail下書き: to/subject/body が不足');
    return false;
  }
  try {
    GmailApp.createDraft(to, subject, body + MARUKEN_SIGNATURE, {
      name: '株式会社マルケン電工',
    });
    agentLog('S-06', 'OK', 'Gmail下書き作成: ' + subject + ' → ' + to);
    return true;
  } catch (e) {
    agentLog('S-06', 'ERROR', 'Gmail下書きエラー: ' + e.toString());
    return false;
  }
}

function s06_createCalendarEvent(payload) {
  const { event_title, event_datetime, description, company_name } = payload;
  if (!event_datetime) {
    agentLog('S-06', 'ERROR', 'カレンダー登録: event_datetime が不足');
    return false;
  }
  try {
    const start = new Date(event_datetime);
    const end   = new Date(start.getTime() + 60 * 60 * 1000); // 1時間
    const title = company_name
      ? '【アポ】' + company_name + ' - ' + (event_title || '現地調査・打ち合わせ')
      : (event_title || '現地調査・打ち合わせ');

    CalendarApp.getDefaultCalendar().createEvent(title, start, end, {
      description: description || '',
    });
    agentLog('S-06', 'OK', 'カレンダー登録: ' + title + ' @ ' + start.toLocaleString('ja-JP'));
    return true;
  } catch (e) {
    agentLog('S-06', 'ERROR', 'カレンダー登録エラー: ' + e.toString());
    return false;
  }
}

function runEigyoActionProcessor() {
  agentLog('S-06', 'START', '=== EigyoActionProcessor 開始 ===');

  const actions = s06_supabaseGet('/rest/v1/sales_actions?status=eq.pending&select=id,action_type,payload,lead_id&limit=20');
  if (!actions || actions.length === 0) {
    agentLog('S-06', 'END', 'pending actions なし');
    return;
  }

  agentLog('S-06', 'INFO', 'pending: ' + actions.length + '件');

  let successCount = 0;
  let failCount    = 0;

  actions.forEach(action => {
    try {
      const payload = action.payload || {};
      let ok = false;

      if (action.action_type === 'create_gmail_draft') {
        ok = s06_createGmailDraft(payload);
      } else if (action.action_type === 'create_calendar_event') {
        ok = s06_createCalendarEvent(payload);
      } else {
        agentLog('S-06', 'SKIP', '未知のaction_type: ' + action.action_type);
        return;
      }

      s06_supabasePatch(
        '/rest/v1/sales_actions?id=eq.' + action.id,
        { status: ok ? 'completed' : 'failed' }
      );

      if (ok) { successCount++; } else { failCount++; }

    } catch (e) {
      agentLog('S-06', 'ERROR', 'action ' + action.id + ': ' + e.toString());
      s06_supabasePatch('/rest/v1/sales_actions?id=eq.' + action.id, { status: 'failed' });
      failCount++;
    }
  });

  if (successCount > 0) {
    sendLineToManager(
      '✅【eigyo-auto 自動処理完了】\n' +
      '成功: ' + successCount + '件 / 失敗: ' + failCount + '件\n' +
      '（GmailとGoogleカレンダーをご確認ください）'
    );
  }

  agentLog('S-06', 'END', '=== EigyoActionProcessor 完了 | 成功: ' + successCount + ' / 失敗: ' + failCount + ' ===');
}

function setupTriggers_S06() {
  // 既存のS-06トリガーのみ削除して再作成
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runEigyoActionProcessor') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runEigyoActionProcessor')
    .timeBased().everyMinutes(5).create();
  Logger.log('✅ S-06 トリガー設定完了（5分ごと）');
}

// ============================================================
// S-07: EigyoPipelineScheduler — 毎朝8時に eigyo-auto を起動
// ============================================================
// スクリプトプロパティ:
//   EIGYO_AUTO_URL  eigyo-auto Vercel デプロイURL（例: https://eigyo-auto.vercel.app）

function runEigyoPipeline() {
  agentLog('S-07', 'START', '=== EigyoPipeline 朝イチ起動 ===');

  const baseUrl = PropertiesService.getScriptProperties().getProperty('EIGYO_AUTO_URL');
  if (!baseUrl) {
    agentLog('S-07', 'ERROR', 'EIGYO_AUTO_URL が未設定 — スクリプトプロパティに追加してください');
    return;
  }

  try {
    const res = UrlFetchApp.fetch(baseUrl.replace(/\/$/, '') + '/api/sales/pipeline', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ include_discovery: true, daily_count: 15 }),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code === 200) {
      const data = JSON.parse(body);
      const discovered = data.data?.discovered ?? 0;
      const processed  = data.data?.processed  ?? 0;
      agentLog('S-07', 'OK', '発掘: ' + discovered + '社 / メール生成: ' + processed + '社');
      sendLineToManager(
        '🌅【eigyo-auto 朝イチ起動完了】\n' +
        '新規発掘: ' + discovered + '社\n' +
        'メール生成: ' + processed + '社\n' +
        '（Gmail下書きを確認してください）'
      );
    } else {
      agentLog('S-07', 'ERROR', 'HTTP ' + code + ': ' + body.slice(0, 300));
      sendLineToManager('⚠️【eigyo-auto パイプラインエラー】HTTP ' + code);
    }
  } catch (e) {
    agentLog('S-07', 'ERROR', e.toString());
    sendLineToManager('⚠️【eigyo-auto パイプラインエラー】' + e.toString().slice(0, 100));
  }

  agentLog('S-07', 'END', '=== EigyoPipeline 完了 ===');
}

function setupTriggers_S07() {
  // 既存のS-07トリガーのみ削除して再作成
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runEigyoPipeline') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runEigyoPipeline')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();
  Logger.log('✅ S-07 トリガー設定完了（毎朝8時）');
}
