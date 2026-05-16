// ============================================================
// Code_billing_team.gs — 経理業務完全自動化チーム型エージェント
// マルケン電工 hyperauto プロジェクト
// ============================================================
// エージェント構成:
//   F-01: InvoiceTeam          — 請求書自動生成・送付チーム
//   F-02: PaymentTrackerTeam   — 入金確認・未払いフォローチーム
//   F-03: ExpenseTeam          — 経費精算サポートチーム
//   F-04: MonthlySummaryTeam   — 月次報告チーム
//
// スクリプトプロパティ:
//   SHEET_ID          — 案件管理スプレッドシートID
//   EXISTING_SHEET_ID — 既存顧客スプレッドシートID
//   JECA_SHEET_ID     — JECA CRM スプレッドシートID
//   BANK_INFO         — 振込先情報（三菱UFJ銀行 ○○支店 普通 1234567）
//   CLAUDE_API_KEY    — Claude API キー
//   XAI_API_KEY       — Grok API キー
//   LINE_CHANNEL_ACCESS_TOKEN
//   LINE_USER_IDS
// ============================================================

const BILLING_AGENT_ID = 'BILLING_TEAM';

// 案件シートの列定義（案件管理シートの列構成）
// A:案件ID B:顧客名 C:顧客メール D:顧客電話 E:顧客住所
// F:工事内容 G:工事金額 H:着工日 I:完了日
// J:請求送付日 K:入金確認日 L:入金額 M:ステータス
// N:担当者 O:備考
const COL = {
  JOB_ID: 1,          // A: 案件ID
  CUSTOMER: 2,        // B: 顧客名
  EMAIL: 3,           // C: 顧客メール
  PHONE: 4,           // D: 顧客電話
  ADDRESS: 5,         // E: 顧客住所
  WORK_CONTENT: 6,    // F: 工事内容
  AMOUNT: 7,          // G: 工事金額（税抜）
  START_DATE: 8,      // H: 着工日
  COMPLETE_DATE: 9,   // I: 完了日
  INVOICE_DATE: 10,   // J: 請求送付日
  PAYMENT_DATE: 11,   // K: 入金確認日
  PAYMENT_AMOUNT: 12, // L: 入金額
  STATUS: 13,         // M: ステータス
  STAFF: 14,          // N: 担当者
  MEMO: 15,           // O: 備考
};

// 経費シートの列定義
const EXP_COL = {
  DATE: 1,        // A: 日付
  AMOUNT: 2,      // B: 金額
  PURPOSE: 3,     // C: 用途
  CATEGORY: 4,    // D: 勘定科目
  DETAIL: 5,      // E: 詳細
  STAFF: 6,       // F: 担当者
  REGISTERED_AT: 7, // G: 登録日時
};


// ============================================================
// F-01: InvoiceTeam（請求書自動生成・送付チーム）
// ============================================================

/**
 * F-01-A: 完了かつ請求未送付の案件を検出
 * @returns {Array} - 対象案件の配列
 */
function f01_completionScanner() {
  agentLog('F-01-A', 'START', '完了・未請求案件スキャン');

  const sheet = getSheet('SHEET_ID', '案件管理');
  if (!sheet) {
    agentLog('F-01-A', 'ERROR', 'SHEET_ID 未設定またはシート取得失敗');
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    agentLog('F-01-A', 'INFO', 'データなし');
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const targets = [];

  data.forEach((row, idx) => {
    const status = row[COL.STATUS - 1];
    const completeDate = row[COL.COMPLETE_DATE - 1];
    const invoiceDate = row[COL.INVOICE_DATE - 1];
    const email = row[COL.EMAIL - 1];
    const amount = row[COL.AMOUNT - 1];

    // 完了済み・請求未送付・メールあり・金額あり
    if (
      (status === '完了' || status === '工事完了') &&
      completeDate &&
      !invoiceDate &&
      email &&
      amount > 0
    ) {
      targets.push({
        rowIndex: idx + 2,
        jobId: row[COL.JOB_ID - 1],
        customer: row[COL.CUSTOMER - 1],
        email: email,
        phone: row[COL.PHONE - 1],
        address: row[COL.ADDRESS - 1],
        workContent: row[COL.WORK_CONTENT - 1],
        amount: amount,
        startDate: row[COL.START_DATE - 1],
        completeDate: completeDate,
        staff: row[COL.STAFF - 1],
        memo: row[COL.MEMO - 1],
      });
    }
  });

  agentLog('F-01-A', 'OK', `対象案件: ${targets.length}件`);
  return targets;
}

/**
 * F-01-B: 請求書データを組み立て
 * @param {object} job - 案件データ
 * @returns {object} - 請求書データ（顧客/工事内容/金額/振込先）
 */
function f01_invoiceBuilder(job) {
  agentLog('F-01-B', 'START', `請求書組立: ${job.customer} / ${job.jobId}`);

  const bankInfo = getProp('BANK_INFO') || '三菱UFJ銀行 ○○支店 普通 1234567';
  const taxRate = 0.1;
  const amountExTax = Number(job.amount);
  const taxAmount = Math.floor(amountExTax * taxRate);
  const totalAmount = amountExTax + taxAmount;

  // 支払期限: 請求日から30日後
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = Utilities.formatDate(dueDate, 'Asia/Tokyo', 'yyyy年MM月dd日');

  const invoice = {
    invoiceNo: `INV-${job.jobId || Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
    issueDate: today(),
    dueDate: dueDateStr,
    customer: job.customer,
    email: job.email,
    address: job.address || '住所不明',
    workContent: job.workContent,
    startDate: job.startDate ? Utilities.formatDate(new Date(job.startDate), 'Asia/Tokyo', 'yyyy年MM月dd日') : '不明',
    completeDate: Utilities.formatDate(new Date(job.completeDate), 'Asia/Tokyo', 'yyyy年MM月dd日'),
    amountExTax: amountExTax,
    taxAmount: taxAmount,
    totalAmount: totalAmount,
    bankInfo: bankInfo,
    staff: job.staff || '担当者',
    rowIndex: job.rowIndex,
    jobId: job.jobId,
  };

  agentLog('F-01-B', 'OK', `請求書No: ${invoice.invoiceNo} / 合計: ¥${totalAmount.toLocaleString()}`);
  return invoice;
}

/**
 * F-01-C: 請求書本文を生成（Claudeで丁寧な形式に整形）
 * @param {object} invoice - 請求書データ
 * @returns {string} - 請求書本文テキスト
 */
function f01_documentGenerator(invoice) {
  agentLog('F-01-C', 'START', `請求書本文生成: ${invoice.invoiceNo}`);

  // Claudeで丁寧な請求書テキストを生成
  const systemPrompt = `あなたは株式会社マルケン電工の経理担当です。
以下の情報をもとに、メール本文内に埋め込む請求書テキストを作成してください。

要件:
- 丁寧かつビジネスライクな文体
- 請求書番号・発行日・支払期限を明記
- 工事内容・金額を明確に記載（税抜・消費税・合計を分けて表示）
- 振込先情報を明記
- テキスト形式（HTMLなし）で返す`;

  const userPrompt = `請求書情報:
請求書番号: ${invoice.invoiceNo}
発行日: ${invoice.issueDate}
支払期限: ${invoice.dueDate}

請求先:
${invoice.customer} 御中
${invoice.address}

工事内容: ${invoice.workContent}
施工期間: ${invoice.startDate} 〜 ${invoice.completeDate}

金額:
工事代金（税抜）: ¥${invoice.amountExTax.toLocaleString()}
消費税（10%）: ¥${invoice.taxAmount.toLocaleString()}
合計: ¥${invoice.totalAmount.toLocaleString()}

振込先: ${invoice.bankInfo}
振込期限: ${invoice.dueDate}`;

  const docText = callClaude(systemPrompt, userPrompt);

  if (!docText) {
    // フォールバック: 手動テンプレート
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━
　　　　　ご 請 求 書
━━━━━━━━━━━━━━━━━━━━━━━━━━━
請求書番号: ${invoice.invoiceNo}
発 行 日: ${invoice.issueDate}
支払期限: ${invoice.dueDate}

請求先:
${invoice.customer} 御中

工事内容: ${invoice.workContent}
施工期間: ${invoice.startDate} 〜 ${invoice.completeDate}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
工事代金（税抜）  ¥${invoice.amountExTax.toLocaleString()}
消費税（10%）     ¥${invoice.taxAmount.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
ご請求金額 合計   ¥${invoice.totalAmount.toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━

【振込先】
${invoice.bankInfo}

振込期限: ${invoice.dueDate}
（振込手数料はご負担をお願いいたします）
`;
  }

  agentLog('F-01-C', 'OK', '請求書本文生成完了');
  return docText;
}

/**
 * F-01-D: 請求メール送信（Claude で丁寧な添え状を生成）
 * @param {object} invoice - 請求書データ（docTextを含む）
 * @returns {boolean}
 */
function f01_emailSender(invoice) {
  agentLog('F-01-D', 'START', `請求メール送信: ${invoice.customer}`);

  const systemPrompt = `あなたはマルケン電工の経理担当です。
工事完了後の請求書送付メールの冒頭文（添え状）を200文字以内で作成してください。
丁寧・簡潔・温かみのある文体で。テキストのみで返す。`;

  const userPrompt = `顧客名: ${invoice.customer}\n工事内容: ${invoice.workContent}\n工事完了日: ${invoice.completeDate}`;

  const coverText = callClaude(systemPrompt, userPrompt) ||
    `${invoice.customer} 様\n\nお世話になっております。\n株式会社マルケン電工でございます。\n\n先日ご依頼いただきました工事が完了いたしましたので、ご請求書をお送りいたします。\nご確認のほどよろしくお願い申し上げます。`;

  const subject = `【ご請求書】${invoice.workContent} / 株式会社マルケン電工`;
  const body = `${coverText}\n\n${invoice.docText}\n\nご不明な点がございましたら、お気軽にお問い合わせください。`;

  const sent = sendEmail(invoice.email, subject, body);

  agentLog('F-01-D', sent ? 'OK' : 'ERROR', `メール送信${sent ? '成功' : '失敗'}: ${invoice.customer}`);
  return sent;
}

/**
 * F-01-E: スプシに請求送付済みを記録
 * @param {object} invoice - 請求書データ（rowIndex含む）
 */
function f01_tracker(invoice) {
  agentLog('F-01-E', 'START', `請求記録: row${invoice.rowIndex}`);

  const sheet = getSheet('SHEET_ID', '案件管理');
  if (!sheet) return;

  // J列（請求送付日）を更新
  sheet.getRange(invoice.rowIndex, COL.INVOICE_DATE).setValue(today());
  // M列（ステータス）を更新
  sheet.getRange(invoice.rowIndex, COL.STATUS).setValue('請求済み');

  agentLog('F-01-E', 'OK', `請求送付日: ${today()} / ステータス→請求済み`);
}

/**
 * F-01 メイン: 請求書自動生成・送付（デイリーバッチ）
 */
function runInvoiceTeam() {
  agentLog(BILLING_AGENT_ID, 'START', 'F-01 InvoiceTeam 開始');

  try {
    // Step 1: 完了・未請求案件スキャン
    const jobs = f01_completionScanner();

    if (jobs.length === 0) {
      agentLog(BILLING_AGENT_ID, 'DONE', '対象案件なし');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const invoiceLog = [];

    jobs.forEach((job, idx) => {
      if (idx > 0) Utilities.sleep(1000);

      try {
        agentLog(BILLING_AGENT_ID, 'PROGRESS', `[${idx + 1}/${jobs.length}] ${job.customer}`);

        // Step 2: 請求書データ組立
        const invoice = f01_invoiceBuilder(job);

        // Step 3: 請求書本文生成
        invoice.docText = f01_documentGenerator(invoice);

        // Step 4: メール送信
        const sent = f01_emailSender(invoice);

        // Step 5: 送付記録
        if (sent) {
          f01_tracker(invoice);
          successCount++;
          invoiceLog.push(`✅ ${job.customer}: ¥${invoice.totalAmount.toLocaleString()}`);
        } else {
          failCount++;
          invoiceLog.push(`❌ ${job.customer}: 送信失敗`);
        }

      } catch (e) {
        agentLog(BILLING_AGENT_ID, 'ERROR', `${job.customer} 処理エラー: ${e}`);
        failCount++;
        invoiceLog.push(`❌ ${job.customer}: エラー`);
      }
    });

    // LINE通知
    const lineMsg = `【請求書自動送付】\n✅ 送付完了: ${successCount}件\n❌ 失敗: ${failCount}件\n\n${invoiceLog.join('\n')}`;
    sendLineToManager(lineMsg);

    agentLog(BILLING_AGENT_ID, 'DONE', `F-01完了 | 送付${successCount}件 / 失敗${failCount}件`);

  } catch (e) {
    agentLog(BILLING_AGENT_ID, 'ERROR', 'F-01 例外: ' + e);
    sendLineToManager(`【請求書チーム】エラー発生:\n${e}`);
  }
}


// ============================================================
// F-02: PaymentTrackerTeam（入金確認・未払いフォローチーム）
// ============================================================

/**
 * F-02-A: 請求送付から14日以上経過・未入金を検出
 * @returns {Array} - 未入金案件（経過日数付き）
 */
function f02_overdueScanner() {
  agentLog('F-02-A', 'START', '未入金・期限超過スキャン');

  const sheet = getSheet('SHEET_ID', '案件管理');
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  const overdue = [];
  const today_ = new Date();

  data.forEach((row, idx) => {
    const status = row[COL.STATUS - 1];
    const invoiceDate = row[COL.INVOICE_DATE - 1];
    const paymentDate = row[COL.PAYMENT_DATE - 1];
    const email = row[COL.EMAIL - 1];

    // 請求済み・未入金・メールあり
    if (
      (status === '請求済み' || status === '未入金') &&
      invoiceDate &&
      !paymentDate &&
      email
    ) {
      const invoiceDateObj = new Date(invoiceDate);
      const elapsedDays = Math.floor((today_ - invoiceDateObj) / 86400000);

      // 14日以上経過のみ対象
      if (elapsedDays >= 14) {
        overdue.push({
          rowIndex: idx + 2,
          jobId: row[COL.JOB_ID - 1],
          customer: row[COL.CUSTOMER - 1],
          email: email,
          phone: row[COL.PHONE - 1],
          workContent: row[COL.WORK_CONTENT - 1],
          amount: row[COL.AMOUNT - 1],
          invoiceDate: invoiceDate,
          elapsedDays: elapsedDays,
          memo: row[COL.MEMO - 1],
        });
      }
    }
  });

  // 経過日数で降順ソート（長い順）
  overdue.sort((a, b) => b.elapsedDays - a.elapsedDays);

  agentLog('F-02-A', 'OK', `未入金超過: ${overdue.length}件`);
  return overdue;
}

/**
 * F-02-B: 未払いリマインダーメール生成（Claude・丁寧に）
 * @param {object} job - 未入金案件データ
 * @returns {object} - {subject, body}
 */
function f02_reminderComposer(job) {
  agentLog('F-02-B', 'START', `リマインダー生成: ${job.customer} / ${job.elapsedDays}日経過`);

  const taxRate = 0.1;
  const amountExTax = Number(job.amount);
  const totalAmount = Math.floor(amountExTax * (1 + taxRate));
  const bankInfo = getProp('BANK_INFO') || '三菱UFJ銀行 ○○支店 普通 1234567';

  const urgencyLevel = job.elapsedDays >= 30 ? '最終' : (job.elapsedDays >= 21 ? '第二' : '第一');

  const systemPrompt = `あなたはマルケン電工の経理担当です。
未払い請求のリマインダーメールを作成してください。

要件:
- ${urgencyLevel}リマインダー（${job.elapsedDays}日経過）
- 丁寧かつ明確に。催促感を出しすぎない（第一・第二）、30日超は明確に
- 支払いへの協力依頼を明示
- JSONで返す

返すJSON形式:
{
  "subject": "件名",
  "body": "本文（署名なし）"
}`;

  const userPrompt = `顧客: ${job.customer} 様
工事内容: ${job.workContent}
請求送付日: ${Utilities.formatDate(new Date(job.invoiceDate), 'Asia/Tokyo', 'yyyy年MM月dd日')}
経過日数: ${job.elapsedDays}日
請求金額: ¥${totalAmount.toLocaleString()}（税込）
振込先: ${bankInfo}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    return {
      subject: `【${urgencyLevel}ご連絡】お支払いのご確認 / 株式会社マルケン電工`,
      body: `${job.customer} 様\n\nお世話になっております。マルケン電工でございます。\n\n先日ご送付いたしました請求書（工事内容: ${job.workContent}）についてご確認いただけましたでしょうか。\n\n請求金額: ¥${totalAmount.toLocaleString()}（税込）\n振込先: ${bankInfo}\n\nご多忙の折、誠に恐れ入りますが、お支払いのご手配をいただけますようお願い申し上げます。`,
    };
  }

  agentLog('F-02-B', 'OK', `${urgencyLevel}リマインダー生成完了`);
  return result;
}

/**
 * F-02-C: 30日超過でLINE緊急通知
 * @param {object} job - 案件データ
 */
function f02_escalationChecker(job) {
  if (job.elapsedDays < 30) return;

  agentLog('F-02-C', 'WARN', `エスカレーション: ${job.customer} / ${job.elapsedDays}日未入金`);

  const taxRate = 0.1;
  const totalAmount = Math.floor(Number(job.amount) * (1 + taxRate));

  const lineMsg = `⚠️【緊急】未入金アラート\n${job.customer}\n工事: ${job.workContent}\n金額: ¥${totalAmount.toLocaleString()}\n経過: ${job.elapsedDays}日\n\n早急にご確認ください。`;

  sendLineToManager(lineMsg, [
    lineQR('📞 電話する', `call_${job.customer}`),
    lineQR('📧 メール確認', `check_email_${job.jobId}`),
  ]);
}

/**
 * F-02-D: リマインダー下書き作成
 * @param {object} job - 案件データ
 * @param {object} email - {subject, body}
 * @returns {boolean}
 */
function f02_draftCreator(job, email) {
  agentLog('F-02-D', 'START', `リマインダー下書き: ${job.customer}`);

  const drafted = createDraft(job.email, email.subject, email.body);

  if (drafted) {
    // ステータス更新
    const sheet = getSheet('SHEET_ID', '案件管理');
    if (sheet) {
      sheet.getRange(job.rowIndex, COL.STATUS).setValue('未入金・リマインダー送信済み');
      sheet.getRange(job.rowIndex, COL.MEMO).setValue(
        (job.memo ? job.memo + ' | ' : '') + `リマインダー下書き作成: ${today()}（${job.elapsedDays}日経過）`
      );
    }
  }

  agentLog('F-02-D', drafted ? 'OK' : 'ERROR', `下書き${drafted ? '作成成功' : '作成失敗'}`);
  return drafted;
}

/**
 * F-02 メイン: 入金確認・未払いフォロー（デイリーバッチ）
 */
function runPaymentTrackerTeam() {
  agentLog(BILLING_AGENT_ID, 'START', 'F-02 PaymentTrackerTeam 開始');

  try {
    // Step 1: 期限超過スキャン
    const overdueJobs = f02_overdueScanner();

    if (overdueJobs.length === 0) {
      agentLog(BILLING_AGENT_ID, 'DONE', '未払い超過案件なし');
      return;
    }

    let draftCount = 0;
    let escalationCount = 0;
    const logLines = [];

    overdueJobs.forEach((job, idx) => {
      if (idx > 0) Utilities.sleep(1000);

      try {
        agentLog(BILLING_AGENT_ID, 'PROGRESS', `[${idx + 1}/${overdueJobs.length}] ${job.customer} (${job.elapsedDays}日)`);

        // Step 2: リマインダー生成
        const email = f02_reminderComposer(job);

        // Step 3: エスカレーション確認（30日超）
        f02_escalationChecker(job);
        if (job.elapsedDays >= 30) escalationCount++;

        // Step 4: 下書き作成
        const drafted = f02_draftCreator(job, email);
        if (drafted) draftCount++;

        const taxTotal = Math.floor(Number(job.amount) * 1.1);
        logLines.push(`${job.elapsedDays >= 30 ? '🔴' : '🟡'} ${job.customer}: ${job.elapsedDays}日 / ¥${taxTotal.toLocaleString()}`);

      } catch (e) {
        agentLog(BILLING_AGENT_ID, 'ERROR', `${job.customer} 処理エラー: ${e}`);
        logLines.push(`❌ ${job.customer}: エラー`);
      }
    });

    // LINE通知
    const lineMsg = `【未払いフォロー】\n対象: ${overdueJobs.length}件\n下書き作成: ${draftCount}件\n30日超過: ${escalationCount}件\n\n${logLines.join('\n')}`;
    sendLineToManager(lineMsg);

    agentLog(BILLING_AGENT_ID, 'DONE', `F-02完了 | 下書き${draftCount}件 / エスカレーション${escalationCount}件`);

  } catch (e) {
    agentLog(BILLING_AGENT_ID, 'ERROR', 'F-02 例外: ' + e);
    sendLineToManager(`【未払いフォロー】エラー:\n${e}`);
  }
}


// ============================================================
// F-03: ExpenseTeam（経費精算サポートチーム）
// ============================================================

/**
 * F-03-A: テキストから金額/日付/用途を抽出（Grok）
 * @param {string} rawText - 経費テキスト（手入力・レシートOCR等）
 * @returns {object} - {amount, date, purpose, detail, staff}
 */
function f03_expenseParser(rawText) {
  agentLog('F-03-A', 'START', '経費テキスト解析: ' + rawText.substring(0, 50));

  const systemPrompt = `あなたは日本の経費精算システムのAIです。
与えられたテキストから経費情報をJSONで抽出してください。
日付が不明な場合は今日の日付を使ってください。

返すJSON形式:
{
  "amount": 金額（数値・円・税込）,
  "date": "日付（yyyy/MM/dd形式）",
  "purpose": "用途・目的（簡潔に）",
  "detail": "詳細説明",
  "staff": "担当者名（不明なら空文字）"
}`;

  const userPrompt = `今日の日付: ${today()}\n\n経費テキスト:\n${rawText}`;

  const result = callGrokJSON(systemPrompt, userPrompt);

  if (!result) {
    agentLog('F-03-A', 'WARN', '解析失敗、手動確認が必要');
    return { amount: 0, date: today(), purpose: '手動確認必要', detail: rawText, staff: '' };
  }

  agentLog('F-03-A', 'OK', `解析完了: ¥${result.amount} / ${result.purpose}`);
  return result;
}

/**
 * F-03-B: 勘定科目分類
 * @param {object} expense - {amount, date, purpose, detail}
 * @returns {object} - {category, categoryCode, taxType}
 */
function f03_categoryClassifier(expense) {
  agentLog('F-03-B', 'START', `勘定科目分類: ${expense.purpose}`);

  // 勘定科目マスタ
  const categoryRules = [
    { keywords: ['電車', '地下鉄', 'バス', 'タクシー', '交通', '新幹線', '飛行機', '高速', 'ETC'], category: '交通費', code: '6210' },
    { keywords: ['材料', '部品', '電線', 'コンセント', 'スイッチ', '資材', '工具', '消耗品'], category: '材料費', code: '5100' },
    { keywords: ['食事', '飲食', '接待', '会食', '弁当', 'ランチ', 'コーヒー'], category: '接待交際費', code: '6510' },
    { keywords: ['宿泊', 'ホテル', '旅館', '出張'], category: '旅費交通費', code: '6220' },
    { keywords: ['通信', '電話', '携帯', 'インターネット', 'スマホ'], category: '通信費', code: '6310' },
    { keywords: ['コピー', '印刷', '文具', '事務用品', 'ペン', '紙'], category: '事務用品費', code: '6410' },
    { keywords: ['駐車', '駐車場', '月極'], category: '車両費', code: '6610' },
    { keywords: ['図書', '書籍', '雑誌', '新聞'], category: '新聞図書費', code: '6710' },
    { keywords: ['研修', 'セミナー', '講習', '資格'], category: '教育研修費', code: '6810' },
    { keywords: ['保険', '損保'], category: '損害保険料', code: '6910' },
  ];

  const text = (expense.purpose + ' ' + expense.detail).toLowerCase();
  let matched = null;

  for (const rule of categoryRules) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      matched = rule;
      break;
    }
  }

  if (!matched) {
    // Grokで分類
    const systemPrompt = `日本の会社の経費精算で使う勘定科目を分類してください。
選択肢: 交通費/材料費/接待交際費/旅費交通費/通信費/事務用品費/車両費/新聞図書費/教育研修費/雑費
JSONで返す: {"category": "勘定科目名", "code": "4桁コード（6000番台）", "reason": "理由"}`;

    const result = callGrokJSON(systemPrompt, `用途: ${expense.purpose}\n詳細: ${expense.detail}\n金額: ¥${expense.amount}`);

    if (result) {
      agentLog('F-03-B', 'OK', `Grok分類: ${result.category}`);
      return { category: result.category, categoryCode: result.code || '6999', taxType: '課税' };
    }

    agentLog('F-03-B', 'WARN', '分類失敗→雑費');
    return { category: '雑費', categoryCode: '6999', taxType: '課税' };
  }

  agentLog('F-03-B', 'OK', `ルール分類: ${matched.category}`);
  return { category: matched.category, categoryCode: matched.code, taxType: '課税' };
}

/**
 * F-03-C: 経費シートに記録
 * @param {object} expense - 経費データ（parsed + classified）
 * @returns {boolean}
 */
function f03_sheetWriter(expense) {
  agentLog('F-03-C', 'START', `経費シート記録: ${expense.category} / ¥${expense.amount}`);

  const sheet = getSheet('SHEET_ID', '経費管理');
  if (!sheet) {
    agentLog('F-03-C', 'ERROR', '経費管理シート取得失敗');
    return false;
  }

  // ヘッダー初期化
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日付', '金額', '用途', '勘定科目', '詳細', '担当者', '登録日時']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#2e7d32').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  const row = [
    expense.date || today(),
    expense.amount || 0,
    expense.purpose || '',
    expense.category || '雑費',
    expense.detail || '',
    expense.staff || '',
    nowStr(),
  ];

  const ok = appendRow(sheet, row);
  agentLog('F-03-C', ok ? 'OK' : 'ERROR', `記録${ok ? '成功' : '失敗'}: ${expense.category} ¥${expense.amount}`);
  return ok;
}

/**
 * F-03 メイン: テキストから経費登録
 * @param {string} rawText - 経費テキスト
 * @returns {object} - 登録結果
 */
function runExpenseTeam(rawText) {
  agentLog(BILLING_AGENT_ID, 'START', 'F-03 ExpenseTeam 開始');

  if (!rawText) {
    Logger.log('❌ 経費テキストが指定されていません');
    return { success: false, error: 'テキストなし' };
  }

  try {
    // Step 1: テキスト解析
    const parsed = f03_expenseParser(rawText);

    // Step 2: 勘定科目分類
    const classified = f03_categoryClassifier(parsed);

    // データ統合
    const expense = { ...parsed, ...classified };

    // Step 3: シート記録
    const written = f03_sheetWriter(expense);

    const result = {
      success: written,
      date: expense.date,
      amount: expense.amount,
      purpose: expense.purpose,
      category: expense.category,
    };

    if (written) {
      agentLog(BILLING_AGENT_ID, 'DONE', `F-03完了 | ${expense.category} / ¥${expense.amount}`);
    }

    return result;

  } catch (e) {
    agentLog(BILLING_AGENT_ID, 'ERROR', 'F-03 例外: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * F-03 LINE連携: LINEからの経費入力をトリガーとして処理
 * @param {string} lineMessage - LINEから受信した経費テキスト
 */
function runExpenseFromLine(lineMessage) {
  const result = runExpenseTeam(lineMessage);

  const reply = result.success
    ? `✅ 経費登録完了\n日付: ${result.date}\n金額: ¥${Number(result.amount).toLocaleString()}\n用途: ${result.purpose}\n勘定科目: ${result.category}`
    : `❌ 経費登録失敗\n${result.error || '入力内容を確認してください'}`;

  sendLineToManager(reply);
}


// ============================================================
// F-04: MonthlySummaryTeam（月次報告チーム）
// ============================================================

/**
 * F-04-A: 案件スプシから月次データ集計
 * @param {string} month - 対象月（'yyyy/MM'形式、省略時は先月）
 * @returns {object} - 集計データ
 */
function f04_dataAggregator(month) {
  agentLog('F-04-A', 'START', `月次データ集計: ${month}`);

  const sheet = getSheet('SHEET_ID', '案件管理');
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { jobs: [], month: month };

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();

  // 対象月のフィルタリング
  const targetYM = month.replace('/', '');

  const jobs = data.filter(row => {
    const completeDate = row[COL.COMPLETE_DATE - 1];
    if (!completeDate) return false;
    const completeDateStr = Utilities.formatDate(new Date(completeDate), 'Asia/Tokyo', 'yyyyMM');
    return completeDateStr === targetYM;
  }).map(row => ({
    jobId: row[COL.JOB_ID - 1],
    customer: row[COL.CUSTOMER - 1],
    workContent: row[COL.WORK_CONTENT - 1],
    amount: Number(row[COL.AMOUNT - 1]) || 0,
    completeDate: row[COL.COMPLETE_DATE - 1],
    invoiceDate: row[COL.INVOICE_DATE - 1],
    paymentDate: row[COL.PAYMENT_DATE - 1],
    paymentAmount: Number(row[COL.PAYMENT_AMOUNT - 1]) || 0,
    status: row[COL.STATUS - 1],
    staff: row[COL.STAFF - 1],
  }));

  // 経費データも集計
  const expenseSheet = getSheet('SHEET_ID', '経費管理');
  let monthlyExpenses = [];

  if (expenseSheet && expenseSheet.getLastRow() > 1) {
    const expData = expenseSheet.getRange(2, 1, expenseSheet.getLastRow() - 1, 7).getValues();
    monthlyExpenses = expData.filter(row => {
      const date = row[0];
      if (!date) return false;
      const dateStr = Utilities.formatDate(new Date(date), 'Asia/Tokyo', 'yyyyMM');
      return dateStr === targetYM;
    }).map(row => ({
      date: row[0],
      amount: Number(row[1]) || 0,
      purpose: row[2],
      category: row[3],
    }));
  }

  agentLog('F-04-A', 'OK', `案件: ${jobs.length}件 / 経費: ${monthlyExpenses.length}件`);
  return { jobs, expenses: monthlyExpenses, month };
}

/**
 * F-04-B: KPI算出
 * @param {object} data - 集計データ（jobs, expenses）
 * @returns {object} - KPI
 */
function f04_kpiCalculator(data) {
  agentLog('F-04-B', 'START', `KPI算出: ${data.month}`);

  const jobs = data.jobs || [];
  const expenses = data.expenses || [];

  // 売上集計
  const totalSalesExTax = jobs.reduce((sum, j) => sum + j.amount, 0);
  const totalSalesTax = Math.floor(totalSalesExTax * 0.1);
  const totalSalesInclTax = totalSalesExTax + totalSalesTax;

  // 入金集計
  const paidJobs = jobs.filter(j => j.paymentDate);
  const totalReceived = jobs.reduce((sum, j) => sum + (j.paymentAmount || 0), 0);
  const unpaidCount = jobs.filter(j => j.invoiceDate && !j.paymentDate).length;

  // 平均単価
  const avgAmount = jobs.length > 0 ? Math.floor(totalSalesExTax / jobs.length) : 0;

  // 回収率
  const collectionRate = totalSalesExTax > 0
    ? Math.round((totalReceived / totalSalesInclTax) * 100)
    : 0;

  // 経費合計
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  // 粗利（売上税抜 - 経費）
  const grossProfit = totalSalesExTax - totalExpenses;
  const grossProfitRate = totalSalesExTax > 0
    ? Math.round((grossProfit / totalSalesExTax) * 100)
    : 0;

  // カテゴリ別経費
  const expenseByCategory = {};
  expenses.forEach(e => {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
  });

  const kpi = {
    month: data.month,
    jobCount: jobs.length,
    totalSalesExTax,
    totalSalesInclTax,
    avgAmount,
    paidCount: paidJobs.length,
    unpaidCount,
    totalReceived,
    collectionRate,
    totalExpenses,
    grossProfit,
    grossProfitRate,
    expenseByCategory,
  };

  agentLog('F-04-B', 'OK', `売上: ¥${totalSalesExTax.toLocaleString()} / 案件数: ${jobs.length} / 回収率: ${collectionRate}%`);
  return kpi;
}

/**
 * F-04-C: 月次サマリー文章生成（Claude）
 * @param {object} kpi - KPI データ
 * @returns {string} - サマリー文章
 */
function f04_summaryComposer(kpi) {
  agentLog('F-04-C', 'START', `サマリー生成: ${kpi.month}`);

  const systemPrompt = `あなたはマルケン電工の経営アドバイザーです。
月次KPIデータをもとに、社長向けの月次報告サマリーを作成してください。

要件:
- LINE送信前提のため、500文字以内
- 数値は必ず記載
- 前向きな評価 + 改善提案（1点）
- 絵文字を適度に使用
- テキスト形式で返す`;

  const expCategoryText = Object.entries(kpi.expenseByCategory)
    .map(([cat, amt]) => `  ${cat}: ¥${amt.toLocaleString()}`)
    .join('\n');

  const userPrompt = `対象月: ${kpi.month}

売上:
- 案件数: ${kpi.jobCount}件
- 売上（税抜）: ¥${kpi.totalSalesExTax.toLocaleString()}
- 売上（税込）: ¥${kpi.totalSalesInclTax.toLocaleString()}
- 平均単価: ¥${kpi.avgAmount.toLocaleString()}

回収:
- 入金済み: ${kpi.paidCount}件（¥${kpi.totalReceived.toLocaleString()}）
- 未入金: ${kpi.unpaidCount}件
- 回収率: ${kpi.collectionRate}%

経費:
- 経費合計: ¥${kpi.totalExpenses.toLocaleString()}
- 粗利: ¥${kpi.grossProfit.toLocaleString()}（粗利率: ${kpi.grossProfitRate}%）
${expCategoryText ? '内訳:\n' + expCategoryText : ''}

${MARUKEN_PROFILE}`;

  const summary = callClaude(systemPrompt, userPrompt);

  if (!summary) {
    return `【${kpi.month} 月次報告】\n案件数: ${kpi.jobCount}件\n売上（税込）: ¥${kpi.totalSalesInclTax.toLocaleString()}\n平均単価: ¥${kpi.avgAmount.toLocaleString()}\n回収率: ${kpi.collectionRate}%\n未入金: ${kpi.unpaidCount}件\n経費: ¥${kpi.totalExpenses.toLocaleString()}\n粗利率: ${kpi.grossProfitRate}%`;
  }

  agentLog('F-04-C', 'OK', 'サマリー生成完了');
  return summary;
}

/**
 * F-04-D: LINEに月次報告送信
 * @param {string} summary - サマリー文章
 * @param {object} kpi - KPI（ボタン用）
 */
function f04_lineNotifier(summary, kpi) {
  agentLog('F-04-D', 'START', `LINE月次報告送信: ${kpi.month}`);

  const qr = [
    lineQR('📊 詳細確認', `view_monthly_${kpi.month}`),
    lineQR('💰 未入金確認', 'check_unpaid'),
  ];

  const sent = sendLineToManager(summary, qr);
  agentLog('F-04-D', sent ? 'OK' : 'ERROR', 'LINE送信' + (sent ? '成功' : '失敗'));
}

/**
 * F-04 メイン: 月次報告自動実行
 * @param {string} month - 対象月（'yyyy/MM'形式、省略時は先月を自動判定）
 */
function runMonthlySummary(month) {
  agentLog(BILLING_AGENT_ID, 'START', 'F-04 MonthlySummaryTeam 開始');

  // 対象月の自動判定（省略時は先月）
  if (!month) {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    month = Utilities.formatDate(lastMonth, 'Asia/Tokyo', 'yyyy/MM');
  }

  agentLog(BILLING_AGENT_ID, 'INFO', `対象月: ${month}`);

  try {
    // Step 1: データ集計
    const data = f04_dataAggregator(month);

    if (!data || data.jobs.length === 0) {
      const msg = `【${month} 月次報告】\n対象データがありません。`;
      sendLineToManager(msg);
      agentLog(BILLING_AGENT_ID, 'DONE', 'データなし');
      return;
    }

    // Step 2: KPI算出
    const kpi = f04_kpiCalculator(data);

    // Step 3: サマリー生成
    const summary = f04_summaryComposer(kpi);

    // Step 4: LINE送信
    f04_lineNotifier(summary, kpi);

    agentLog(BILLING_AGENT_ID, 'DONE', `F-04完了 | ${month} | 売上¥${kpi.totalSalesExTax.toLocaleString()}`);

  } catch (e) {
    agentLog(BILLING_AGENT_ID, 'ERROR', 'F-04 例外: ' + e);
    sendLineToManager(`【月次報告】エラー発生:\n${e}`);
  }
}


// ============================================================
// デイリーバッチ・スケジューラー
// ============================================================

/**
 * デイリーバッチ: 毎朝実行（トリガー設定推奨: 毎日09:00）
 * - F-01: 請求書自動送付
 * - F-02: 未払いフォロー
 */
function runDailyBillingBatch() {
  agentLog(BILLING_AGENT_ID, 'START', `デイリーバッチ開始: ${nowStr()}`);

  try {
    // F-01: 請求書送付
    runInvoiceTeam();
    Utilities.sleep(2000);

    // F-02: 未払いフォロー
    runPaymentTrackerTeam();

    agentLog(BILLING_AGENT_ID, 'DONE', 'デイリーバッチ完了');

  } catch (e) {
    agentLog(BILLING_AGENT_ID, 'ERROR', 'デイリーバッチ例外: ' + e);
    sendLineToManager(`【経理バッチ】エラー:\n${e}`);
  }
}

/**
 * 月初バッチ: 毎月1日実行（トリガー設定推奨: 毎月1日09:00）
 * - F-04: 前月の月次報告
 */
function runMonthlyBatch() {
  agentLog(BILLING_AGENT_ID, 'START', `月初バッチ開始: ${nowStr()}`);
  runMonthlySummary(); // monthを省略→先月を自動判定
  agentLog(BILLING_AGENT_ID, 'DONE', '月初バッチ完了');
}


// ============================================================
// 入金確認手動登録（手動トリガー用）
// ============================================================

/**
 * 入金確認を手動で記録する
 * @param {string} jobId - 案件ID
 * @param {number} paidAmount - 入金額
 */
function recordPayment(jobId, paidAmount) {
  agentLog(BILLING_AGENT_ID, 'START', `入金記録: ${jobId} / ¥${paidAmount}`);

  const sheet = getSheet('SHEET_ID', '案件管理');
  if (!sheet) return false;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 15).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][COL.JOB_ID - 1]) === String(jobId)) {
      const rowIndex = i + 2;
      sheet.getRange(rowIndex, COL.PAYMENT_DATE).setValue(today());
      sheet.getRange(rowIndex, COL.PAYMENT_AMOUNT).setValue(paidAmount);
      sheet.getRange(rowIndex, COL.STATUS).setValue('入金確認済み');

      agentLog(BILLING_AGENT_ID, 'OK', `入金記録完了: ${jobId} / ¥${paidAmount}`);
      sendLineToManager(`✅ 入金確認記録\n案件ID: ${jobId}\n入金額: ¥${Number(paidAmount).toLocaleString()}\n確認日: ${today()}`);
      return true;
    }
  }

  agentLog(BILLING_AGENT_ID, 'WARN', `案件ID未発見: ${jobId}`);
  return false;
}


// ============================================================
// テスト・デバッグ関数
// ============================================================

/**
 * テスト: 経費登録
 */
function testExpenseTeam() {
  Logger.log('=== F-03 経費登録テスト ===');
  const sampleText = `2026/05/11 タクシー代 3,500円 名古屋駅→現場（天白区）`;
  const result = runExpenseTeam(sampleText);
  Logger.log('結果: ' + JSON.stringify(result, null, 2));
}

/**
 * テスト: 月次報告
 */
function testMonthlySummary() {
  Logger.log('=== F-04 月次報告テスト ===');
  runMonthlySummary('2026/04');
}

/**
 * 経理チーム全体の設定確認
 */
function checkBillingSetup() {
  Logger.log('=== 経理チーム設定確認 ===');
  Logger.log('SHEET_ID: ' + (getProp('SHEET_ID') ? '✅' : '❌ 未設定'));
  Logger.log('BANK_INFO: ' + (getProp('BANK_INFO') ? '✅ ' + getProp('BANK_INFO') : '❌ 未設定'));
  Logger.log('CLAUDE_API_KEY: ' + (getProp('CLAUDE_API_KEY') ? '✅' : '❌ 未設定'));
  Logger.log('XAI_API_KEY: ' + (getProp('XAI_API_KEY') ? '✅' : '❌ 未設定'));
  Logger.log('LINE_CHANNEL_ACCESS_TOKEN: ' + (getProp('LINE_CHANNEL_ACCESS_TOKEN') ? '✅' : '❌ 未設定'));
  Logger.log('LINE_USER_IDS: ' + (getProp('LINE_USER_IDS') ? '✅' : '❌ 未設定'));

  // 案件シート確認
  const sheet = getSheet('SHEET_ID', '案件管理');
  Logger.log('案件管理シート: ' + (sheet ? `✅ (${sheet.getLastRow()}行)` : '❌ 取得失敗'));

  Logger.log('=== 確認完了 ===');
}
