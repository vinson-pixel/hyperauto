// ============================================================
// Code_jeca_team.gs — JECA FAIR 2026 対応 チーム型エージェント
// マルケン電工 hyperauto プロジェクト
// 展示会: 2026年5月29日（東京ビッグサイト）
// ============================================================
// エージェント構成:
//   J-01: CardRegistrationTeam — 名刺登録チーム
//   J-02: ThankYouEmailTeam   — 御礼メール一斉送信チーム
//   J-03: FollowUpCampaignTeam — 個別フォローアップキャンペーンチーム
//
// JECAシート列定義:
//   A:登録日 B:会社名 C:名前 D:役職 E:メール F:電話 G:住所
//   H:業界 I:企業規模 J:ニーズ K:スコア L:ランク M:会話メモ
//   N:御礼送信日 O:フォロー送信日 P:ステータス
// ============================================================

const JECA_AGENT_ID = 'JECA_TEAM';
const JECA_EVENT_NAME = 'JECA FAIR 2026';
const JECA_EVENT_DATE = '2026年5月29日';
const JECA_SHEET_NAME = 'JECA_CRM';

// ============================================================
// J-01: CardRegistrationTeam（名刺登録チーム）
// ============================================================

/**
 * J-01-A2: 名刺画像（base64）から情報を抽出
 * @param {string} base64Data - base64エンコードされた画像データ
 * @param {string} mimeType   - "image/jpeg" | "image/png" | "image/webp"
 * @returns {object} - {name, company, title, email, phone, address}
 */
function j01_cardImageParser(base64Data, mimeType) {
  agentLog('J-01-A2', 'START', '名刺画像解析（Drive OCR → Grok）');

  // Step1: Google Drive OCRでテキスト抽出（無料）
  const ocrText = ocrImageWithDrive(base64Data, mimeType || 'image/jpeg');
  if (!ocrText || ocrText.trim().length < 3) {
    throw new Error('OCRでテキストを読み取れませんでした。名刺がはっきり映っているか確認してください');
  }
  agentLog('J-01-A2', 'OCR', ocrText.substring(0, 100));

  // Step2: Grok-3-miniでJSON構造化（格安テキストモデル）
  const systemPrompt = `名刺のOCRテキストから情報を抽出してJSONで返してください。
情報がない場合は空文字列("")にしてください。
JSONのみで返答。余分なテキスト不要。

返すJSON形式:
{
  "name": "氏名（フルネーム）",
  "company": "会社名（正式名称）",
  "title": "役職",
  "email": "メールアドレス",
  "phone": "電話番号（代表または携帯を優先）",
  "address": "住所"
}`;

  const result = callGrokJSON(systemPrompt, 'OCRテキスト:\n' + ocrText, 'grok-3-mini');
  if (!result) throw new Error('Grokによるテキスト構造化に失敗しました');

  agentLog('J-01-A2', 'OK', `解析完了: ${result.company} / ${result.name}`);
  return result;
}

/**
 * extractCardFromImage — フォームから呼ぶエントリー関数（画像→抽出のみ）
 * @param {string} base64Data - base64画像
 * @param {string} mimeType   - MIMEタイプ
 * @returns {object} - {name, company, title, email, phone, address}
 */
function extractCardFromImage(base64Data, mimeType) {
  if (!base64Data) throw new Error('画像データが空です');
  // j01_cardImageParser内でエラーをthrowするのでtry-catchで詳細を伝播
  try {
    const result = j01_cardImageParser(base64Data, mimeType || 'image/jpeg');
    if (!result.company && !result.name && !result.email && !result.phone) {
      throw new Error('情報を抽出できませんでした。名刺がはっきり映っているか確認してください');
    }
    return result;
  } catch(e) {
    throw e;
  }
}

/**
 * J-01-A: 名刺テキストから基本情報を抽出
 * @param {string} rawText - 名刺OCRテキストまたは手入力テキスト
 * @returns {object} - {name, company, title, email, phone, address}
 */
function j01_cardParser(rawText) {
  agentLog('J-01-A', 'START', '名刺テキスト解析: ' + rawText.substring(0, 50));

  const systemPrompt = `あなたは名刺情報の解析エキスパートです。
与えられたテキストから以下の情報をJSONで抽出してください。
情報がない場合は空文字列("")にしてください。

返すJSON形式:
{
  "name": "氏名（フルネーム）",
  "company": "会社名（正式名称）",
  "title": "役職",
  "email": "メールアドレス",
  "phone": "電話番号（代表または携帯）",
  "address": "住所"
}`;

  const userPrompt = `以下の名刺テキストを解析してください:\n\n${rawText}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    agentLog('J-01-A', 'ERROR', '名刺解析失敗');
    return { name: '', company: '', title: '', email: '', phone: '', address: '' };
  }

  agentLog('J-01-A', 'OK', `解析完了: ${result.company} / ${result.name}`);
  return result;
}

/**
 * J-01-B: 業界・企業規模・決裁権を推定
 * @param {string} company - 会社名
 * @param {string} title - 役職
 * @returns {object} - {industry, companySize, decisionPower, industryDetail}
 */
function j01_industryClassifier(company, title) {
  agentLog('J-01-B', 'START', `業界分類: ${company} / ${title}`);

  const systemPrompt = `あなたは日本の企業情報分析の専門家です。
会社名と役職から以下の情報をJSONで推定してください。

返すJSON形式:
{
  "industry": "業界（建設/製造/不動産/商業施設/公共/医療/物流/その他）",
  "industryDetail": "より詳細な業種説明",
  "companySize": "企業規模（大企業/中堅企業/中小企業/小規模事業者）",
  "decisionPower": "決裁権（高/中/低）",
  "decisionReason": "決裁権判断の理由"
}`;

  const userPrompt = `会社名: ${company}\n役職: ${title}\n\n上記情報から業界・企業規模・決裁権を推定してください。`;

  const result = callGrokJSON(systemPrompt, userPrompt);

  if (!result) {
    agentLog('J-01-B', 'WARN', '業界分類失敗、デフォルト値使用');
    return { industry: 'その他', industryDetail: '不明', companySize: '不明', decisionPower: '低', decisionReason: '情報不足' };
  }

  agentLog('J-01-B', 'OK', `業界: ${result.industry} / 規模: ${result.companySize} / 決裁権: ${result.decisionPower}`);
  return result;
}

/**
 * J-01-C: 電気工事ニーズを推定
 * @param {object} companyInfo - {company, industry, industryDetail, companySize, title}
 * @returns {object} - {primaryNeed, secondaryNeeds, needsReason, urgency}
 */
function j01_needsEstimator(companyInfo) {
  agentLog('J-01-C', 'START', `ニーズ推定: ${companyInfo.company}`);

  const systemPrompt = `あなたはマルケン電工の営業戦略アドバイザーです。
マルケン電工の得意サービス:
${MARUKEN_SERVICES_LIST.join('\n')}

企業情報から電気工事ニーズをJSONで推定してください。

返すJSON形式:
{
  "primaryNeed": "最も可能性の高いニーズ（MARUKEN_SERVICES_LISTより選択）",
  "secondaryNeeds": ["2番目のニーズ", "3番目のニーズ"],
  "needsReason": "そのニーズを推定した根拠（2文以内）",
  "urgency": "緊急度（高/中/低）",
  "estimatedBudget": "推定発注規模（大:500万超/中:100-500万/小:100万未満）"
}`;

  const userPrompt = `企業情報:
会社名: ${companyInfo.company}
業界: ${companyInfo.industry}（${companyInfo.industryDetail}）
企業規模: ${companyInfo.companySize}
役職: ${companyInfo.title}

この企業の電気工事ニーズを推定してください。`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    agentLog('J-01-C', 'WARN', 'ニーズ推定失敗');
    return { primaryNeed: 'LED照明改修・省エネ工事', secondaryNeeds: [], needsReason: '推定不可', urgency: '低', estimatedBudget: '小' };
  }

  agentLog('J-01-C', 'OK', `主要ニーズ: ${result.primaryNeed} / 緊急度: ${result.urgency}`);
  return result;
}

/**
 * J-01-D: 優先度スコア算出とランク付け
 * @param {object} cardInfo - 名刺基本情報
 * @param {object} industryInfo - 業界・決裁権情報
 * @param {object} needs - ニーズ情報
 * @returns {object} - {score, rank, scoreBreakdown}
 */
function j01_leadScorer(cardInfo, industryInfo, needs) {
  agentLog('J-01-D', 'START', `スコア算出: ${cardInfo.company}`);

  let score = 0;
  const breakdown = {};

  // 決裁権スコア（0-30点）
  const decisionScore = { '高': 30, '中': 20, '低': 5 }[industryInfo.decisionPower] || 0;
  score += decisionScore;
  breakdown.decision = decisionScore;

  // 企業規模スコア（0-25点）
  const sizeScore = { '大企業': 25, '中堅企業': 20, '中小企業': 15, '小規模事業者': 5 }[industryInfo.companySize] || 10;
  score += sizeScore;
  breakdown.size = sizeScore;

  // ニーズ緊急度スコア（0-20点）
  const urgencyScore = { '高': 20, '中': 12, '低': 4 }[needs.urgency] || 4;
  score += urgencyScore;
  breakdown.urgency = urgencyScore;

  // 推定予算スコア（0-15点）
  const budgetScore = { '大:500万超': 15, '中:100-500万': 10, '小:100万未満': 3 }[needs.estimatedBudget] || 3;
  score += budgetScore;
  breakdown.budget = budgetScore;

  // 連絡先完備ボーナス（0-10点）
  const contactScore = (cardInfo.email ? 5 : 0) + (cardInfo.phone ? 5 : 0);
  score += contactScore;
  breakdown.contact = contactScore;

  // ランク決定
  let rank;
  if (score >= 70) rank = 'A';
  else if (score >= 45) rank = 'B';
  else rank = 'C';

  agentLog('J-01-D', 'OK', `スコア: ${score} / ランク: ${rank}`);
  return { score, rank, scoreBreakdown: breakdown };
}

/**
 * J-01-E: JECAシートへの書き込み
 * @param {object} all - {cardInfo, industryInfo, needs, scoring, meetingMemo}
 * @returns {boolean}
 */
function j01_crmWriter(all) {
  agentLog('J-01-E', 'START', `CRM書き込み: ${all.cardInfo.company}`);

  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet) {
    agentLog('J-01-E', 'ERROR', 'JECAシート取得失敗');
    return false;
  }

  // ヘッダー確認・初期化
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '登録日', '会社名', '名前', '役職', 'メール', '電話', '住所',
      '業界', '企業規模', 'ニーズ', 'スコア', 'ランク', '会話メモ',
      '御礼送信日', 'フォロー送信日', 'ステータス', 'リードタイプ'
    ]);
    sheet.getRange(1, 1, 1, 17).setFontWeight('bold').setBackground('#1a237e').setFontColor('#ffffff');
  }

  const needsText = [all.needs.primaryNeed, ...(all.needs.secondaryNeeds || [])].join(' / ');

  const row = [
    today(),                       // A: 登録日
    all.cardInfo.company || '',    // B: 会社名
    all.cardInfo.name || '',       // C: 名前
    all.cardInfo.title || '',      // D: 役職
    all.cardInfo.email || '',      // E: メール
    all.cardInfo.phone || '',      // F: 電話
    all.cardInfo.address || '',    // G: 住所
    all.industryInfo.industry || '',      // H: 業界
    all.industryInfo.companySize || '',   // I: 企業規模
    needsText,                     // J: ニーズ
    all.scoring.score || 0,        // K: スコア
    all.scoring.rank || 'C',       // L: ランク
    all.meetingMemo || '',         // M: 会話メモ
    '',                            // N: 御礼送信日
    '',                            // O: フォロー送信日
    '登録済み',                    // P: ステータス
    all.leadType || 'その他',      // Q: リードタイプ
  ];

  const ok = appendRow(sheet, row);

  // ランクに応じてセル色分け
  if (ok) {
    const lastRow = sheet.getLastRow();
    const rankCell = sheet.getRange(lastRow, 12);
    const rankColor = { 'A': '#c62828', 'B': '#e65100', 'C': '#1b5e20' }[all.scoring.rank] || '#424242';
    rankCell.setBackground(rankColor).setFontColor('#ffffff').setFontWeight('bold');
  }

  agentLog('J-01-E', ok ? 'OK' : 'ERROR', `書き込み${ok ? '成功' : '失敗'}: ランク${all.scoring.rank} / スコア${all.scoring.score}`);
  return ok;
}

/**
 * J-01 メイン: 単一名刺の登録処理
 * @param {string} rawCardText - 名刺テキスト（OCRまたは手入力）。base64Data指定時は無視される
 * @param {string} meetingMemo - 展示会での会話メモ
 * @param {string} leadType   - リードタイプ（元請け候補/下請け候補/その他/なし）
 * @param {string} base64Data - 名刺画像のbase64データ（省略可）
 * @param {string} mimeType   - 画像MIMEタイプ（省略時: image/jpeg）
 * @returns {object} - 登録結果サマリー
 */
function runCardRegistration(rawCardText, meetingMemo, leadType, base64Data, mimeType) {
  agentLog(JECA_AGENT_ID, 'START', 'J-01 CardRegistrationTeam 開始');

  try {
    // Step 1: 名刺情報取得（画像優先 → テキストフォールバック）
    let cardInfo;
    if (base64Data) {
      agentLog(JECA_AGENT_ID, 'INFO', '画像データあり → OCR+AI解析');
      cardInfo = extractCardFromImage(base64Data, mimeType || 'image/jpeg');
    } else {
      cardInfo = j01_cardParser(rawCardText);
    }

    // Step 2: 業界・決裁権分類
    const industryInfo = j01_industryClassifier(cardInfo.company, cardInfo.title);

    // Step 3: ニーズ推定
    const companyInfoForNeeds = {
      company: cardInfo.company,
      title: cardInfo.title,
      industry: industryInfo.industry,
      industryDetail: industryInfo.industryDetail,
      companySize: industryInfo.companySize,
    };
    const needs = j01_needsEstimator(companyInfoForNeeds);

    // Step 4: リードスコア算出
    const scoring = j01_leadScorer(cardInfo, industryInfo, needs);

    // Step 5: CRM書き込み
    const all = { cardInfo, industryInfo, needs, scoring, meetingMemo: meetingMemo || '', leadType: leadType || 'その他' };
    const written = j01_crmWriter(all);

    const result = {
      success: written,
      company: cardInfo.company,
      name: cardInfo.name,
      rank: scoring.rank,
      score: scoring.score,
      primaryNeed: needs.primaryNeed,
    };

    agentLog(JECA_AGENT_ID, 'DONE', `J-01完了 | ${cardInfo.company} / ${cardInfo.name} | ランク${scoring.rank}(${scoring.score}点)`);
    return result;

  } catch (e) {
    agentLog(JECA_AGENT_ID, 'ERROR', 'J-01 例外: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * J-01 バッチ登録: 複数名刺を一括登録
 * @param {Array} cardArray - [{rawCardText, meetingMemo}, ...]
 * @returns {object} - {total, success, failed, results}
 */
function batchRegisterCards(cardArray) {
  agentLog(JECA_AGENT_ID, 'START', `J-01 バッチ登録: ${cardArray.length}件`);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  cardArray.forEach((card, idx) => {
    agentLog(JECA_AGENT_ID, 'PROGRESS', `[${idx + 1}/${cardArray.length}] 処理中...`);

    // GAS制限対策: API連続呼び出し間にウェイト
    if (idx > 0) Utilities.sleep(1500);

    const result = runCardRegistration(card.rawCardText, card.meetingMemo || '');
    results.push(result);

    if (result.success) successCount++;
    else failCount++;
  });

  agentLog(JECA_AGENT_ID, 'DONE', `バッチ登録完了: 成功${successCount} / 失敗${failCount}`);
  return { total: cardArray.length, success: successCount, failed: failCount, results };
}


// ============================================================
// J-02: ThankYouEmailTeam（御礼メール一斉送信チーム）
// ============================================================

/**
 * J-02-A: CRMから未送信名刺一覧を取得
 * @returns {Array} - 未送信連絡先の配列
 */
function j02_crmLoader() {
  agentLog('J-02-A', 'START', '未送信CRMデータ取得');

  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet) {
    agentLog('J-02-A', 'ERROR', 'JECAシート取得失敗');
    return [];
  }

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    agentLog('J-02-A', 'INFO', 'データなし');
    return [];
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 17).getValues();
  const contacts = [];

  data.forEach((row, idx) => {
    const email    = row[4];   // E列: メール
    const thankDate = row[13]; // N列: 御礼送信日
    const status   = row[15];  // P列: ステータス
    const leadType = row[16];  // Q列: リードタイプ

    // 「なし」はメール送信しない
    if (leadType === 'なし') return;

    // メールアドレスがあり、まだ御礼未送信のものを抽出
    if (email && !thankDate && status !== '御礼送信済み') {
      contacts.push({
        rowIndex: idx + 2,
        registeredDate: row[0],
        company: row[1],
        name: row[2],
        title: row[3],
        email: email,
        phone: row[5],
        address: row[6],
        industry: row[7],
        companySize: row[8],
        needs: row[9],
        score: row[10],
        rank: row[11],
        meetingMemo: row[12],
        leadType: leadType || 'その他',
      });
    }
  });

  agentLog('J-02-A', 'OK', `未送信: ${contacts.length}件`);
  return contacts;
}

/**
 * J-02-B: 会話メモ・ニーズをもとにパーソナライズ要素を生成
 * @param {object} cardInfo - CRMデータ1件
 * @returns {object} - {personalTouchPoint, keyMessage, openingHook}
 */
function j02_personalizationAgent(cardInfo) {
  agentLog('J-02-B', 'START', `パーソナライズ: ${cardInfo.company}`);

  const systemPrompt = `あなたはマルケン電工の営業担当アシスタントです。
${JECA_EVENT_NAME}（${JECA_EVENT_DATE}）で交換した名刺の御礼メール用に
パーソナライズ要素をJSONで生成してください。

返すJSON形式:
{
  "personalTouchPoint": "会話メモや業界情報に基づく個人的な接点・共通点（1文）",
  "keyMessage": "この相手に最も刺さるマルケン電工の強み訴求（1-2文）",
  "openingHook": "メール冒頭の掴み（展示会での思い出や業界課題への共感・1文）"
}`;

  const userPrompt = `相手情報:
会社名: ${cardInfo.company}
氏名: ${cardInfo.name}（${cardInfo.title}）
業界: ${cardInfo.industry} / 規模: ${cardInfo.companySize}
ニーズ: ${cardInfo.needs}
会話メモ: ${cardInfo.meetingMemo || '（メモなし）'}

マルケン電工プロフィール:
${MARUKEN_PROFILE}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    return {
      personalTouchPoint: `${JECA_EVENT_NAME}でお話できたこと`,
      keyMessage: 'お客様のご要望に迅速に対応いたします',
      openingHook: `先日の${JECA_EVENT_NAME}では大変お世話になりました`,
    };
  }

  agentLog('J-02-B', 'OK', 'パーソナライズ生成完了');
  return result;
}

/**
 * J-02-C: 個別御礼メール文案生成
 * @param {object} cardInfo - CRMデータ
 * @param {object} personalization - パーソナライズ要素
 * @returns {object} - {subject, body}
 */
function j02_emailComposer(cardInfo, personalization) {
  agentLog('J-02-C', 'START', `メール文案生成: ${cardInfo.company}`);

  const leadType = cardInfo.leadType || 'その他';

  // カテゴリ別の打ち合わせ提案内容
  const meetingInstruction =
    leadType === '元請け候補'
      ? '・末尾に「一度お伺いしてご挨拶させていただけますでしょうか」と対面での打ち合わせをご提案ください。日程は相手に合わせる形で。'
      : leadType === '下請け候補'
      ? '・末尾に「一度オンラインでお話できればと思っております」とオンライン打ち合わせをご提案ください。日程は相手に合わせる形で。'
      : '・打ち合わせの提案は不要です。御礼のみで締めてください。';

  const systemPrompt = `あなたはマルケン電工の営業担当者です。
${JECA_EVENT_NAME}後の御礼メールを作成してください。

要件:
- 丁寧で温かみのある文体
- パーソナライズ要素を自然に盛り込む
- 押しつけがましくない自然な文章
- 400文字以内の本文
${meetingInstruction}
- JSONで返す

返すJSON形式:
{
  "subject": "メール件名",
  "body": "メール本文（署名なし・挨拶から締めまで）"
}`;

  const userPrompt = `宛先:
${cardInfo.company}
${cardInfo.name} 様（${cardInfo.title}）

パーソナライズ要素:
- 冒頭の掴み: ${personalization.openingHook}
- 個人的な接点: ${personalization.personalTouchPoint}
- 訴求メッセージ: ${personalization.keyMessage}
- 対応可能なニーズ: ${cardInfo.needs}

送信者: 株式会社マルケン電工`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    // フォールバック: シンプルなテンプレート
    return {
      subject: `【御礼】${JECA_EVENT_NAME}でのご縁に感謝申し上げます`,
      body: `${cardInfo.company}\n${cardInfo.name} 様\n\nお世話になっております。\n株式会社マルケン電工でございます。\n\n先日の${JECA_EVENT_NAME}（${JECA_EVENT_DATE}）では、貴重なお時間をいただきまして誠にありがとうございました。\n\n今後ともどうぞよろしくお願い申し上げます。`,
    };
  }

  agentLog('J-02-C', 'OK', `件名: ${result.subject}`);
  return result;
}

/**
 * J-02-D: バッチ送信または下書き作成
 * @param {Array} contacts - 連絡先配列
 * @param {string} mode - 'draft'（下書き）または 'send'（送信）
 * @returns {object} - {processed, success, failed}
 */
function j02_batchSender(contacts, mode) {
  agentLog('J-02-D', 'START', `バッチ${mode === 'send' ? '送信' : '下書き作成'}: ${contacts.length}件`);

  const results = [];

  contacts.forEach((contact, idx) => {
    if (idx > 0) Utilities.sleep(1200); // API制限対策

    try {
      // パーソナライズ生成
      const personalization = j02_personalizationAgent(contact);

      // メール文案生成
      const contactWithType = Object.assign({ leadType: contact.leadType }, contact);
      const email = j02_emailComposer(contactWithType, personalization);

      let ok = false;
      if (mode === 'send') {
        ok = sendEmail(contact.email, email.subject, email.body);
      } else {
        ok = createDraft(contact.email, email.subject, email.body);
      }

      results.push({ contact, success: ok, email });

      // ステータス更新
      if (ok) j02_statusUpdater(contact, mode);

    } catch (e) {
      agentLog('J-02-D', 'ERROR', `${contact.company} 処理エラー: ${e}`);
      results.push({ contact, success: false, error: e.toString() });
    }
  });

  return results;
}

/**
 * J-02-E: 送信済みをCRMに記録
 * @param {object} contact - 連絡先情報（rowIndex含む）
 * @param {string} mode - 'draft' または 'send'
 */
function j02_statusUpdater(contact, mode) {
  agentLog('J-02-E', 'START', `ステータス更新: ${contact.company} row${contact.rowIndex}`);

  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet) return;

  // N列（御礼送信日）を更新
  sheet.getRange(contact.rowIndex, 14).setValue(today());
  // P列（ステータス）を更新
  const newStatus = mode === 'send' ? '御礼送信済み' : '御礼下書き作成済み';
  sheet.getRange(contact.rowIndex, 16).setValue(newStatus);

  agentLog('J-02-E', 'OK', `ステータス→「${newStatus}」`);
}

/**
 * J-02 メイン: 御礼メール一斉送信
 * @param {string} mode - 'draft'（デフォルト）または 'send'
 */
function runThankYouBatch(mode) {
  mode = mode || 'draft';
  agentLog(JECA_AGENT_ID, 'START', `J-02 ThankYouEmailTeam 開始 / モード: ${mode}`);

  try {
    // Step 1: 未送信リスト取得
    const contacts = j02_crmLoader();

    if (contacts.length === 0) {
      agentLog(JECA_AGENT_ID, 'DONE', '対象者なし');
      return;
    }

    // Step 2-3: バッチ処理（パーソナライズ→文案→送信/下書き）
    const results = j02_batchSender(contacts, mode);

    // 集計
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    const actionLabel = mode === 'send' ? '送信完了' : '下書き作成完了';
    agentLog(JECA_AGENT_ID, 'DONE', `J-02完了 | ${actionLabel} | 成功${successCount} / 失敗${failCount}`);

  } catch (e) {
    agentLog(JECA_AGENT_ID, 'ERROR', 'J-02 例外: ' + e);
  }
}


// ============================================================
// J-03: FollowUpCampaignTeam（個別フォローアップキャンペーンチーム）
// ============================================================

/**
 * J-03-A: CRMからA/Bランクのみ抽出
 * @returns {Array} - A/Bランク連絡先の配列
 */
function j03_priorityFilter() {
  agentLog('J-03-A', 'START', 'A/Bランク抽出');

  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  const highPriority = [];

  data.forEach((row, idx) => {
    const rank = row[11];          // L列: ランク
    const email = row[4];          // E列: メール
    const followDate = row[14];    // O列: フォロー送信日
    const thankDate = row[13];     // N列: 御礼送信日（御礼済みが前提）

    // A/Bランクかつメールありかつフォロー未送信
    if ((rank === 'A' || rank === 'B') && email && !followDate) {
      highPriority.push({
        rowIndex: idx + 2,
        registeredDate: row[0],
        company: row[1],
        name: row[2],
        title: row[3],
        email: email,
        phone: row[5],
        address: row[6],
        industry: row[7],
        companySize: row[8],
        needs: row[9],
        score: row[10],
        rank: rank,
        meetingMemo: row[12],
        thankSentDate: thankDate,
      });
    }
  });

  agentLog('J-03-A', 'OK', `A/Bランク: ${highPriority.length}件`);
  return highPriority;
}

/**
 * J-03-B: 電気設備に関する具体的提案を生成
 * @param {string} company - 会社名
 * @param {string} industry - 業界
 * @returns {object} - {painPoints, solutionAngles, relevantCases}
 */
function j03_companyResearcher(company, industry) {
  agentLog('J-03-B', 'START', `企業研究: ${company}`);

  const systemPrompt = `あなたは電気工事業界の営業戦略コンサルタントです。
マルケン電工（愛知・東京の電気工事会社）の営業担当として、
ターゲット企業の電気設備に関する課題と提案角度をJSONで分析してください。

返すJSON形式:
{
  "painPoints": ["想定される課題1", "想定される課題2"],
  "solutionAngles": ["マルケン電工として提案できる解決策1", "解決策2"],
  "relevantCases": "類似業界での工事実績・事例（想定）",
  "bestContactTiming": "最適なアプローチタイミング（例: 決算前/省エネ補助金申請時期など）"
}`;

  const userPrompt = `会社名: ${company}\n業界: ${industry}\n\nマルケン電工サービス:\n${MARUKEN_SERVICES_LIST.join('\n')}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    return {
      painPoints: ['電気設備の老朽化', '電気代の高騰'],
      solutionAngles: ['LED照明改修による省エネ提案', '設備点検・保守契約'],
      relevantCases: '同業他社でのLED工事実績あり',
      bestContactTiming: '年度末・補助金申請前',
    };
  }

  agentLog('J-03-B', 'OK', `課題${result.painPoints.length}件抽出`);
  return result;
}

/**
 * J-03-C: マルケン電工のどのサービスを提案するか決定
 * @param {object} cardInfo - CRMデータ
 * @param {object} companyInfo - 企業研究結果
 * @returns {object} - {mainService, subServices, pitchAngle, expectedValue}
 */
function j03_pitchStrategist(cardInfo, companyInfo) {
  agentLog('J-03-C', 'START', `ピッチ戦略: ${cardInfo.company}`);

  const systemPrompt = `あなたはマルケン電工の営業戦略立案者です。
顧客情報と企業分析から、最適な提案戦略をJSONで決定してください。

${MARUKEN_PROFILE}

返すJSON形式:
{
  "mainService": "メイン提案サービス（MARUKEN_SERVICES_LISTより選択）",
  "subServices": ["サブ提案サービス1", "サブ提案サービス2"],
  "pitchAngle": "提案の切り口・アングル（1-2文）",
  "expectedValue": "期待できる発注規模・案件価値",
  "callToAction": "メールでの具体的な次のアクション提案（例: 無料診断の案内）"
}`;

  const userPrompt = `顧客情報:
会社: ${cardInfo.company} / 役職: ${cardInfo.title}
ニーズ: ${cardInfo.needs} / ランク: ${cardInfo.rank}（スコア: ${cardInfo.score}）

企業課題:
${companyInfo.painPoints.join('、')}

提案可能な解決策:
${companyInfo.solutionAngles.join('、')}

アプローチタイミング: ${companyInfo.bestContactTiming}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    return {
      mainService: cardInfo.needs.split(' / ')[0] || 'LED照明改修・省エネ工事',
      subServices: ['電気設備点検・保守', '定期保守契約'],
      pitchAngle: '省エネ・コスト削減の観点から提案',
      expectedValue: '中規模案件',
      callToAction: '無料電気設備診断のご案内',
    };
  }

  agentLog('J-03-C', 'OK', `メインサービス: ${result.mainService}`);
  return result;
}

/**
 * J-03-D: 提案型フォローメール生成
 * @param {object} cardInfo - CRMデータ
 * @param {object} pitch - ピッチ戦略
 * @returns {object} - {subject, body}
 */
function j03_proposalComposer(cardInfo, pitch) {
  agentLog('J-03-D', 'START', `提案メール生成: ${cardInfo.company}`);

  const systemPrompt = `あなたはマルケン電工の営業担当者です。
${JECA_EVENT_NAME}（${JECA_EVENT_DATE}）で名刺交換した相手への
フォローアップ提案メールを作成してください。

要件:
- 御礼メールの続きとして自然な流れ
- 具体的なサービス提案を盛り込む（押しつけにならない程度）
- 相手の業界課題に共感した上で提案する
- 次のアクション（打ち合わせ・診断）を促す
- 600文字以内
- JSONで返す

返すJSON形式:
{
  "subject": "メール件名",
  "body": "メール本文（署名なし）"
}`;

  const userPrompt = `宛先: ${cardInfo.company} ${cardInfo.name} 様（${cardInfo.title}）
業界: ${cardInfo.industry} / 規模: ${cardInfo.companySize}

提案戦略:
- メインサービス: ${pitch.mainService}
- サブサービス: ${pitch.subServices.join('、')}
- 提案角度: ${pitch.pitchAngle}
- 期待発注: ${pitch.expectedValue}
- CTA: ${pitch.callToAction}

マルケン電工会社概要:
${MARUKEN_PROFILE}`;

  const result = callClaudeJSON(systemPrompt, userPrompt);

  if (!result) {
    return {
      subject: `【ご提案】${cardInfo.company} 様 電気設備改善のご提案`,
      body: `${cardInfo.company}\n${cardInfo.name} 様\n\nいつもお世話になっております。\nマルケン電工でございます。\n\n先日の${JECA_EVENT_NAME}でのご縁をきっかけに、${pitch.mainService}についてご提案させていただければと存じます。\n\n${pitch.callToAction}を実施しております。ぜひご検討いただけますと幸いです。\n\nお気軽にお声がけください。`,
    };
  }

  agentLog('J-03-D', 'OK', `件名: ${result.subject}`);
  return result;
}

/**
 * J-03-E: Gmail下書き作成 + フォロー日程記録
 * @param {object} cardInfo - CRMデータ（rowIndex含む）
 * @param {object} email - {subject, body}
 * @returns {boolean}
 */
function j03_draftCreator(cardInfo, email) {
  agentLog('J-03-E', 'START', `下書き作成: ${cardInfo.company}`);

  // Gmail下書き作成
  const drafted = createDraft(cardInfo.email, email.subject, email.body);

  if (drafted) {
    // O列（フォロー送信日）とP列（ステータス）を更新
    const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
    if (sheet) {
      sheet.getRange(cardInfo.rowIndex, 15).setValue(today()); // O: フォロー送信日
      sheet.getRange(cardInfo.rowIndex, 16).setValue('フォロー下書き作成済み'); // P: ステータス
    }
  }

  agentLog('J-03-E', drafted ? 'OK' : 'ERROR', `下書き${drafted ? '作成成功' : '作成失敗'}`);
  return drafted;
}

/**
 * J-03 メイン: 全A/Bランクに対してフォローアップキャンペーン実行
 */
function runFollowUpCampaign() {
  agentLog(JECA_AGENT_ID, 'START', 'J-03 FollowUpCampaignTeam 開始');

  try {
    // Step 1: A/Bランク抽出
    const targets = j03_priorityFilter();

    if (targets.length === 0) {
      agentLog(JECA_AGENT_ID, 'DONE', 'フォロー対象なし');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    targets.forEach((contact, idx) => {
      if (idx > 0) Utilities.sleep(2000); // API制限対策（提案メールは処理重め）

      try {
        agentLog(JECA_AGENT_ID, 'PROGRESS', `[${idx + 1}/${targets.length}] ${contact.company}`);

        // Step 2: 企業研究
        const companyInfo = j03_companyResearcher(contact.company, contact.industry);

        // Step 3: ピッチ戦略決定
        const pitch = j03_pitchStrategist(contact, companyInfo);

        // Step 4: 提案メール生成
        const email = j03_proposalComposer(contact, pitch);

        // Step 5: 下書き作成 + 記録
        const ok = j03_draftCreator(contact, email);

        if (ok) successCount++;
        else failCount++;

      } catch (e) {
        agentLog(JECA_AGENT_ID, 'ERROR', `${contact.company} 処理エラー: ${e}`);
        failCount++;
      }
    });

    agentLog(JECA_AGENT_ID, 'DONE', `J-03完了 | 下書き${successCount}件 / 失敗${failCount}件`);

  } catch (e) {
    agentLog(JECA_AGENT_ID, 'ERROR', 'J-03 例外: ' + e);
  }
}


// ============================================================
// ユーティリティ・テスト関数
// ============================================================

/**
 * JECAスプレッドシートを新規作成してスクリプトプロパティに登録（初回セットアップ用）
 * JECA_SHEET_IDが未設定の場合にこちらを先に実行する。
 */
function setupJecaSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('JECA_SHEET_ID');

  if (existingId) {
    Logger.log('ℹ️ JECA_SHEET_IDはすでに設定済みです: ' + existingId);
    Logger.log('既存スプシURL: https://docs.google.com/spreadsheets/d/' + existingId);
    initJecaSheet();
    return;
  }

  const ss = SpreadsheetApp.create('JECA FAIR 2026 — CRM | マルケン電工');
  const sheetId = ss.getId();
  props.setProperty('JECA_SHEET_ID', sheetId);

  Logger.log('✅ JECAスプレッドシート作成完了');
  Logger.log('URL: ' + ss.getUrl());
  Logger.log('JECA_SHEET_ID: ' + sheetId);

  initJecaSheet();
}

/**
 * JECAシートのヘッダーを初期化（初回セットアップ用）
 */
function initJecaSheet() {
  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet) {
    Logger.log('❌ JECA_SHEET_ID が設定されていません');
    return;
  }

  // 既存データクリア確認（念のためコメントアウト）
  // sheet.clearContents();

  if (sheet.getLastRow() === 0) {
    const headers = [
      '登録日', '会社名', '名前', '役職', 'メール', '電話', '住所',
      '業界', '企業規模', 'ニーズ', 'スコア', 'ランク', '会話メモ',
      '御礼送信日', 'フォロー送信日', 'ステータス'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1a237e')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    Logger.log('✅ JECAシートヘッダー初期化完了');
  } else {
    Logger.log('ℹ️ JECAシートにすでにデータがあります（行数: ' + sheet.getLastRow() + '）');
  }
}

/**
 * JECA全体ダッシュボード状況確認
 */
function getJecaDashboard() {
  const sheet = getSheet('JECA_SHEET_ID', JECA_SHEET_NAME);
  if (!sheet || sheet.getLastRow() <= 1) {
    Logger.log('JECAデータなし');
    return;
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();

  const stats = { total: 0, rankA: 0, rankB: 0, rankC: 0, thankSent: 0, followSent: 0 };

  data.forEach(row => {
    if (!row[1]) return; // 会社名がなければスキップ
    stats.total++;
    if (row[11] === 'A') stats.rankA++;
    else if (row[11] === 'B') stats.rankB++;
    else if (row[11] === 'C') stats.rankC++;
    if (row[13]) stats.thankSent++;
    if (row[14]) stats.followSent++;
  });

  const msg = `【${JECA_EVENT_NAME} CRM状況】
登録総数: ${stats.total}件
Aランク: ${stats.rankA}件
Bランク: ${stats.rankB}件
Cランク: ${stats.rankC}件
御礼送信済: ${stats.thankSent}件
フォロー済: ${stats.followSent}件`;

  Logger.log(msg);
}

/**
 * テスト用: サンプル名刺1件で動作確認
 */
function testCardRegistration() {
  Logger.log('=== J-01 テスト実行 ===');
  const sampleCard = `株式会社テストビル管理
鈴木 太郎
施設管理部 部長
Tel: 052-000-0001
Email: suzuki@testbiru.co.jp
〒460-0001 愛知県名古屋市中区三の丸1-1`;

  const sampleMemo = 'LED改修の相談あり。現在の照明が老朽化していて電気代が高いと言っていた。来月見積もり希望。';

  const result = runCardRegistration(sampleCard, sampleMemo);
  Logger.log('=== テスト結果 ===');
  Logger.log(JSON.stringify(result, null, 2));
}
