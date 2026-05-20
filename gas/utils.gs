// ============================================================
// utils.gs — 全エージェント共通ユーティリティ
// マルケン電工 hyperauto プロジェクト
// ============================================================

// ─── 定数 ────────────────────────────────────────────────────
const MARUKEN_SIGNATURE = `
─────────────────────────
株式会社マルケン電工
〒468-0015 愛知県名古屋市天白区原4丁目1603
TEL: 052-806-9481 / Mail: info@marukendenkou.com
─────────────────────────`;

const MARUKEN_PROFILE = `
【会社概要】
社名: 株式会社マルケン電工
業種: 電気工事（愛知県名古屋市・東京進出中）
得意工事:
  - 一般電気工事（新設・改修）
  - LED照明改修・省エネ工事
  - 電気設備点検・保守
  - 太陽光パネル設置
  - EV充電器設置
  - 幹線工事・受変電設備
  - 店舗・オフィス電気工事
対応エリア: 愛知全域・東京都・神奈川・埼玉・千葉
強み: 迅速対応・丁寧施工・電気工事士資格保有スタッフ`;

const MARUKEN_SERVICES_LIST = [
  'LED照明改修・省エネ工事',
  '電気設備新設・増設',
  '電気設備点検・保守',
  '太陽光パネル設置',
  'EV充電器設置',
  '幹線工事・受変電設備工事',
  '店舗・オフィス電気工事',
  '工場・倉庫電気工事',
  '緊急修理・トラブル対応',
  '定期保守契約',
];

// ─── プロパティ取得 ───────────────────────────────────────────
function getProps() {
  return PropertiesService.getScriptProperties();
}

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ─── Claude API ───────────────────────────────────────────────
function callClaude(systemPrompt, userPrompt, model, maxTokens) {
  const key = getProp('CLAUDE_API_KEY');
  if (!key) { Logger.log('❌ CLAUDE_API_KEY 未設定'); return null; }

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: maxTokens || 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    muteHttpExceptions: true,
  });

  try {
    const json = JSON.parse(res.getContentText());
    if (json.error) { Logger.log('Claude error: ' + JSON.stringify(json.error)); return null; }
    return json.content[0].text;
  } catch(e) {
    Logger.log('Claude parse error: ' + e + ' | response: ' + res.getContentText().substring(0, 300));
    return null;
  }
}

function callClaudeVision(base64Data, mimeType, userPrompt, model) {
  const key = getProp('CLAUDE_API_KEY');
  if (!key) { Logger.log('❌ CLAUDE_API_KEY 未設定'); return null; }

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    payload: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
          { type: 'text', text: userPrompt },
        ],
      }],
    }),
    muteHttpExceptions: true,
  });

  try {
    const json = JSON.parse(res.getContentText());
    if (json.error) { Logger.log('Claude Vision error: ' + JSON.stringify(json.error)); return null; }
    return json.content[0].text;
  } catch(e) {
    Logger.log('Claude Vision parse error: ' + e);
    return null;
  }
}

function callClaudeVisionJSON(base64Data, mimeType, userPrompt, model) {
  const text = callClaudeVision(base64Data, mimeType, userPrompt + '\nJSONのみで返答。説明文・コードブロック不要。', model);
  if (!text) return null;
  const raw = extractOutermostJson_(text);
  if (!raw) return null;
  try { return JSON.parse(sanitizeAndFixJson_(raw)); }
  catch(e) { Logger.log('Claude Vision JSON parse error: ' + e); return null; }
}

function callClaudeJSON(systemPrompt, userPrompt, model) {
  const text = callClaude(systemPrompt + '\n\nJSONのみで返答。説明文・コードブロック不要。', userPrompt, model);
  if (!text) return null;
  const raw = extractOutermostJson_(text);
  if (!raw) { Logger.log('Claude JSON not found in: ' + text.substring(0, 200)); return null; }
  try { return JSON.parse(sanitizeAndFixJson_(raw)); }
  catch(e) { Logger.log('Claude JSON parse error: ' + e); return null; }
}

// utils.gs 側で使う sanitize（Code_prospecting.gs の sanitizeJson_ と同等）
function sanitizeAndFixJson_(text) {
  var result = '';
  var inString = false;
  var escaped = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    var code = text.charCodeAt(i);
    if (escaped) { result += c; escaped = false; continue; }
    if (c === '\\') { result += c; escaped = true; continue; }
    if (c === '"') { inString = !inString; result += c; continue; }
    if (inString && code < 0x20) {
      if (c === '\t')      { result += '\\t'; }
      else if (c === '\n') { result += '\\n'; }
      else if (c === '\r') { result += '\\r'; }
      else { result += '\\u' + ('000' + code.toString(16)).slice(-4); }
      continue;
    }
    result += c;
  }
  return result.replace(/,(\s*[}\]])/g, '$1');
}

function extractOutermostJson_(text) {
  var start = text.indexOf('{');
  if (start === -1) return null;
  var depth = 0;
  var inStr = false;
  var esc = false;
  for (var i = start; i < text.length; i++) {
    var c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return null;
}

// ─── Grok API ─────────────────────────────────────────────────
function callGrok(systemPrompt, userPrompt, model) {
  const key = getProp('XAI_API_KEY');
  if (!key) { Logger.log('❌ XAI_API_KEY 未設定'); return null; }

  const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    payload: JSON.stringify({
      model: model || 'grok-3-mini-fast',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    }),
    muteHttpExceptions: true,
  });

  try {
    const json = JSON.parse(res.getContentText());
    return json.choices[0].message.content;
  } catch(e) {
    Logger.log('Grok API error: ' + e);
    return null;
  }
}

function callGrokVision(base64Data, mimeType, userPrompt, model) {
  const key = getProp('XAI_API_KEY');
  if (!key) throw new Error('XAI_API_KEY がスクリプトプロパティに未設定');

  const res = UrlFetchApp.fetch('https://api.x.ai/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    payload: JSON.stringify({
      model: model || 'grok-2-vision',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64Data } },
          { type: 'text', text: userPrompt },
        ],
      }],
      temperature: 0,
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log('Grok Vision HTTP: ' + code + ' | ' + body.substring(0, 400));

  if (code !== 200) {
    throw new Error('Grok Vision API HTTP ' + code + ': ' + body.substring(0, 200));
  }

  const json = JSON.parse(body);
  if (json.error) throw new Error('Grok Vision error: ' + JSON.stringify(json.error));
  return json.choices[0].message.content;
}

function callGrokVisionJSON(base64Data, mimeType, userPrompt, model) {
  const text = callGrokVision(base64Data, mimeType, userPrompt + '\nJSONのみで返答。余分なテキスト不要。', model);
  if (!text) throw new Error('Grok Vision: 応答が空でした');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Grok Vision: JSONが見つかりません。応答: ' + text.substring(0, 100));
  try { return JSON.parse(match[0]); }
  catch(e) { throw new Error('Grok Vision JSONパース失敗: ' + e); }
}

function callGrokJSON(systemPrompt, userPrompt, model) {
  const text = callGrok(systemPrompt + '\nJSONのみで返答。余分なテキスト不要。', userPrompt, model);
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch(e) { return null; }
}

// ─── LINE ─────────────────────────────────────────────────────
function sendLine(userId, text, quickReplyItems) {
  const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !userId) { Logger.log('❌ LINE設定不足'); return false; }

  const message = { type: 'text', text: text.substring(0, 5000) };
  if (quickReplyItems && quickReplyItems.length > 0) {
    message.quickReply = { items: quickReplyItems };
  }

  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [message] }),
    muteHttpExceptions: true,
  });

  Logger.log('LINE送信[' + userId.substring(0,8) + '...]: ' + res.getResponseCode());
  return res.getResponseCode() < 300;
}

function getManagerLineId() {
  const ids = getProp('LINE_USER_IDS') || '';
  const entry = ids.split(',').map(e => e.trim()).find(e => e.startsWith('manager:'));
  return entry ? entry.split(':')[1] : null;
}

function sendLineToManager(text, quickReplyItems) {
  const id = getManagerLineId();
  if (!id) { Logger.log('❌ manager LINE ID未設定'); return false; }
  return sendLine(id, text, quickReplyItems);
}

function lineQR(label, data) {
  return { type: 'action', action: { type: 'postback', label, data } };
}

// ─── Gmail ────────────────────────────────────────────────────
function createDraft(to, subject, body) {
  try {
    GmailApp.createDraft(to, subject, body + MARUKEN_SIGNATURE, { name: '株式会社マルケン電工' });
    return true;
  } catch(e) {
    Logger.log('下書き作成エラー: ' + e);
    return false;
  }
}

function sendEmail(to, subject, body) {
  try {
    GmailApp.sendEmail(to, subject, body + MARUKEN_SIGNATURE, { name: '株式会社マルケン電工' });
    return true;
  } catch(e) {
    Logger.log('メール送信エラー: ' + e);
    return false;
  }
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

// ─── Spreadsheet ──────────────────────────────────────────────
function getSheet(sheetIdKey, sheetName) {
  const id = getProp(sheetIdKey);
  if (!id) { Logger.log('❌ ' + sheetIdKey + ' 未設定'); return null; }
  try {
    const ss = SpreadsheetApp.openById(id);
    return sheetName ? (ss.getSheetByName(sheetName) || ss.getSheets()[0]) : ss.getSheets()[0];
  } catch(e) {
    Logger.log('Spreadsheet open error: ' + e);
    return null;
  }
}

function appendRow(sheet, values) {
  if (!sheet) return false;
  try {
    sheet.appendRow(values);
    return true;
  } catch(e) {
    Logger.log('appendRow error: ' + e);
    return false;
  }
}

// ─── ロギング ─────────────────────────────────────────────────
function agentLog(agentId, status, detail) {
  Logger.log('[' + agentId + '] ' + status + (detail ? ' | ' + detail : ''));
}

// ─── 日付ユーティリティ ───────────────────────────────────────
function today() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
}

function nowStr() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function daysAgo(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return d;
}

function daysBetween(d1, d2) {
  return Math.floor((new Date(d2) - new Date(d1)) / 86400000);
}

// ─── Google Drive OCR ─────────────────────────────────────────
// 画像をDriveにアップ→Google Docs変換でOCR→テキスト取得→一時ファイル削除
function ocrImageWithDrive(base64Data, mimeType) {
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType || 'image/jpeg', 'card_ocr.jpg');

  // Driveに画像をアップロード
  var imageFile = DriveApp.createFile(blob);
  var imageId   = imageFile.getId();

  try {
    // Drive APIでGoogle Docsにコピー（OCRが自動で走る）
    var docFile = Drive.Files.copy(
      { title: 'card_ocr_doc', mimeType: 'application/vnd.google-apps.document' },
      imageId,
      { ocr: true, ocrLanguage: 'ja' }
    );
    var docId = docFile.id;

    // Docsからテキスト取得
    var doc  = DocumentApp.openById(docId);
    var text = doc.getBody().getText();
    Logger.log('OCR結果: ' + text.substring(0, 200));

    // 一時ファイルを削除
    DriveApp.getFileById(imageId).setTrashed(true);
    DriveApp.getFileById(docId).setTrashed(true);

    return text;
  } catch(e) {
    // クリーンアップしてから再throw
    try { DriveApp.getFileById(imageId).setTrashed(true); } catch(_) {}
    throw new Error('Drive OCR失敗: ' + e.toString());
  }
}

// ─── テスト ───────────────────────────────────────────────────
function testUtils() {
  Logger.log('=== utils.gs テスト ===');
  Logger.log('今日: ' + today());
  Logger.log('Claude API key: ' + (getProp('CLAUDE_API_KEY') ? '✅' : '❌ 未設定'));
  Logger.log('Grok API key:   ' + (getProp('XAI_API_KEY') ? '✅' : '❌ 未設定'));
  Logger.log('LINE token:     ' + (getProp('LINE_CHANNEL_ACCESS_TOKEN') ? '✅' : '❌ 未設定'));
  Logger.log('LINE manager:   ' + (getManagerLineId() ? '✅' : '❌ 未設定'));
  Logger.log('=== テスト完了 ===');
}
