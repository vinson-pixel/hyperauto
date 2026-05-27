// ============================================================
// Agent-004 v2: メール受信・AI判定・LINEアクションエージェント
// 対象: info@marukendenkou.com
// ============================================================
//
// スクリプトプロパティ:
//   SHEET_ID                  Agent-004専用スプシID
//   EXISTING_SHEET_ID         既存案件管理スプシID
//   XAI_API_KEY               xAI API
//   LINE_CHANNEL_ACCESS_TOKEN LINE Messaging API
//   LINE_USER_IDS             manager:Uabc,owner:Uxyz
// ============================================================

const ACOL = {
  DATE:       1,  // A: 記録日時
  EMAIL_ID:   2,  // B: メールID（重複防止）
  SUBJECT:    3,  // C: 件名
  FROM:       4,  // D: 送信元
  CATEGORY:   5,  // E: 分類（案件/返信必要/不要）
  PRIORITY:   6,  // F: 優先度
  CUSTOMER:   7,  // G: 顧客名
  LOCATION:   8,  // H: 現場住所
  WORK_TYPE:  9,  // I: 工事種別
  AMOUNT:     10, // J: 推定金額
  STATUS:     11, // K: ステータス
  APPROVAL:   12, // L: 承認
  BILLING:    13, // M: 請求送付
  FOLLOWUP:   14, // N: フォローアップ
  NOTES:      15  // O: 備考
};

// ─── メール処理メイン ─────────────────────────────────────
function processNewEmails() {
  const label   = getOrCreateLabel('AI処理済み');
  const today   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  const threads = GmailApp.search('in:inbox -label:AI処理済み after:' + today);
  if (threads.length === 0) { Logger.log('新着メールなし'); return; }

  // 件名重複チェック用キャッシュ（転送・RE:の重複排除、6時間有効）
  const cache = CacheService.getScriptCache();
  const cachedSubjectsRaw = cache.get('processed_subjects');
  const processedSubjects = cachedSubjectsRaw ? JSON.parse(cachedSubjectsRaw) : [];

  threads.forEach(thread => {
    try {
      const messages = thread.getMessages();
      // 最新メッセージを本文・差出人の分析対象にする
      const msg     = messages[messages.length - 1];
      const msgId   = msg.getId();
      const subject = msg.getSubject();
      const normSub = normalizeSubject(subject);

      // 転送メール判定（社長個人アドレスからの転送 or Fw:/転送: 付き件名）
      const isForwardEmail = isFromTrustedForwarder(msg.getFrom()) ||
        /^(Fw:|FW:|転送:|【転送】)/i.test((subject || '').trim());

      // 件名重複チェック（転送メールはスキップしない＝確実に処理する）
      if (!isForwardEmail && processedSubjects.includes(normSub)) {
        Logger.log('⏭ 件名重複スキップ: ' + subject);
        thread.addLabel(label);
        return;
      }

      // スレッド内のいずれかのメッセージが自社送信かどうかを判定
      // （元請けの返信がスレッド内にある場合も含めて検出）
      // ※転送メールのスレッドは自社送信と混在しないため除外
      const isReplyToSelf = !isForwardEmail &&
        messages.some(function(m) { return isSelfSentEmail(m.getFrom()); });

      const emailData = {
        id:       msgId,
        threadId: thread.getId(),
        subject:  subject,
        from:     msg.getFrom(),
        body:     msg.getPlainBody().substring(0, 6000),
        date:     msg.getDate().toString()
      };

      // 自社送信メールは案件対象外（Grok呼び出し前にはじく）
      if (isSelfSentEmail(emailData.from)) {
        Logger.log('⏭ 自社メールスキップ: ' + emailData.from + ' | ' + subject);
        thread.addLabel(label);
        return;
      }

      const result = analyzeWithGrok(emailData);

      // 自社メールへの返信スレッドで「案件」判定 = 元請けの発注確認メール
      // → 既にABC各件はスプシに登録済みのため、重複登録をスキップ
      if (isReplyToSelf && result.category === '案件') {
        Logger.log('⏭ 元請け返信（発注確認）スプシ登録スキップ: ' + subject);
        thread.addLabel(label);
        processedSubjects.push(normSub);
        if (processedSubjects.length > 200) processedSubjects.shift();
        cache.put('processed_subjects', JSON.stringify(processedSubjects), 21600);
        return;
      }

      // 案件: Grokが返す jobs[] を個別に登録（抱き合わせ対応＋重複チェック）
      if (result.category === '案件') {
        const jobs = (result.jobs && result.jobs.length > 0)
          ? result.jobs
          : [{ customer: result.customer, location: result.location, workType: result.workType, estAmount: result.estAmount }];

        jobs.forEach(function(job, idx) {
          const jobResult = Object.assign({}, result, job);
          writeToExistingSheet(emailData, jobResult, idx);
        });
      }

      // 案件 → LINE通知あり / 返信必要 → Gmail下書きのみ / 不要 → アーカイブ
      if (result.category === '案件') {
        const draftCreated = createGmailDraft(emailData, result, msg);
        writeToSupabase(emailData, result);
        const firstJob = (result.jobs && result.jobs[0]) || {};
        cache.put('email_' + msgId, JSON.stringify({
          from:     emailData.from,
          subject:  emailData.subject,
          body:     emailData.body.substring(0, 2000),
          customer: firstJob.customer || result.customer || '',
        }), 21600);
        notifyLine(result.category, result, msgId, draftCreated);
      } else if (result.category === '返信必要') {
        createGmailDraft(emailData, result, msg);
      } else {
        thread.moveToArchive();
        Logger.log('🗑 自動アーカイブ: ' + subject);
      }

      // 件名キャッシュに追加（6時間有効、最大200件）
      processedSubjects.push(normSub);
      if (processedSubjects.length > 200) processedSubjects.shift();
      cache.put('processed_subjects', JSON.stringify(processedSubjects), 21600);

      thread.addLabel(label);
      Logger.log('✅ ' + result.category + ' | ' + subject + ' | ' + result.priority);

    } catch(e) {
      Logger.log('❌ エラー: ' + e.toString());
    }
  });
}

// ─── 自社送信メール判定（info@/社員アドレスからのメールをはじく） ─────
function isSelfSentEmail(from) {
  const lower = (from || '').toLowerCase();
  return MARUKEN_EMAILS.some(function(addr) { return lower.indexOf(addr) >= 0; });
}

// ─── 件名正規化（Re:/Fw:/転送: などを除去） ───────────────────
function normalizeSubject(subject) {
  return (subject || '').replace(/^(Re:|RE:|Fw:|FW:|転送:|【転送】)\s*/gi, '').trim().toLowerCase();
}

// ─── Grok判定（3分類） ───────────────────────────────────────
function analyzeWithGrok(emailData) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
  if (!apiKey) return { category: '不要', priority: 'low', notes: 'APIキー未設定' };

  const payload = JSON.stringify({
    model: 'grok-3-mini-fast',
    messages: [
      {
        role: 'system',
        content: 'あなたはマルケン電工（愛知・東京拠点の電気工事会社）のメール仕分けAIです。JSONのみで返答してください。余分なテキスト不要。'
      },
      {
        role: 'user',
        content: `以下のメールを分析してください。

件名: ${emailData.subject}
送信元: ${emailData.from}
本文:
${emailData.body}

【分類基準】
- category:
  「案件」= 見積依頼・工事依頼・発注・現場相談など仕事になる可能性があるメール
  「返信必要」= 案件ではないが返信が必要（質問・確認・取引先連絡など）
  「不要」= 営業メール・スパム・自動配信・明らかに関係ない
  ※送信元が @marukendenkou.com の場合は自社送信メールのため必ず「不要」にすること
  ※「了承しました」「承知しました」「よろしくお願いします」のみの内容は「返信必要」にすること（案件の新規登録は不要）
- priority: high=緊急/大型 / medium=通常 / low=急がない
- region: 現場の地域（東京都・神奈川・埼玉・千葉は「東京」、愛知・岐阜・三重・静岡は「愛知」、不明または他は「その他」）
- jobs: メール内に複数の現場・工事が含まれる場合は全件を配列で列挙。1件の場合も必ず配列（1要素）で返すこと。

JSON形式のみで返答:
{
  "category": "案件"|"返信必要"|"不要",
  "priority": "high"|"medium"|"low",
  "region": "東京"|"愛知"|"その他",
  "jobs": [
    {
      "customer": "元受け会社名（例：アースファスト株式会社）",
      "siteName": "店舗名・現場名のみ（例：ウエルシア熱田5番町店）※住所・番地は絶対に含めない",
      "siteAddress": "現場の住所（都道府県から番地まで。不明はnull）",
      "workType": "工事種別（不明はnull）",
      "estAmount": 数値またはnull
    }
  ],
  "notes": "判断理由（1文）"
}
※抱き合わせ（複数現場が1通のメールに含まれる）場合は jobs に全件列挙すること`
      }
    ],
    temperature: 0
  });

  const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    payload: payload,
    muteHttpExceptions: true
  });

  try {
    const json   = JSON.parse(res.getContentText());
    const text   = json.choices[0].message.content;
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSONなし: ' + text);
    const parsed = JSON.parse(match[0]);
    // 旧形式（jobs配列なし）との後方互換: customer/location/workTypeをjobs[0]に変換
    if (!parsed.jobs || parsed.jobs.length === 0) {
      parsed.jobs = [{ customer: parsed.customer, location: parsed.location, workType: parsed.workType, estAmount: parsed.estAmount }];
    }
    return parsed;
  } catch(e) {
    Logger.log('Grokパースエラー: ' + e);
    return { category: '返信必要', priority: 'low', notes: 'AI判定エラー' };
  }
}

// マルケン電工の全メールアドレス（自社送信メールの誤判定防止用）
const MARUKEN_EMAILS = [
  'info@marukendenkou.com',
  'asai@marukendenkou.com',
  'shigeno@marukendenkou.com',
  'vinson@marukendenkou.com',
];

// 社長の個人アドレス（ここから転送されるメールは件名キャッシュをスキップして確実に処理）
const FORWARD_EMAILS = [
  'mky7584gd@gmail.com',
];

function isFromTrustedForwarder(from) {
  return FORWARD_EMAILS.some(function(addr) { return (from || '').toLowerCase().indexOf(addr) >= 0; });
}

// 転送元を検出して宛先アカウントを返す
// GmailのTo/Delivered-Toヘッダーに社員アドレスがあればそちらに振り分け
const EMPLOYEE_EMAILS = [
  'asai@marukendenkou.com',
  'shigeno@marukendenkou.com',
  'vinson@marukendenkou.com',
];

function detectTargetAccount(msg) {
  const toHeader = msg.getTo() || '';
  for (const emp of EMPLOYEE_EMAILS) {
    if (toHeader.toLowerCase().includes(emp)) return emp;
  }
  return null; // info@のまま（GmailAppで作成）
}

// ─── Gmail下書き作成（委任アクセス対応） ─────────────────────
function createGmailDraft(emailData, result, msg) {
  try {
    const draft = generateDraftWithGrok(emailData, result);
    const targetAccount = msg ? detectTargetAccount(msg) : null;

    if (targetAccount) {
      createDraftViaApi(targetAccount, emailData.from, 'Re: ' + emailData.subject, draft);
      Logger.log('✅ Gmail下書き作成 → ' + targetAccount);
    } else {
      GmailApp.createDraft(
        emailData.from,
        'Re: ' + emailData.subject,
        draft,
        { name: '株式会社マルケン電工' }
      );
      Logger.log('✅ Gmail下書き作成 → info@');
    }
    return true;
  } catch(e) {
    Logger.log('Gmail下書き作成エラー: ' + e.toString());
    return false;
  }
}

// Gmail REST APIで委任先に下書きを作成
function createDraftViaApi(userId, to, subject, body) {
  const boundary = '---MarukenBoundary';
  const emailLines = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'From: ' + userId,
    'To: ' + to,
    'Subject: =?UTF-8?B?' + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + '?=',
    '',
    body,
  ].join('\r\n');

  const encoded = Utilities.base64EncodeWebSafe(emailLines).replace(/=+$/, '');

  const res = UrlFetchApp.fetch(
    'https://gmail.googleapis.com/gmail/v1/users/' + userId + '/drafts',
    {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify({ message: { raw: encoded } }),
      muteHttpExceptions: true,
    }
  );

  const code = res.getResponseCode();
  if (code >= 300) {
    Logger.log('API下書きエラー(' + userId + '): ' + res.getContentText());
    // フォールバック: info@に作成
    GmailApp.createDraft(to, subject, body, { name: '株式会社マルケン電工' });
  }
}

// ─── 返信文生成（品質重視・専用プロンプト） ─────────────────────
function generateDraftWithGrok(emailData, result) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
  if (!apiKey) return '（APIキー未設定）';

  const context = [
    result.customer  ? '顧客: ' + result.customer : null,
    result.workType  ? '工事種別: ' + result.workType : null,
    result.location  ? '現場: ' + result.location : null,
    result.estAmount ? '金額: ' + result.estAmount + '円' : null,
    result.notes     ? '判断メモ: ' + result.notes : null,
  ].filter(Boolean).join('\n');

  const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: 'grok-3-fast',
      messages: [
        {
          role: 'system',
          content: `あなたはマルケン電工（愛知県名古屋市の電気工事会社）の担当者として返信メールを書きます。

【必須ルール】
- 書き出し: 「お世話になっております。株式会社マルケン電工でございます。」
- 相手のメール内容（件名・本文）に具体的に言及して返信する
- 案件・見積依頼なら「担当者より改めてご連絡いたします」と記載
- 質問があれば誠実に回答または「確認の上ご連絡いたします」と記載
- 締め: 「ご不明な点はお気軽にご連絡ください。どうぞよろしくお願いいたします。」
- 署名は書かない（自動付加）
- 丁寧・簡潔・具体的。600字以内。`
        },
        {
          role: 'user',
          content: `【受信メール】\n件名: ${emailData.subject}\n送信元: ${emailData.from}\n本文:\n${emailData.body.substring(0, 3000)}\n\n【AI分析結果】\n${context}`
        }
      ],
      temperature: 0.4,
    }),
    muteHttpExceptions: true,
  });

  try {
    const json = JSON.parse(res.getContentText());
    return json.choices[0].message.content.trim();
  } catch(e) {
    return result.replyDraft || '返信文の生成に失敗しました。手動で作成してください。';
  }
}

// ─── LINE通知（クイックリプライ付き） ──────────────────────────
function notifyLine(category, result, msgId, draftCreated) {
  const props   = PropertiesService.getScriptProperties();
  const token   = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const rawIds  = props.getProperty('LINE_USER_IDS') || '';
  if (!token) { Logger.log('❌ LINE token未設定'); return; }

  // LINE_USER_IDS は "manager:Uid,owner:Uid" または "Uid,Uid" どちらでも対応
  const users = {};
  const rawList = rawIds.split(',').map(e => e.trim()).filter(Boolean);
  rawList.forEach((entry, i) => {
    const colonIdx = entry.indexOf(':');
    if (colonIdx > 0 && !entry.startsWith('U')) {
      users[entry.substring(0, colonIdx).trim()] = entry.substring(colonIdx + 1).trim();
    } else {
      users[i === 0 ? 'manager' : 'extra_' + i] = entry;
    }
  });

  const targetIds = result.priority === 'high'
    ? Object.values(users)
    : (users['manager'] ? [users['manager']] : []);
  if (targetIds.length === 0) return;

  const regionTag = result.region === '東京' ? '東京' : result.region === '愛知' ? '愛知' : '';
  const badge  = category === '案件'
    ? (result.priority === 'high'
        ? '🔴【' + (regionTag || '案件') + (regionTag ? '・案件】' : '】')
        : '🟡【' + (regionTag || '案件') + (regionTag ? '・案件】' : '】'))
    : '🔵【返信必要】';
  const amtStr = result.estAmount ? Number(result.estAmount).toLocaleString() + '円' : null;

  // 返信済みフラグを確認（PropertiesServiceに保存）
  const repliedFlag = PropertiesService.getScriptProperties().getProperty('replied_' + msgId);
  const repliedLabel = repliedFlag ? '✅ 返信済み' : (draftCreated ? '✉️ 下書き保存済み' : null);

  const lines = [
    badge,
    result.customer ? '顧客: ' + result.customer : null,
    result.location ? '場所: ' + result.location : null,
    result.workType ? '工事: ' + result.workType : null,
    amtStr          ? '金額: ' + amtStr          : null,
    result.notes    ? result.notes               : null,
    repliedLabel,
  ].filter(Boolean).join('\n');

  const quickReply = {
    items: [
      { type: 'action', action: { type: 'postback', label: '📧 返信する',   data: 'action=reply_preview&id=' + msgId }},
      { type: 'action', action: { type: 'postback', label: '📅 日程連絡',   data: 'action=schedule_send&id=' + msgId }},
      { type: 'action', action: { type: 'postback', label: '✅ 対応済み',   data: 'action=called&id='        + msgId }},
      { type: 'action', action: { type: 'postback', label: '🗑 不要',       data: 'action=skip&id='          + msgId }},
    ]
  };

  const message = { type: 'text', text: lines, quickReply };
  const endpoint = targetIds.length === 1
    ? 'https://api.line.me/v2/bot/message/push'
    : 'https://api.line.me/v2/bot/message/multicast';
  const body = targetIds.length === 1
    ? { to: targetIds[0], messages: [message] }
    : { to: targetIds,    messages: [message] };

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  Logger.log('LINE送信: ' + res.getResponseCode());
}

// ─── LINEリプライ送信（quickReplyItems省略可） ────────────────
// doPostはorchestrator.gsに統合済み。このファイルでは定義しない。
function replyToLine(replyToken, token, text, quickReplyItems) {
  const message = { type: 'text', text: text };
  if (quickReplyItems && quickReplyItems.length > 0) {
    message.quickReply = { items: quickReplyItems };
  }
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ replyToken, messages: [message] }),
    muteHttpExceptions: true
  });
}

// ─── Grokで返信文を生成 ───────────────────────────────────
function generateReplyDraft(emailData) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('XAI_API_KEY');
  if (!apiKey) return '（APIキー未設定）';

  const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: 'grok-3-mini-fast',
      messages: [
        { role: 'system', content: 'あなたはマルケン電工の担当者です。受信メールへの丁寧な返信文を日本語200字以内で作成してください。文だけ出力。' },
        { role: 'user', content: '件名: ' + emailData.subject + '\n本文:\n' + emailData.body.substring(0, 2000) }
      ],
      temperature: 0.3
    }),
    muteHttpExceptions: true
  });

  try {
    const json = JSON.parse(res.getContentText());
    return json.choices[0].message.content.trim();
  } catch(e) {
    return '返信文の生成に失敗しました';
  }
}

// ─── Supabaseへのメールデータ保存（Vercel Webhook用） ─────────
function writeToSupabase(emailData, result) {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) { Logger.log('Supabase未設定、スキップ'); return; }

  UrlFetchApp.fetch(url + '/rest/v1/line_email_queue', {
    method: 'post',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Prefer':        'return=minimal,resolution=ignore-duplicates',
    },
    payload: JSON.stringify({
      id:        emailData.id,
      subject:   emailData.subject,
      from_addr: emailData.from,
      body:      emailData.body.substring(0, 5000),
      result:    result,
    }),
    muteHttpExceptions: true,
  });
}

// ─── 既存スプシへの転写（案件のみ・重複チェック付き） ──────────
// 列構造: A元受け会社 B現場名 C施工内容 D施工日 E完了日
//         F川口から転送日→AI記録日 G担当者 H日程連絡
//         I カレンダー入力 J完了報告 K ステータス L金額 M備考
// M列末尾に [mid:メールID_連番] を追記して重複チェックキーとして使用
function writeToExistingSheet(emailData, result, jobIndex) {
  const existingId = PropertiesService.getScriptProperties().getProperty('EXISTING_SHEET_ID');
  if (!existingId) return;

  try {
    const ss    = SpreadsheetApp.openById(existingId);
    const sheet = ss.getSheetByName('一覧') || ss.getSheets()[0];

    // 重複チェック: M列（備考）に同じ dedupeKey が含まれていればスキップ
    // スレッドID+現場名で判定することで、同一スレッドの返信メールによる二重登録を防ぐ
    const siteNameForKey = result.siteName || result.location || '';
    const locationKey = siteNameForKey.replace(/\s/g, '').substring(0, 20) || String(jobIndex || 0);
    const dedupeKey = '[tid:' + (emailData.threadId || emailData.id) + '_' + locationKey + ']';
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const notesCells = sheet.getRange(2, 13, lastRow - 1, 1).getValues().flat();
      if (notesCells.some(function(v) { return String(v).indexOf(dedupeKey) >= 0; })) {
        Logger.log('⏭ 重複スキップ（既登録）: ' + dedupeKey);
        return;
      }

      // 追加チェック: 現場名の正規化マッチ（スレッドが違っても同名現場はスキップ）
      const normalizedNew = normalizeSiteNameForDedup_(siteNameForKey);
      if (normalizedNew.length >= 4) {
        const allRows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
        // 完了済みも含めて30日以内の同名現場はスキップ（報告書送信後の確認メール対策）
        const CUTOFF = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30日前
        const sameNameExists = allRows.some(function(r) {
          const aiDate = r[5];
          if (aiDate && new Date(aiDate) < CUTOFF) return false; // 30日より古い行は対象外
          const normalizedExisting = normalizeSiteNameForDedup_(String(r[1] || ''));
          return normalizedExisting.length >= 4 && (
            normalizedExisting === normalizedNew ||
            normalizedExisting.indexOf(normalizedNew) !== -1 ||
            normalizedNew.indexOf(normalizedExisting) !== -1
          );
        });
        if (sameNameExists) {
          Logger.log('⏭ 重複スキップ（同名現場あり・30日以内）: ' + normalizedNew);
          return;
        }
      }
    }

    const newRow = lastRow + 1;
    sheet.getRange(newRow, 1, 1, 13).setValues([[
      result.customer  || '',                          // A: 元受け会社
      result.siteName  || result.location || '',       // B: 現場名（店舗名のみ）
      result.workType  || '',                          // C: 施工内容
      '',                                              // D: 施工日（未定）
      '',                                              // E: 完了日（未定）
      new Date(),                                      // F: AI記録日
      '',                                              // G: 担当者
      '',                                              // H: 日程連絡
      '',                                              // I: カレンダー入力
      '',                                              // J: 完了報告
      '新規',                                          // K: ステータス
      result.estAmount || '',                          // L: 金額
      (result.region ? '[' + result.region + '] ' : '') + (result.siteAddress ? '[ADDR:' + result.siteAddress + '] ' : '') + (result.notes || '') + ' ' + dedupeKey,  // M: 備考（住所・地域・重複チェックキー埋め込み）
    ]]);

    Logger.log('✅ 既存スプシ（一覧）に転写: row ' + newRow + ' | ' + dedupeKey);
  } catch(e) {
    Logger.log('既存スプシ書き込みエラー: ' + e.toString());
  }
}

// ─── 承認済み返信をGmailで送信 ───────────────────────────────
function sendApprovedReplies() {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) return;

  // approved ステータスの返信を取得
  const res = UrlFetchApp.fetch(
    url + '/rest/v1/line_reply_queue?status=eq.approved&select=*',
    {
      headers: {
        'apikey':        key,
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
      },
      muteHttpExceptions: true,
    }
  );

  const replies = JSON.parse(res.getContentText());
  if (!Array.isArray(replies) || replies.length === 0) return;

  replies.forEach(reply => {
    try {
      GmailApp.sendEmail(
        reply.to_addr,
        reply.subject,
        reply.reply_text,
        { name: '株式会社マルケン電工' }
      );

      // ステータスを sent に更新
      UrlFetchApp.fetch(url + '/rest/v1/line_reply_queue?id=eq.' + reply.id, {
        method: 'patch',
        headers: {
          'apikey':        key,
          'Authorization': 'Bearer ' + key,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        payload: JSON.stringify({ status: 'sent' }),
        muteHttpExceptions: true,
      });

      Logger.log('✅ 返信送信完了: ' + reply.to_addr + ' / ' + reply.subject);
    } catch(e) {
      Logger.log('返信送信エラー: ' + e.toString());
    }
  });
}

// ─── 日次バッチ（請求・フォローアップ） ─────────────────────
function dailyBatchProcess() {
  const props   = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) return;

  const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('案件一覧');
  if (!sheet) return;

  const rows  = sheet.getDataRange().getValues();
  const today = new Date();

  rows.forEach((row, i) => {
    if (i === 0) return;
    const status   = row[ACOL.STATUS   - 1];
    const approval = row[ACOL.APPROVAL - 1];
    const billing  = row[ACOL.BILLING  - 1];
    const followUp = row[ACOL.FOLLOWUP - 1];
    const toEmail  = row[ACOL.FROM     - 1];
    const customer = row[ACOL.CUSTOMER - 1];
    const workType = row[ACOL.WORK_TYPE- 1];
    const amount   = row[ACOL.AMOUNT   - 1];

    if (approval === 'yes' && status === '完了' && billing === '未送付') {
      sendBillingEmail(toEmail, customer, workType, amount);
      sheet.getRange(i + 1, ACOL.BILLING).setValue('送付済');
    }

    if (status === '完了' && followUp === '未') {
      const daysPassed = (today.getTime() - new Date(row[ACOL.DATE - 1]).getTime()) / 86400000;
      if (daysPassed >= 7) {
        sendFollowUpEmail(toEmail, customer);
        sheet.getRange(i + 1, ACOL.FOLLOWUP).setValue('送付済');
      }
    }
  });
}

// ─── 請求メール ───────────────────────────────────────────
function sendBillingEmail(to, customer, workType, amount) {
  const amtStr = amount ? Number(amount).toLocaleString() + '円（税別）' : '別途お見積書をご確認ください';
  GmailApp.sendEmail(to, `【ご請求書送付】${workType} — 株式会社マルケン電工`,
    `${customer} 御中\n\nいつもお世話になっております。\n株式会社マルケン電工でございます。\n\n${workType}のご請求書をお送りいたします。\nご請求金額：${amtStr}\n\n恐れ入りますが、ご確認のほどよろしくお願いいたします。\n\n─────────────────────────\n株式会社マルケン電工\n〒468-0015 愛知県名古屋市天白区原4丁目1603\nTEL: 052-806-9481 / Mail: info@marukendenkou.com\n─────────────────────────`,
    { name: '株式会社マルケン電工' });
}

// ─── フォローアップメール ─────────────────────────────────
function sendFollowUpEmail(to, customer) {
  GmailApp.sendEmail(to, `【工事完了後のご確認】株式会社マルケン電工`,
    `${customer} 御中\n\nいつもお世話になっております。\n株式会社マルケン電工でございます。\n\n先日の工事完了後、設備の状態はいかがでしょうか。\nご不明な点やお気づきの点がございましたら、お気軽にご連絡ください。\n\n今後ともよろしくお願いいたします。\n\n─────────────────────────\n株式会社マルケン電工\nTEL: 052-806-9481 / Mail: info@marukendenkou.com\n─────────────────────────`,
    { name: '株式会社マルケン電工' });
}

// ─── 初回セットアップ ─────────────────────────────────────
function setupSpreadsheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) { Logger.log('❌ SHEET_ID未設定'); return; }

  const ss    = SpreadsheetApp.openById(sheetId);
  let   sheet = ss.getSheetByName('案件一覧');
  if (!sheet) { sheet = ss.insertSheet('案件一覧'); }

  const headers = ['記録日時','メールID','件名','送信元','分類','優先度','顧客名','現場住所','工事種別','推定金額','ステータス','承認','請求送付','フォローアップ','備考'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0D1B3E').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 140); sheet.setColumnWidth(3, 280); sheet.setColumnWidth(15, 300);
  Logger.log('✅ セットアップ完了');
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processNewEmails').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('sendApprovedReplies').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyBatchProcess').timeBased().atHour(8).everyDays(1).create();
  Logger.log('✅ トリガー設定完了');
}

// ─── 過去N日間のメール監査（手動実行） ──────────────────────
// GASエディタから手動で実行すると過去2週間の未処理メールを一括チェック
// 既にスプシに登録済みのもの（dedupeKeyで照合）は重複登録されない
function auditPastEmails() {
  const DAYS_BACK = 14;
  const since = new Date();
  since.setDate(since.getDate() - DAYS_BACK);
  const afterDate = Utilities.formatDate(since, 'Asia/Tokyo', 'yyyy/MM/dd');

  Logger.log('=== 過去' + DAYS_BACK + '日間のメール監査開始: ' + afterDate + ' 以降 ===');

  const label   = getOrCreateLabel('AI処理済み');
  const threads = GmailApp.search('in:inbox -label:AI処理済み after:' + afterDate);
  Logger.log('未処理スレッド数: ' + threads.length);

  if (threads.length === 0) {
    Logger.log('未処理メールなし');
    return;
  }

  const registered  = [];
  const skipped     = [];
  const cache       = CacheService.getScriptCache();
  const processedSubjects = [];

  threads.forEach(function(thread) {
    try {
      const messages = thread.getMessages();
      const msg     = messages[messages.length - 1];
      const subject = msg.getSubject();
      const normSub = normalizeSubject(subject);

      const isForwardEmail = isFromTrustedForwarder(msg.getFrom()) ||
        /^(Fw:|FW:|転送:|【転送】)/i.test((subject || '').trim());

      if (!isForwardEmail && processedSubjects.includes(normSub)) {
        skipped.push('件名重複: ' + subject);
        thread.addLabel(label);
        return;
      }

      if (isSelfSentEmail(msg.getFrom())) {
        thread.addLabel(label);
        return;
      }

      const isReplyToSelf = !isForwardEmail &&
        messages.some(function(m) { return isSelfSentEmail(m.getFrom()); });

      const emailData = {
        id:      msg.getId(),
        subject: subject,
        from:    msg.getFrom(),
        body:    msg.getPlainBody().substring(0, 6000),
        date:    msg.getDate().toString()
      };

      const result = analyzeWithGrok(emailData);
      if (!result || result.category === '不要') {
        thread.addLabel(label);
        return;
      }

      if (isReplyToSelf && result.category === '案件') {
        Logger.log('⏭ 元請け返信スキップ: ' + subject);
        thread.addLabel(label);
        return;
      }

      if (result.category === '案件') {
        const jobs = (result.jobs && result.jobs.length > 0)
          ? result.jobs
          : [{ customer: result.customer, location: result.location, workType: result.workType, estAmount: result.estAmount }];

        jobs.forEach(function(job, idx) {
          const jobResult = Object.assign({}, result, job);
          writeToExistingSheet(emailData, jobResult, idx);
        });
        registered.push((result.jobs && result.jobs.length > 1 ? '【抱合せ' + result.jobs.length + '件】' : '') + subject);
      }

      processedSubjects.push(normSub);
      thread.addLabel(label);

    } catch(err) {
      Logger.log('監査エラー: ' + err.toString());
    }
  });

  // 結果をLINEで報告
  const summary = [
    '📋 過去' + DAYS_BACK + '日間メール監査完了',
    '─────────────────',
    '新規登録: ' + registered.length + '件',
    registered.map(function(s) { return '  ・' + s.substring(0, 30); }).join('\n'),
    skipped.length > 0 ? '重複スキップ: ' + skipped.length + '件' : '',
  ].filter(Boolean).join('\n');

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const rawIds = props.getProperty('LINE_USER_IDS') || '';
  if (token && rawIds) {
    const userId = rawIds.split(',')[0].split(':').pop().trim();
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: summary }] }),
      muteHttpExceptions: true
    });
  }

  Logger.log(summary);
  Logger.log('=== 監査完了 ===');
}

// ─── テスト実行 ───────────────────────────────────────────
function testRun() {
  Logger.log('=== Agent-004 v2 テスト開始 ===');
  const props = PropertiesService.getScriptProperties().getProperties();
  ['SHEET_ID','EXISTING_SHEET_ID','XAI_API_KEY','LINE_CHANNEL_ACCESS_TOKEN','LINE_USER_IDS','SUPABASE_URL','SUPABASE_SERVICE_KEY'].forEach(key => {
    Logger.log(key + ': ' + (props[key] ? '✅ 設定済み' : '❌ 未設定'));
  });

  const testEmail = {
    id:      'test_' + Date.now(),
    subject: '渋谷区オフィスビル照明改修の件',
    from:    'tanaka@example.com',
    body:    'お世話になっております。渋谷区のオフィスビルにてLED照明改修工事をお願いしたく連絡しました。予算は50万円程度で来月中旨お願いします。',
    date:    new Date().toString()
  };

  Logger.log('Grokテスト...');
  const result = analyzeWithGrok(testEmail);
  Logger.log('判定: ' + JSON.stringify(result));

  if (result.category !== '不要') {
    Logger.log('LINE通知テスト...');
    notifyLine(result.category, result, testEmail.id);
  }
  Logger.log('=== テスト完了 ===');
}

// ─── Supabase疎通テスト ───────────────────────────────────
function testSupabase() {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('SUPABASE_URL');
  const key   = props.getProperty('SUPABASE_SERVICE_KEY');
  Logger.log('SUPABASE_URL: ' + (url || '❌ 未設定'));
  Logger.log('SUPABASE_SERVICE_KEY: ' + (key ? '✅ 設定済み' : '❌ 未設定'));
  if (!url || !key) return;

  // テストデータ書き込み
  const testId = 'test_' + Date.now();
  const res = UrlFetchApp.fetch(url + '/rest/v1/line_email_queue', {
    method: 'post',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Prefer':        'return=minimal,resolution=ignore-duplicates',
    },
    payload: JSON.stringify({
      id:        testId,
      subject:   'テスト件名',
      from_addr: 'test@example.com',
      body:      'テスト本文',
      result:    { category: '返信必要' },
    }),
    muteHttpExceptions: true,
  });
  Logger.log('Supabase書き込みレスポンス: ' + res.getResponseCode());
  if (res.getResponseCode() < 300) {
    Logger.log('✅ Supabase書き込み成功 → 返信文作成ボタンが機能します');
  } else {
    Logger.log('❌ Supabase書き込み失敗: ' + res.getContentText());
  }
}

// ─── 既存スプシ構造確認 ───────────────────────────────────
function readExistingSheet() {
  const EXISTING_ID = '1UptuKwGKdMiYGiyWwL55yLKXNQ5xkevKv-X0MVikcKw';
  const ss = SpreadsheetApp.openById(EXISTING_ID);
  ss.getSheets().forEach(sheet => {
    const last = sheet.getLastColumn();
    if (last === 0) { Logger.log('シート「' + sheet.getName() + '」: 空'); return; }
    const headers = sheet.getRange(1, 1, 1, last).getValues()[0];
    Logger.log('【' + sheet.getName() + '】');
    headers.forEach((h, i) => Logger.log('  ' + String.fromCharCode(65 + i) + '列: ' + h));
  });
}

// ─── 既存スプシIDを設定 ───────────────────────────────────
function setExistingSheetId() {
  PropertiesService.getScriptProperties().setProperty(
    'EXISTING_SHEET_ID', '1UptuKwGKdMiYGiyWwL55yLKXNQ5xkevKv-X0MVikcKw'
  );
  Logger.log('✅ EXISTING_SHEET_ID 設定完了');
}

// ─── LINE Webhook URL 自動設定（一回だけ実行） ───────────────
function setLineWebhookUrl() {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { Logger.log('❌ LINE_CHANNEL_ACCESS_TOKEN 未設定'); return; }

  const webhookUrl = 'https://script.google.com/macros/s/AKfycbyU38TvdOdLTx7wX5Xh730XbLJ2ozzALuYNy3E694siJ7zAwZbTHs1gVESd8RaXscyivA/exec';
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    method: 'put',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ endpoint: webhookUrl }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code === 200) {
    Logger.log('✅ LINE Webhook URL 設定完了');
    const check = UrlFetchApp.fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    Logger.log('現在の設定: ' + check.getContentText());
  } else {
    Logger.log('❌ 設定失敗 (' + code + '): ' + res.getContentText());
  }
}

// 現場名を正規化（重複チェック用）: スペース除去・全角半角統一・法人格除去
function normalizeSiteNameForDedup_(name) {
  return String(name || "")
    .replace(/\s/g, "")
    .replace(/[ａ-ｚＡ-Ｚ０-９]/g, function(c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/株式会社|有限会社|合同会社|（株）|\(株\)/g, "")
    .toLowerCase();
}
