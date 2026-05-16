// ============================================================
// Code_estimation_team.gs — 見積・提案書作成チーム型エージェント
// マルケン電工 hyperauto プロジェクト
// エージェント: E-01（見積書自動生成）E-02（提案書作成）
//               E-03（単価アドバイザー）E-04（完成報告書作成）
// ============================================================
//
// スクリプトプロパティ:
//   QUOTE_SHEET_ID         見積管理スプシID
//   JOB_SHEET_ID           案件管理スプシID（"案件一覧"シート）
//   CASES_SHEET_ID         実績・類似案件スプシID
//   QUOTE_DOC_TEMPLATE_ID  見積書Docsテンプレートのドキュメントリンク
//   PROPOSAL_SLIDES_ID     提案書スライドテンプレートID（任意）
//   CLAUDE_API_KEY         Claude API キー
//   XAI_API_KEY            xAI (Grok) API キー
//   LINE_CHANNEL_ACCESS_TOKEN
//   LINE_USER_IDS          manager:U...
// ============================================================

// ============================================================
// E-01: QuoteGeneratorTeam — 見積書自動生成チーム
// ============================================================

/**
 * E-01 メイン: 見積依頼テキストからメール下書きまで一気通貫
 * @param {string} requestText - 見積依頼の本文またはメール文章
 * @param {string} toEmail     - 送付先メールアドレス
 */
function runQuoteGeneratorTeam(requestText, toEmail) {
  agentLog('E-01', 'START', '見積書自動生成チーム起動');

  // ステップ1: 依頼内容の解析
  const request = e01_requestParser(requestText);
  if (!request) {
    agentLog('E-01', 'ERROR', '依頼内容の解析に失敗');
    sendLineToManager('⚠️ E-01 見積書生成: 依頼内容の解析に失敗しました。\n依頼文を確認してください。');
    return null;
  }
  agentLog('E-01', 'INFO', '工事種別: ' + request.workType + ' / 規模: ' + request.scale);

  // ステップ2: 単価計算
  const prices = e01_priceCalculator(request.workItems);
  if (!prices) {
    agentLog('E-01', 'ERROR', '単価計算に失敗');
    return null;
  }

  // ステップ3: 見積書データ組み立て
  const quote = e01_quoteBuilder(request, prices);
  if (!quote) {
    agentLog('E-01', 'ERROR', '見積書データ組み立て失敗');
    return null;
  }

  // ステップ4: Google Docsに出力
  const docUrl = e01_documentCreator(quote);
  agentLog('E-01', 'INFO', 'Doc作成完了: ' + (docUrl || '（スプシ形式）'));

  // ステップ5: メール下書き作成
  const drafted = e01_draftSender(quote, toEmail, docUrl);

  // ログ記録
  const sheet = getSheet('QUOTE_SHEET_ID', '見積一覧');
  if (sheet) {
    appendRow(sheet, [
      nowStr(),
      'E-01',
      request.customerName || '',
      request.workType || '',
      request.location || '',
      quote.total || 0,
      toEmail,
      drafted ? '下書き作成済み' : '下書き失敗',
      docUrl || '',
    ]);
  }

  // LINE通知
  const lineMsg = [
    '📄 E-01 見積書生成完了',
    '─────────────────',
    '顧客: ' + (request.customerName || '不明'),
    '工事: ' + (request.workType || '不明'),
    '現場: ' + (request.location || '不明'),
    '合計: ¥' + (quote.total || 0).toLocaleString(),
    'メール下書き: ' + (drafted ? '✅ 作成済み' : '❌ 失敗'),
  ].join('\n');

  sendLineToManager(lineMsg, [
    lineQR('内容確認', 'e01_review:' + (toEmail || '')),
    lineQR('再生成', 'e01_retry'),
  ]);

  agentLog('E-01', 'DONE', '合計: ¥' + quote.total);
  return quote;
}

/**
 * E-01-1: 見積依頼の内容を解析して構造化データに変換（Grok使用）
 * @param {string} emailOrText - 依頼文
 * @returns {object|null} { workType, scale, location, customerName, workItems[], notes }
 */
function e01_requestParser(emailOrText) {
  agentLog('E-01', 'PARSE', '依頼内容解析開始');

  const sys = `あなたはマルケン電工の見積担当アシスタントです。
電気工事の見積依頼文を解析して、以下のJSON形式で返してください。
工事種別は必ず以下から選択: ${MARUKEN_SERVICES_LIST.join(', ')}
スケールは「小（〜50万）」「中（50〜200万）」「大（200万〜）」で判定。`;

  const user = `以下の見積依頼を解析してください:\n\n${emailOrText}\n\n
JSON形式: {
  "customerName": "顧客名または空文字",
  "workType": "工事種別",
  "scale": "小|中|大",
  "location": "現場住所または地域名",
  "workItems": [
    { "item": "作業名", "unit": "単位（式/個/m等）", "quantity": 数量, "memo": "備考" }
  ],
  "notes": "その他特記事項"
}`;

  const result = callGrokJSON(sys, user);
  if (!result) {
    Logger.log('E-01 requestParser: Grok JSON解析失敗');
    return null;
  }
  return result;
}

/**
 * E-01-2: 工事項目ごとの単価をClaude推定で計算
 * @param {Array} workItems - 工事項目リスト
 * @returns {object|null} { items: [{...item, unitPrice, amount}], subtotal, tax, total }
 */
function e01_priceCalculator(workItems) {
  agentLog('E-01', 'PRICE', '単価計算開始 ' + (workItems ? workItems.length : 0) + '件');

  if (!workItems || workItems.length === 0) return null;

  const sys = `あなたはマルケン電工の見積積算担当です。
愛知県・名古屋エリアの電気工事業者として、各工事項目の適切な単価を推定してください。
市場相場と中小業者の利益を踏まえて現実的な単価を設定してください。
消費税は10%で計算してください。`;

  const user = `以下の工事項目の単価を推定してJSON形式で返してください:

${JSON.stringify(workItems, null, 2)}

JSON形式:
{
  "items": [
    {
      "item": "作業名（元のまま）",
      "unit": "単位",
      "quantity": 数量,
      "unitPrice": 単価（円）,
      "amount": 小計（円）,
      "memo": "根拠・備考"
    }
  ],
  "subtotal": 小計合計（税抜）,
  "tax": 消費税額,
  "total": 税込合計
}`;

  const result = callClaudeJSON(sys, user);
  if (!result) {
    Logger.log('E-01 priceCalculator: Claude JSON解析失敗');
    return null;
  }
  return result;
}

/**
 * E-01-3: 見積書データ構造を最終組み立て
 * @param {object} request - 依頼内容
 * @param {object} prices  - 単価計算結果
 * @returns {object} quoteData
 */
function e01_quoteBuilder(request, prices) {
  agentLog('E-01', 'BUILD', '見積書データ組み立て');

  const quoteNo = 'MK-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') +
                  '-' + Math.floor(Math.random() * 900 + 100);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return {
    quoteNo:      quoteNo,
    date:         today(),
    validUntil:   Utilities.formatDate(validUntil, 'Asia/Tokyo', 'yyyy/MM/dd'),
    customerName: request.customerName || 'ご担当者様',
    workType:     request.workType || '',
    location:     request.location || '',
    scale:        request.scale || '',
    items:        prices.items || [],
    subtotal:     prices.subtotal || 0,
    tax:          prices.tax || 0,
    total:        prices.total || 0,
    notes:        request.notes || '',
    issuer:       '株式会社マルケン電工',
  };
}

/**
 * E-01-4: Google Docsテンプレートに見積書データを流し込み
 * @param {object} quote - 見積書データ
 * @returns {string|null} 作成したドキュメントのURL
 */
function e01_documentCreator(quote) {
  agentLog('E-01', 'DOC', 'Google Docs生成開始');

  try {
    // テンプレートをコピーして新規Doc作成
    const templateId = getProp('QUOTE_DOC_TEMPLATE_ID');
    let doc;

    if (templateId) {
      // テンプレートが設定されている場合はコピー
      const copy = DriveApp.getFileById(templateId).makeCopy(
        '見積書_' + quote.quoteNo + '_' + quote.customerName
      );
      doc = DocumentApp.openById(copy.getId());
    } else {
      // テンプレートなしの場合は新規作成
      doc = DocumentApp.create('見積書_' + quote.quoteNo + '_' + quote.customerName);
    }

    const body = doc.getBody();

    if (!templateId) {
      // 見積書本文をゼロから生成
      body.clear();
      body.appendParagraph('見 積 書').setHeading(DocumentApp.ParagraphHeading.HEADING1);
      body.appendParagraph('見積番号: ' + quote.quoteNo);
      body.appendParagraph('発行日: ' + quote.date);
      body.appendParagraph('有効期限: ' + quote.validUntil);
      body.appendParagraph('');
      body.appendParagraph('宛先: ' + quote.customerName + ' 御中');
      body.appendParagraph('現場住所: ' + quote.location);
      body.appendParagraph('工事種別: ' + quote.workType);
      body.appendParagraph('');
      body.appendParagraph('─── 工事項目 ───────────────────────');

      // 明細テーブル
      const tableData = [['項目', '単位', '数量', '単価', '金額', '備考']];
      (quote.items || []).forEach(it => {
        tableData.push([
          it.item || '',
          it.unit || '式',
          String(it.quantity || 1),
          '¥' + Number(it.unitPrice || 0).toLocaleString(),
          '¥' + Number(it.amount || 0).toLocaleString(),
          it.memo || '',
        ]);
      });
      body.appendTable(tableData);
      body.appendParagraph('');
      body.appendParagraph('小計（税抜）: ¥' + Number(quote.subtotal).toLocaleString());
      body.appendParagraph('消費税（10%）: ¥' + Number(quote.tax).toLocaleString());
      body.appendParagraph('合計（税込）: ¥' + Number(quote.total).toLocaleString());
      body.appendParagraph('');
      body.appendParagraph('【特記事項】').setBold(true);
      body.appendParagraph(quote.notes || 'なし');
      body.appendParagraph('');
      body.appendParagraph(MARUKEN_SIGNATURE);
    } else {
      // テンプレートの置換処理
      body.replaceText('{{QUOTE_NO}}',      quote.quoteNo);
      body.replaceText('{{DATE}}',          quote.date);
      body.replaceText('{{VALID_UNTIL}}',   quote.validUntil);
      body.replaceText('{{CUSTOMER_NAME}}', quote.customerName);
      body.replaceText('{{LOCATION}}',      quote.location);
      body.replaceText('{{WORK_TYPE}}',     quote.workType);
      body.replaceText('{{SUBTOTAL}}',      '¥' + Number(quote.subtotal).toLocaleString());
      body.replaceText('{{TAX}}',           '¥' + Number(quote.tax).toLocaleString());
      body.replaceText('{{TOTAL}}',         '¥' + Number(quote.total).toLocaleString());
      body.replaceText('{{NOTES}}',         quote.notes || 'なし');
    }

    doc.saveAndClose();
    return 'https://docs.google.com/document/d/' + doc.getId();

  } catch(e) {
    Logger.log('E-01 documentCreator error: ' + e);
    return null;
  }
}

/**
 * E-01-5: 見積書添付メールの下書き作成
 * @param {object} quote    - 見積書データ
 * @param {string} toEmail  - 送付先
 * @param {string} docUrl   - DocのURL（本文に記載）
 * @returns {boolean}
 */
function e01_draftSender(quote, toEmail, docUrl) {
  agentLog('E-01', 'DRAFT', '見積メール下書き作成: ' + toEmail);

  const subject = '【見積書】' + quote.workType + 'のご提案 ／ 株式会社マルケン電工';

  const body = [
    quote.customerName + ' 御中',
    '',
    'いつもお世話になっております。',
    '株式会社マルケン電工でございます。',
    '',
    'このたびは、' + quote.workType + 'についてお問い合わせいただきまして、',
    '誠にありがとうございます。',
    '',
    '下記の通り、お見積りをご提案いたします。',
    '',
    '─────────────────────────',
    '■ 見積番号: ' + quote.quoteNo,
    '■ 発行日: ' + quote.date,
    '■ 有効期限: ' + quote.validUntil,
    '■ 工事種別: ' + quote.workType,
    '■ 現場住所: ' + quote.location,
    '■ お見積り総額（税込）: ¥' + Number(quote.total).toLocaleString(),
    '─────────────────────────',
    '',
    docUrl ? '詳細明細はこちらをご確認ください:\n' + docUrl : '',
    '',
    'ご不明な点がございましたら、お気軽にご連絡くださいませ。',
    'ご検討のほど、よろしくお願いいたします。',
  ].join('\n');

  return createDraft(toEmail, subject, body);
}


// ============================================================
// E-02: ProposalTeam — 提案書・工事説明書作成チーム
// ============================================================

/**
 * E-02 メイン: 案件情報から提案書を作成してメール下書きを送信
 * @param {object|string} projectInfo - 案件情報（文字列またはオブジェクト）
 * @param {string} toEmail            - 送付先
 */
function runProposalTeam(projectInfo, toEmail) {
  agentLog('E-02', 'START', '提案書作成チーム起動');

  // ステップ1: 案件分析
  const analysis = e02_projectAnalyzer(projectInfo);
  if (!analysis) {
    agentLog('E-02', 'ERROR', '案件分析失敗');
    sendLineToManager('⚠️ E-02 提案書作成: 案件分析に失敗しました。');
    return null;
  }

  // ステップ2: 類似案件検索
  const cases = e02_similarCaseFinder(analysis.workType);

  // ステップ3: 提案戦略決定
  const strategy = e02_pitchStrategist(analysis, cases);
  if (!strategy) {
    agentLog('E-02', 'ERROR', '提案戦略の決定失敗');
    return null;
  }

  // ステップ4: 提案書本文生成
  const content = e02_documentComposer(strategy, analysis);
  if (!content) {
    agentLog('E-02', 'ERROR', '提案書本文生成失敗');
    return null;
  }

  // ステップ5: Google Docs（またはSlides）に書き出し
  const docUrl = e02_slideCreator(content, analysis);

  // メール下書き作成
  if (toEmail) {
    const subject = '【ご提案】' + (analysis.workType || 'サービス') + 'についてのご提案 ／ 株式会社マルケン電工';
    const emailBody = [
      (analysis.customerName || 'ご担当者') + ' 様',
      '',
      'いつもお世話になっております。',
      '株式会社マルケン電工でございます。',
      '',
      'このたびは、' + (analysis.workType || 'ご依頼の工事') + 'についてご提案させていただきます。',
      '',
      '─── ご提案概要 ─────────────────',
      content.summary || '',
      '────────────────────────────────',
      '',
      docUrl ? '詳細資料はこちら:\n' + docUrl : '',
      '',
      'ご検討いただけますようお願い申し上げます。',
    ].join('\n');

    createDraft(toEmail, subject, emailBody);
  }

  // LINE通知
  sendLineToManager([
    '📋 E-02 提案書作成完了',
    '顧客: ' + (analysis.customerName || '不明'),
    '工事: ' + (analysis.workType || '不明'),
    '提案ポイント: ' + (strategy.keyMessage || ''),
    docUrl ? 'Doc: ' + docUrl : '（Doc未作成）',
  ].join('\n'));

  agentLog('E-02', 'DONE', '提案書完成');
  return { analysis, strategy, content, docUrl };
}

/**
 * E-02-1: 案件の特性・課題・要望を分析（Claude）
 */
function e02_projectAnalyzer(projectInfo) {
  agentLog('E-02', 'ANALYZE', '案件分析開始');

  const infoStr = typeof projectInfo === 'string' ? projectInfo : JSON.stringify(projectInfo);

  const sys = `あなたはマルケン電工の営業コンサルタントです。
${MARUKEN_PROFILE}
案件情報を分析して、顧客の課題・ニーズ・最適なアプローチを特定してください。`;

  const user = `以下の案件情報を分析してください:\n\n${infoStr}\n\n
JSON形式:
{
  "customerName": "顧客名",
  "workType": "工事種別",
  "location": "現場場所",
  "budget": "予算感（高/中/低/不明）",
  "urgency": "緊急度（高/中/低）",
  "painPoints": ["課題・悩み1", "課題2"],
  "needs": ["ニーズ1", "ニーズ2"],
  "decisionFactors": ["決定要因1", "決定要因2"],
  "competitorRisks": "競合リスクや注意点",
  "summary": "案件の一言要約"
}`;

  return callClaudeJSON(sys, user);
}

/**
 * E-02-2: 類似案件の実績をスプレッドシートから検索
 */
function e02_similarCaseFinder(workType) {
  agentLog('E-02', 'CASES', '類似案件検索: ' + workType);

  const sheet = getSheet('CASES_SHEET_ID', '実績一覧');
  if (!sheet) return [];

  try {
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    // ヘッダー行スキップ・工事種別でフィルタリング（部分一致）
    const cases = data.slice(1)
      .filter(row => row[2] && workType && String(row[2]).includes(workType.substring(0, 4)))
      .slice(0, 5)  // 最大5件
      .map(row => ({
        date:     row[0] || '',
        customer: row[1] || '',
        workType: row[2] || '',
        amount:   row[3] || '',
        result:   row[4] || '',
        point:    row[5] || '',
      }));

    agentLog('E-02', 'CASES', '類似案件 ' + cases.length + ' 件取得');
    return cases;
  } catch(e) {
    Logger.log('E-02 similarCaseFinder error: ' + e);
    return [];
  }
}

/**
 * E-02-3: 提案の切り口・強調ポイントを決定（Claude）
 */
function e02_pitchStrategist(analysis, cases) {
  agentLog('E-02', 'STRATEGY', '提案戦略策定');

  const sys = `あなたはマルケン電工の営業戦略アドバイザーです。
${MARUKEN_PROFILE}
顧客分析と類似実績を踏まえて、最も効果的な提案戦略を立案してください。`;

  const user = `顧客分析:
${JSON.stringify(analysis, null, 2)}

類似案件実績:
${cases.length > 0 ? JSON.stringify(cases, null, 2) : '（実績データなし）'}

JSON形式:
{
  "keyMessage": "提案の核心メッセージ（1文）",
  "emphasisPoints": ["強調ポイント1", "強調ポイント2", "強調ポイント3"],
  "differentiators": ["競合との差別化ポイント1", "差別化2"],
  "successStory": "類似実績の成功事例要約（あれば）",
  "approach": "営業アプローチ方針",
  "riskCounters": ["懸念点と対処法1", "対処法2"]
}`;

  return callClaudeJSON(sys, user);
}

/**
 * E-02-4: 提案書本文生成（Claude・700字以内）
 */
function e02_documentComposer(strategy, analysis) {
  agentLog('E-02', 'COMPOSE', '提案書本文生成');

  const sys = `あなたはマルケン電工の提案書ライターです。
${MARUKEN_PROFILE}
プロフェッショナルで説得力のある提案書本文を生成してください。
本文は700字以内で、顧客目線で書いてください。`;

  const user = `以下の戦略に基づいて提案書本文を作成してください:

戦略: ${JSON.stringify(strategy, null, 2)}
案件情報: ${JSON.stringify(analysis, null, 2)}

JSON形式:
{
  "title": "提案書タイトル",
  "summary": "エグゼクティブサマリー（2〜3文）",
  "body": "提案書本文（700字以内）",
  "bulletPoints": ["提案の要点1", "要点2", "要点3"],
  "closingMessage": "締めのメッセージ（1〜2文）"
}`;

  return callClaudeJSON(sys, user);
}

/**
 * E-02-5: Google Docsに提案書を書き出し（Slidesが設定されていればSlides）
 */
function e02_slideCreator(content, analysis) {
  agentLog('E-02', 'SLIDE', 'Google Docs提案書出力');

  try {
    const docTitle = '提案書_' + (analysis.customerName || '顧客') + '_' +
                     Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    const doc  = DocumentApp.create(docTitle);
    const body = doc.getBody();

    body.appendParagraph(content.title || '提案書').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('発行日: ' + today() + '　発行: 株式会社マルケン電工');
    body.appendParagraph('');
    body.appendParagraph('■ エグゼクティブサマリー').setBold(true);
    body.appendParagraph(content.summary || '');
    body.appendParagraph('');
    body.appendParagraph('■ ご提案内容').setBold(true);
    body.appendParagraph(content.body || '');
    body.appendParagraph('');
    body.appendParagraph('■ 提案のポイント').setBold(true);
    (content.bulletPoints || []).forEach((pt, i) => {
      body.appendParagraph((i + 1) + '. ' + pt);
    });
    body.appendParagraph('');
    body.appendParagraph('■ ご連絡先').setBold(true);
    body.appendParagraph(MARUKEN_SIGNATURE);

    doc.saveAndClose();
    return 'https://docs.google.com/document/d/' + doc.getId();
  } catch(e) {
    Logger.log('E-02 slideCreator error: ' + e);
    return null;
  }
}


// ============================================================
// E-03: PriceAdvisorTeam — 単価アドバイザーチーム
// ============================================================

/**
 * E-03 メイン: 工事説明から単価サマリーをLINEに送信
 * @param {string} workDescription - 工事内容の説明
 */
function runPriceAdvisorTeam(workDescription) {
  agentLog('E-03', 'START', '単価アドバイザーチーム起動');

  // ステップ1: 作業項目分解
  const items = e03_workItemParser(workDescription);
  if (!items || items.length === 0) {
    agentLog('E-03', 'ERROR', '作業項目の分解に失敗');
    sendLineToManager('⚠️ E-03 単価アドバイザー: 工事内容の解析に失敗しました。');
    return null;
  }

  // ステップ2: 市場単価調査
  const prices = e03_marketPriceLookup(items);
  if (!prices) {
    agentLog('E-03', 'ERROR', '単価推定失敗');
    return null;
  }

  // ステップ3: 利益率・見積総額計算
  const result = e03_marginCalculator(items, prices);

  // ステップ4: LINEに送信
  e03_reportComposer(result, workDescription);

  agentLog('E-03', 'DONE', '単価サマリー送信完了');
  return result;
}

/**
 * E-03-1: 工事説明から作業項目を分解（Grok）
 */
function e03_workItemParser(description) {
  agentLog('E-03', 'PARSE', '作業項目分解');

  const sys = `あなたはマルケン電工の積算担当です。
工事の説明文から具体的な作業項目に分解してください。
各項目は独立した費用計算が可能な粒度にしてください。`;

  const user = `以下の工事説明を作業項目に分解してください:

${description}

JSON形式:
{
  "items": [
    { "item": "作業名", "unit": "単位", "quantity": 数量, "category": "材料費|労務費|外注費|諸経費" }
  ],
  "workType": "主要工事種別",
  "estimatedDays": 作業日数の推定
}`;

  const result = callGrokJSON(sys, user);
  return result ? result.items : null;
}

/**
 * E-03-2: 市場相場・過去実績から単価を推定（Claude）
 */
function e03_marketPriceLookup(items) {
  agentLog('E-03', 'MARKET', '市場単価推定');

  const sys = `あなたは愛知県・名古屋の電気工事業界の積算エキスパートです。
各作業項目の市場相場単価（下限・標準・上限）を推定してください。
中小電気工事業者の実際の市場感覚で回答してください。`;

  const user = `以下の作業項目の市場相場単価を推定してください:

${JSON.stringify(items, null, 2)}

JSON形式:
{
  "priceMap": {
    "作業名": { "low": 最低単価, "standard": 標準単価, "high": 高単価, "unit": "単位", "note": "根拠" }
  }
}`;

  return callClaudeJSON(sys, user);
}

/**
 * E-03-3: 利益率・適切な見積総額を算出
 */
function e03_marginCalculator(items, prices) {
  agentLog('E-03', 'MARGIN', '利益率計算');

  const priceMap = prices.priceMap || {};
  let costTotal  = 0;
  const breakdown = [];

  items.forEach(it => {
    const p = priceMap[it.item];
    const unitPrice = p ? p.standard : 0;
    const amount    = unitPrice * (it.quantity || 1);
    costTotal += amount;
    breakdown.push({
      item:      it.item,
      unit:      it.unit || '式',
      quantity:  it.quantity || 1,
      unitPrice: unitPrice,
      amount:    amount,
      category:  it.category || '',
      priceRange: p ? ('¥' + p.low.toLocaleString() + '〜¥' + p.high.toLocaleString()) : '不明',
    });
  });

  // 推奨利益率（電気工事業: 標準25〜35%）
  const MARGIN_RATE = 0.30;
  const recommendedTotal = Math.ceil(costTotal / (1 - MARGIN_RATE) / 1000) * 1000;
  const tax              = Math.round(recommendedTotal * 0.1);

  return {
    breakdown:        breakdown,
    costSubtotal:     costTotal,
    recommendedPrice: recommendedTotal,
    tax:              tax,
    totalWithTax:     recommendedTotal + tax,
    marginAmount:     recommendedTotal - costTotal,
    marginRate:       Math.round(MARGIN_RATE * 100) + '%',
  };
}

/**
 * E-03-4: 単価サマリーをLINEに送信
 */
function e03_reportComposer(result, originalDesc) {
  agentLog('E-03', 'REPORT', '単価サマリーLINE送信');

  const lines = [
    '💴 E-03 単価アドバイザー結果',
    '─────────────────',
    '工事内容: ' + (originalDesc || '').substring(0, 40) + '...',
    '',
    '【明細】',
  ];

  (result.breakdown || []).forEach(it => {
    lines.push(`・${it.item}: ¥${Number(it.unitPrice).toLocaleString()} × ${it.quantity}${it.unit} = ¥${Number(it.amount).toLocaleString()}`);
  });

  lines.push('');
  lines.push('【推奨見積額】');
  lines.push('原価合計: ¥' + Number(result.costSubtotal).toLocaleString());
  lines.push('推奨見積（税抜）: ¥' + Number(result.recommendedPrice).toLocaleString());
  lines.push('消費税: ¥' + Number(result.tax).toLocaleString());
  lines.push('合計（税込）: ¥' + Number(result.totalWithTax).toLocaleString());
  lines.push('利益率目安: ' + result.marginRate);

  sendLineToManager(lines.join('\n'), [
    lineQR('見積書生成', 'e01_from_e03:start'),
    lineQR('再計算', 'e03_retry'),
  ]);
}


// ============================================================
// E-04: CompletionReportTeam — 完成報告書作成チーム
// ============================================================

/**
 * E-04 メイン: 案件IDから完成報告書を作成
 * @param {string} jobId - 案件ID
 */
function runCompletionReportTeam(jobId) {
  agentLog('E-04', 'START', '完成報告書チーム起動: ' + jobId);

  // ステップ1: 工事記録収集
  const workRecord = e04_workRecordCollector(jobId);
  if (!workRecord) {
    agentLog('E-04', 'ERROR', '工事記録の取得に失敗: ' + jobId);
    sendLineToManager('⚠️ E-04 完成報告書: 案件ID ' + jobId + ' の記録が見つかりません。');
    return null;
  }

  // ステップ2: 施工写真リスト化
  const photos = e04_photoOrganizer(jobId);

  // ステップ3: 報告書本文生成
  const report = e04_reportComposer(workRecord, photos);
  if (!report) {
    agentLog('E-04', 'ERROR', '報告書本文生成失敗');
    return null;
  }

  // ステップ4: Google Docsに書き出し
  const docUrl = e04_documentCreator(report, workRecord);

  // LINE通知
  sendLineToManager([
    '✅ E-04 完成報告書作成完了',
    '案件ID: ' + jobId,
    '顧客: ' + (workRecord.customerName || '不明'),
    '工事: ' + (workRecord.workType || '不明'),
    '写真枚数: ' + (photos ? photos.length : 0) + '枚',
    docUrl ? 'Doc: ' + docUrl : '（Doc作成エラー）',
  ].join('\n'));

  agentLog('E-04', 'DONE', 'jobId: ' + jobId);
  return { workRecord, photos, report, docUrl };
}

/**
 * E-04-1: 案件の工事内容・日程・担当者をスプシから収集
 */
function e04_workRecordCollector(jobId) {
  agentLog('E-04', 'COLLECT', '工事記録収集: ' + jobId);

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return null;

  try {
    const data = sheet.getDataRange().getValues();
    const row  = data.find(r => String(r[0]) === String(jobId));
    if (!row) {
      Logger.log('E-04: 案件ID ' + jobId + ' が見つかりません');
      return null;
    }

    return {
      jobId:        row[0] || jobId,
      customerName: row[1] || '',
      location:     row[2] || '',
      workType:     row[3] || '',
      startDate:    row[4] || '',
      endDate:      row[5] || '',
      staffName:    row[6] || '',
      amount:       row[7] || 0,
      workDetails:  row[8] || '',
      notes:        row[9] || '',
    };
  } catch(e) {
    Logger.log('E-04 workRecordCollector error: ' + e);
    return null;
  }
}

/**
 * E-04-2: 施工写真のリスト化・キャプション生成（Claude）
 */
function e04_photoOrganizer(jobId) {
  agentLog('E-04', 'PHOTOS', '施工写真整理: ' + jobId);

  try {
    // 案件IDに対応するDriveフォルダを検索
    const folders = DriveApp.getFoldersByName('現場写真_' + jobId);
    if (!folders.hasNext()) {
      Logger.log('E-04: 写真フォルダなし（jobId=' + jobId + '）');
      return [];
    }

    const folder = folders.next();
    const files   = folder.getFiles();
    const photos  = [];

    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      if (!name.match(/\.(jpg|jpeg|png|gif)$/i)) continue;

      // ファイル名からフェーズ推定
      let phase = '施工中';
      if (name.match(/(before|施工前|before)/i)) phase = '施工前';
      if (name.match(/(after|施工後|完成|after)/i)) phase = '施工後';

      // Claudeでキャプション生成
      const caption = e04_generateCaption(name, phase, jobId);

      photos.push({
        name:    name,
        url:     file.getUrl(),
        phase:   phase,
        caption: caption || phase + 'の様子',
      });
    }

    agentLog('E-04', 'PHOTOS', photos.length + '枚取得');
    return photos;
  } catch(e) {
    Logger.log('E-04 photoOrganizer error: ' + e);
    return [];
  }
}

/**
 * E-04-2 補助: 写真キャプション生成（Claude）
 */
function e04_generateCaption(fileName, phase, jobId) {
  const sys = `あなたはマルケン電工の施工記録担当です。
写真ファイル名と施工フェーズから、報告書用の簡潔なキャプションを生成してください。
キャプションは20〜40字程度で、工事内容が伝わるように書いてください。`;

  const user = `ファイル名: ${fileName}\nフェーズ: ${phase}\n案件ID: ${jobId}\n\nキャプション（テキストのみで返答）:`;

  return callClaude(sys, user);
}

/**
 * E-04-3: 完成報告書本文生成（Claude）
 */
function e04_reportComposer(workRecord, photos) {
  agentLog('E-04', 'COMPOSE', '報告書本文生成');

  const sys = `あなたはマルケン電工の施工管理担当です。
工事記録と写真情報から、顧客向けの丁寧な完成報告書を生成してください。
読みやすく、工事の品質と誠実さが伝わる文章で書いてください。`;

  const user = `以下の情報から完成報告書本文を生成してください:

工事記録:
${JSON.stringify(workRecord, null, 2)}

施工写真（${photos.length}枚）:
${photos.map(p => `[${p.phase}] ${p.caption}`).join('\n')}

JSON形式:
{
  "title": "完成報告書タイトル",
  "greeting": "挨拶文（2〜3文）",
  "workSummary": "工事概要（3〜5文）",
  "qualityNotes": "品質・安全に関する説明（2〜3文）",
  "maintenanceTips": ["保守・メンテナンスのアドバイス1", "アドバイス2"],
  "closing": "締めの挨拶（2文）"
}`;

  return callClaudeJSON(sys, user);
}

/**
 * E-04-4: Google Docsに完成報告書を書き出し
 */
function e04_documentCreator(report, workRecord) {
  agentLog('E-04', 'DOC', 'Google Docs完成報告書出力');

  try {
    const docTitle = '完成報告書_' + workRecord.customerName + '_' + workRecord.jobId;
    const doc  = DocumentApp.create(docTitle);
    const body = doc.getBody();

    body.appendParagraph(report.title || '完成報告書').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('作成日: ' + today());
    body.appendParagraph('');

    body.appendParagraph('■ 工事概要').setBold(true);
    body.appendParagraph('案件ID: ' + workRecord.jobId);
    body.appendParagraph('お客様: ' + workRecord.customerName + ' 様');
    body.appendParagraph('現場住所: ' + workRecord.location);
    body.appendParagraph('工事種別: ' + workRecord.workType);
    body.appendParagraph('施工期間: ' + workRecord.startDate + ' 〜 ' + workRecord.endDate);
    body.appendParagraph('担当者: ' + workRecord.staffName);
    body.appendParagraph('');

    body.appendParagraph('■ ご挨拶').setBold(true);
    body.appendParagraph(report.greeting || '');
    body.appendParagraph('');

    body.appendParagraph('■ 施工内容').setBold(true);
    body.appendParagraph(report.workSummary || '');
    body.appendParagraph('');

    body.appendParagraph('■ 品質・安全について').setBold(true);
    body.appendParagraph(report.qualityNotes || '');
    body.appendParagraph('');

    if (report.maintenanceTips && report.maintenanceTips.length > 0) {
      body.appendParagraph('■ 保守・メンテナンスのご案内').setBold(true);
      report.maintenanceTips.forEach(tip => body.appendParagraph('・' + tip));
      body.appendParagraph('');
    }

    body.appendParagraph('■ 締めの言葉').setBold(true);
    body.appendParagraph(report.closing || '');
    body.appendParagraph('');
    body.appendParagraph(MARUKEN_SIGNATURE);

    doc.saveAndClose();
    return 'https://docs.google.com/document/d/' + doc.getId();
  } catch(e) {
    Logger.log('E-04 documentCreator error: ' + e);
    return null;
  }
}


// ============================================================
// テスト関数
// ============================================================

/** E-01 単体テスト */
function testE01() {
  Logger.log('=== E-01 テスト ===');
  const sampleRequest = `
    ABC工業様より、倉庫の照明をLEDに全面改修したいとのご依頼です。
    倉庫は名古屋市守山区にあり、延床面積500平米。
    現在の蛍光灯（40W×80灯）を全てLED（20W）に交換。
    工期は来月中を希望。予算感は150万円前後。
  `;
  const result = runQuoteGeneratorTeam(sampleRequest, 'test@example.com');
  Logger.log('E-01 結果: ' + (result ? '✅ 完了 / 合計¥' + result.total : '❌ 失敗'));
}

/** E-02 単体テスト */
function testE02() {
  Logger.log('=== E-02 テスト ===');
  const sampleProject = {
    customerName: '株式会社サンプル商事',
    workType:     'EV充電器設置',
    location:     '愛知県一宮市',
    details:      '社員駐車場にEV充電器を3台設置したい。普通充電で十分。予算100万以内。',
  };
  const result = runProposalTeam(sampleProject, 'test@example.com');
  Logger.log('E-02 結果: ' + (result ? '✅ 完了' : '❌ 失敗'));
}

/** E-03 単体テスト */
function testE03() {
  Logger.log('=== E-03 テスト ===');
  const desc = '事務所（100平米）の照明をLEDに交換。蛍光灯40本、スイッチ5箇所、工期2日。';
  const result = runPriceAdvisorTeam(desc);
  Logger.log('E-03 結果: ' + (result ? '✅ 完了' : '❌ 失敗'));
}

/** E-04 単体テスト */
function testE04() {
  Logger.log('=== E-04 テスト ===');
  const result = runCompletionReportTeam('JOB-001');
  Logger.log('E-04 結果: ' + (result ? '✅ 完了' : '❌ 失敗（案件ID未登録の可能性）'));
}
