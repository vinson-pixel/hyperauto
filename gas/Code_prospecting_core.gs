// ─── 営業リスト管理（リード発掘・メール送信） ──────────────────────

var PROSPECT_SS_ID     = '1CH-kXnv49mxjXYYOPczOoRC7ioMjy_WckEH_IegrRHg';
var PROSPECT_SHEET_GID = 1022515681;

// 列構成（20列）— 営業フロー順: 会社基本→ステージ/スコア→連絡先→活動記録→メモ→管理
var PC = {
  COMPANY:      1,  // A: 会社名
  INDUSTRY:     2,  // B: 業種
  PREF:         3,  // C: 所在地
  STAGE:        4,  // D: ステージ
  AI_SCORE:     5,  // E: AIスコア（1-10）
  TOP_PRODUCT:  6,  // F: 推奨商材
  CONTACT:      7,  // G: 担当者名
  ROLE:         8,  // H: 役職
  DIRECT_PHONE: 9,  // I: 担当者直電
  PHONE:        10, // J: 電話番号（代表）
  EMAIL:        11, // K: メールアドレス
  URL:          12, // L: URL
  CALL_COUNT:   13, // M: 架電回数
  CALL_DATE:    14, // N: 最終架電日
  APO:          15, // O: アポ日時
  MEMO:         16, // P: メモ
  SOURCE:       17, // Q: 流入経路
  LIST_TYPE:    18, // R: リスト種別
  CORP_NUM:     19, // S: 法人番号（T番号）
  CONTACTS:     20, // T: 担当者リスト（JSON）
  CAPITAL:      21, // U: 資本金
};

var PROSPECT_HEADERS = [
  '会社名','業種','所在地','ステージ','AIスコア','推奨商材',
  '担当者名','役職','担当者直電','電話番号','メールアドレス','URL',
  '架電回数','最終架電日','アポ日時','メモ',
  '流入経路','リスト種別','法人番号','担当者リスト','資本金'
];

// Date/文字列 → "yyyy/MM/dd HH:mm" or "yyyy/MM/dd" に正規化
function formatSheetDate_(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date && !isNaN(val)) {
    var hm = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
    var ymd = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy/MM/dd');
    return hm === '00:00' ? ymd : ymd + ' ' + hm;
  }
  var s = String(val);
  // ISO: 2026-05-19T23:00:00.000Z → JST
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try {
      var d = new Date(s);
      if (!isNaN(d)) {
        var jst = new Date(d.getTime() + 9 * 3600000);
        var ymdStr = jst.getFullYear() + '/' + String(jst.getMonth()+1).padStart(2,'0') + '/' + String(jst.getDate()).padStart(2,'0');
        var hmStr  = String(jst.getHours()).padStart(2,'0') + ':' + String(jst.getMinutes()).padStart(2,'0');
        return hmStr === '00:00' ? ymdStr : ymdStr + ' ' + hmStr;
      }
    } catch(e) {}
  }
  return s;
}

// 会社名正規化（株式会社等を除去してデュープ判定に使用）
function normalizeCompanyName_(name) {
  return String(name || '')
    .replace(/^(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|医療法人|学校法人|\(株\)|\(有\)|（株）|（有）|㈱|㈲)/g, '')
    .replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\)|（株）|（有）|㈱|㈲)$/g, '')
    .replace(/[　\s・\-（）()\[\]【】]/g, '')
    .toLowerCase()
    .trim();
}

// （株）など略称を正式社名に展開（新規追加・変換時に使用）
function expandCompanyAbbr_(name) {
  return String(name || '').trim()
    .replace(/^（株）/, '株式会社').replace(/（株）$/, '株式会社')
    .replace(/^（有）/, '有限会社').replace(/（有）$/, '有限会社')
    .replace(/^㈱/,    '株式会社').replace(/㈱$/,    '株式会社')
    .replace(/^㈲/,    '有限会社').replace(/㈲$/,    '有限会社')
    .replace(/^\(株\)/, '株式会社').replace(/\(株\)$/, '株式会社')
    .replace(/^\(有\)/, '有限会社').replace(/\(有\)$/, '有限会社');
}

// メモ欄に入っている住所をすべて所在地（PREF=col3）に移行し、メモから除去
function migrateAddressFromMemo() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { ok: true, updated: 0 };

  var cols = Math.max(sheet.getLastColumn(), 21);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();

  // 都道府県リスト（住所行の検出に使用）
  var prefRe = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;
  var postalRe = /^〒?\d{3}-?\d{4}\s*/;

  var updated = 0;
  var batchSize = 50;

  for (var i = 0; i < data.length; i++) {
    var memo = String(data[i][PC.MEMO - 1] || '').trim();
    var pref = String(data[i][PC.PREF - 1] || '').trim();
    var company = String(data[i][PC.COMPANY - 1] || '').trim();
    if (!company || !memo) continue;
    // 既にフル住所が入っている行はスキップ（6文字超 = 都道府県+市以上）
    if (pref.length > 6) continue;

    // メモから住所行を探す（郵便番号 or 都道府県で始まる行）
    var lines = memo.split('\n');
    var addrIdx = -1;
    var addrClean = '';
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j].trim();
      if (!line) continue;
      var isAddr = postalRe.test(line) || prefRe.test(line);
      if (isAddr) {
        addrClean = line.replace(postalRe, '').trim(); // 郵便番号を除去
        addrIdx = j;
        break;
      }
    }
    if (addrIdx < 0 || !addrClean) continue;

    // PREF列に住所を書き込み
    sheet.getRange(i + 2, PC.PREF).setValue(addrClean);
    // メモから住所行を除去
    lines.splice(addrIdx, 1);
    var newMemo = lines.join('\n').trim();
    sheet.getRange(i + 2, PC.MEMO).setValue(newMemo);
    updated++;
    if (updated % batchSize === 0) Utilities.sleep(200);
  }
  return { ok: true, updated: updated };
}

// 営業リスト＋顧客管理の会社名略称を一括で正式表記に変換
function convertCompanyNameFormats() {
  var converted = 0;

  var sheet = getProspectSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, PC.COMPANY, lastRow - 1, 1).getValues();
    var updates = [];
    data.forEach(function(row, i) {
      var orig = String(row[0] || '').trim();
      var norm = expandCompanyAbbr_(orig);
      if (norm !== orig) { updates.push({ r: i + 2, v: norm }); }
    });
    updates.forEach(function(u) { sheet.getRange(u.r, PC.COMPANY).setValue(u.v); converted++; });
  }

  var custSheet = getCustomerSheet_();
  var custLast = custSheet.getLastRow();
  if (custLast > 1) {
    var custData = custSheet.getRange(2, CC.COMPANY, custLast - 1, 1).getValues();
    var custUpdates = [];
    custData.forEach(function(row, i) {
      var orig = String(row[0] || '').trim();
      var norm = expandCompanyAbbr_(orig);
      if (norm !== orig) { custUpdates.push({ r: i + 2, v: norm }); }
    });
    custUpdates.forEach(function(u) { custSheet.getRange(u.r, CC.COMPANY).setValue(u.v); converted++; });
  }

  return { ok: true, converted: converted };
}

// 会社URLをスクレイピングして資本金を取得、不明ならClaude fallback
function fetchCapital_(companyName, url, industry) {
  if (url) {
    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      var html = resp.getContentText();
      var m = html.match(/資本金[^\d０-９万億]*([0-9０-９,，]+\s*[万億千百]?\s*円)/);
      if (m) return m[1].replace(/\s/g, '');
      // 会社概要ページを探す
      var ovMatch = html.match(/href="([^"]*(?:gaiyou|kaisha|company|about|corporate|profile|overview)[^"]*)"/i);
      if (ovMatch) {
        var ovHref = ovMatch[1];
        if (!ovHref.match(/^https?:\/\//)) {
          var baseMatch = url.match(/^(https?:\/\/[^\/]+)/);
          var base = baseMatch ? baseMatch[1] : url;
          var dirBase = url.replace(/\/[^\/]*$/, '/');
          ovHref = ovHref.charAt(0) === '/' ? base + ovHref : dirBase + ovHref;
        }
        var html2 = UrlFetchApp.fetch(ovHref, { muteHttpExceptions: true }).getContentText();
        m = html2.match(/資本金[^\d０-９万億]*([0-9０-９,，]+\s*[万億千百]?\s*円)/);
        if (m) return m[1].replace(/\s/g, '');
      }
    } catch(e) { Logger.log('fetchCapital scrape: ' + e); }
  }

  // Claude fallback（学習データから）
  var text = callClaude(
    '会社の資本金を答えてください。金額のみ返してください（例: 1,000万円）。不明なら空文字を返してください。説明不要。',
    '会社名: ' + companyName + (industry ? '\n業種: ' + industry : ''),
    'claude-haiku-4-5-20251001', 64
  );
  if (!text) return '';
  var m2 = text.match(/([0-9０-９,，]+\s*[万億千百]?\s*円)/);
  return m2 ? m2[1].replace(/\s/g, '') : '';
}

// 資本金が空の行を一括取得（最大件数を指定して実行時間を制御）
function enrichCapitals(maxRows) {
  maxRows = maxRows || 30;
  var sheet = getProspectSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { ok: true, updated: 0 };
  var cols = Math.max(sheet.getLastColumn(), 21);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var updated = 0;
  for (var i = 0; i < data.length && updated < maxRows; i++) {
    var company = String(data[i][PC.COMPANY  - 1] || '').trim();
    if (!company) continue;
    if (String(data[i][PC.CAPITAL - 1] || '').trim()) continue;
    var url      = String(data[i][PC.URL      - 1] || '').trim();
    var industry = String(data[i][PC.INDUSTRY - 1] || '').trim();
    var capital = fetchCapital_(company, url, industry);
    if (capital) {
      sheet.getRange(i + 2, PC.CAPITAL).setValue(capital);
      updated++;
    }
    Utilities.sleep(300);
  }
  return { ok: true, updated: updated };
}

// 指定行の空フィールドを一括補完（URL・電話・業種・資本金）
function enrichRowIfEmpty(rowIndex) {
  var sheet = getProspectSheet_();
  var cols = Math.max(sheet.getLastColumn(), 21);
  var row = sheet.getRange(rowIndex, 1, 1, cols).getValues()[0];

  var company  = String(row[PC.COMPANY  - 1] || '').trim();
  if (!company) return { ok: false, error: '会社名なし' };

  var url      = String(row[PC.URL      - 1] || '').trim();
  var phone    = String(row[PC.PHONE    - 1] || '').trim();
  var industry = String(row[PC.INDUSTRY - 1] || '').trim();
  var pref     = String(row[PC.PREF     - 1] || '').trim();
  var capital  = String(row[PC.CAPITAL  - 1] || '').trim();

  var changes = {};

  // URL・電話・住所が両方空なら Places API で補完
  if (!url || !phone) {
    try {
      var sr = searchPlaces(company, pref || '愛知県', 3);
      var match = null;
      if (sr.results && sr.results.length > 0) {
        var norm = normalizeCompanyName_(company);
        match = sr.results[0]; // 1件目を採用（同名があれば）
        for (var i = 0; i < sr.results.length; i++) {
          if (normalizeCompanyName_(sr.results[i].name) === norm) { match = sr.results[i]; break; }
        }
        if (!url && match.website) { sheet.getRange(rowIndex, PC.URL).setValue(match.website); url = match.website; changes.url = match.website; }
        if (!phone && match.phone) { sheet.getRange(rowIndex, PC.PHONE).setValue(match.phone);                       changes.phone = match.phone; }
        if (!pref && match.pref)   { sheet.getRange(rowIndex, PC.PREF).setValue(match.pref);                        changes.pref = match.pref; }
      }
    } catch(e) { Logger.log('enrichRow Places: ' + e); }
    Utilities.sleep(200);
  }

  // 資本金が空なら補完
  if (!capital) {
    var newCap = fetchCapital_(company, url, industry);
    if (newCap) { sheet.getRange(rowIndex, PC.CAPITAL).setValue(newCap); changes.capital = newCap; }
  } else { changes.capital = capital; }

  return { ok: true, changes: changes };
}

// 資本金のみを指定行に補完（開いた瞬間バックグラウンド用）
function enrichCapitalForRow(rowIndex) {
  var sheet = getProspectSheet_();
  var cols = Math.max(sheet.getLastColumn(), 21);
  var row = sheet.getRange(rowIndex, 1, 1, cols).getValues()[0];
  var existing = String(row[PC.CAPITAL - 1] || '').trim();
  if (existing) return { ok: true, capital: existing, updated: false };
  var company  = String(row[PC.COMPANY  - 1] || '').trim();
  if (!company) return { ok: false, error: '会社名なし' };
  var url      = String(row[PC.URL      - 1] || '').trim();
  var industry = String(row[PC.INDUSTRY - 1] || '').trim();
  var capital = fetchCapital_(company, url, industry);
  if (capital) {
    sheet.getRange(rowIndex, PC.CAPITAL).setValue(capital);
    return { ok: true, capital: capital, updated: true };
  }
  return { ok: true, capital: '', updated: false };
}

// 法人番号を T1-2345-6789-0123 形式にフォーマット
function formatCorpNum_(num) {
  var s = String(num).replace(/[T\-\s]/gi, '');
  if (s.length !== 13) return 'T' + s;
  return 'T' + s[0] + '-' + s.slice(1,5) + '-' + s.slice(5,9) + '-' + s.slice(9,13);
}

// 国税庁API で会社名から法人番号を検索
function lookupCorpNum_(companyName) {
  var appId = getProp('NTA_APP_ID');
  if (!appId) return null;
  try {
    var url = 'https://api.houjin-bangou.nta.go.jp/4/name'
      + '?id=' + encodeURIComponent(appId)
      + '&name=' + encodeURIComponent(companyName)
      + '&type=12&mode=2&target=1&address=0&kind=01&change=0&close=1&divide=1&unitType=00';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var lines = res.getContentText('UTF-8').split('\n');
    // 1行目=ヘッダー, 2行目=最初のデータ
    if (lines.length < 2 || !lines[1].trim()) return null;
    var fields = lines[1].split(',');
    var raw = (fields[1] || '').replace(/"/g,'').trim();
    return raw.length === 13 ? formatCorpNum_(raw) : null;
  } catch(e) { return null; }
}

// 法人番号を一括補完（NTA_APP_ID が設定されている場合のみ動作）
function autoFillCorpNum() {
  var appId = getProp('NTA_APP_ID');
  if (!appId) return { error: 'NTA_APP_ID がスクリプトプロパティに未設定です。国税庁Web-APIに登録して設定してください。' };
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { filled: 0, message: 'データなし' };
  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var filled = 0;
  var duplicates = 0;
  var knownNums = {};

  // 既存の法人番号を収集（重複検出用）
  data.forEach(function(row) {
    var cn = String(row[PC.CORP_NUM - 1] || '').trim();
    if (cn) knownNums[cn] = true;
  });

  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY - 1] || '').trim();
    var existing = String(row[PC.CORP_NUM - 1] || '').trim();
    if (!company || existing) return;
    Utilities.sleep(500);
    var num = lookupCorpNum_(company);
    if (!num) return;
    if (knownNums[num]) {
      // 重複: メモに注記
      var memo = String(row[PC.MEMO - 1] || '');
      sheet.getRange(idx + 2, PC.MEMO).setValue(memo + '\n[重複法人番号: ' + num + ']');
      duplicates++;
      return;
    }
    sheet.getRange(idx + 2, PC.CORP_NUM).setValue(num);
    knownNums[num] = true;
    filled++;
  });
  return { filled: filled, duplicates: duplicates, message: filled + '社の法人番号を補完、' + duplicates + '社の重複を検出' };
}

function getProspectSheet_() {
  var ss = SpreadsheetApp.openById(PROSPECT_SS_ID);
  return getSheetByGid_(ss, PROSPECT_SHEET_GID);
}

// ── 手動追加 ────────────────────────────────────────────────────────
function saveManualProspect(data) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  if (!data || !data.company) return { error: '会社名は必須です' };

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var nm = normalizeCompanyName_(data.company);
    for (var i = 0; i < existing.length; i++) {
      if (normalizeCompanyName_(String(existing[i][0])) === nm) {
        return { duplicate: true, existing: String(existing[i][0]) };
      }
    }
  }

  var row = new Array(21).fill('');
  row[PC.COMPANY  - 1] = expandCompanyAbbr_(data.company);
  row[PC.INDUSTRY - 1] = (data.industry || '').slice(0, 20);
  row[PC.PREF     - 1] = data.pref     || '';
  row[PC.STAGE    - 1] = '未架電';
  row[PC.CONTACT  - 1] = data.contact  || '';
  row[PC.PHONE    - 1] = data.phone    || '';
  row[PC.EMAIL    - 1] = data.email    || '';
  row[PC.URL      - 1] = data.url      || '';
  row[PC.CALL_COUNT-1] = 0;
  row[PC.MEMO     - 1] = data.memo     || '';
  row[PC.SOURCE   - 1] = 'manual';
  row[PC.LIST_TYPE- 1] = '営業';

  sheet.appendRow(row);
  return { success: true, company: row[PC.COMPANY - 1] };
}

// ─── 旧→新 スプレッドシート移行 ─────────────────────────────────

function migrateProspectSheet() {
  var sheet   = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: 'データがありません' };

  // 二重実行防止：1行目1列目が「会社名」なら新形式なので中断
  var firstHeader = String(sheet.getRange(1, 1).getValue()).trim();
  if (firstHeader === '会社名') {
    return { error: '既に新形式です。元データに戻してから実行してください。' };
  }

  // 旧データを全読み込み（21列）
  var oldData = sheet.getRange(2, 1, lastRow - 1, 21).getValues();

  var newRows = [];
  var seen    = {};

  oldData.forEach(function(r) {
    var company = String(r[2] || '').trim(); // 旧C: 会社名
    if (!company || seen[company]) return;
    seen[company] = true;

    // 担当者名 + 役職を結合
    var contact = String(r[3] || '').trim();
    var title   = String(r[4] || '').trim();
    var contactFull = contact && title ? contact + '（' + title + '）'
                    : contact || title || '';

    // アポ日時を結合
    var apoRaw  = r[9];
    var apoDate = apoRaw instanceof Date && !isNaN(apoRaw.getTime())
      ? Utilities.formatDate(apoRaw, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(apoRaw || '').replace(/未定/g, '').trim();
    var apoTime = String(r[10] || '').trim();
    var apo     = apoDate && apoTime ? apoDate + ' ' + apoTime
                : apoDate || (apoTime ? '日時未定 ' + apoTime : '');

    // メモを統合（メモ + 架電結果 + 所感 + 断り理由 + 優先度 + メールログ）
    var parts = [
      r[7],  // H: メモ
      r[12], // M: 架電結果
      r[17], // R: 所感
      r[15] ? '断り理由: ' + r[15] : '', // P: 断り理由
      r[14] ? '優先度: '   + r[14] : '', // O: 優先度
      r[20] ? 'メール: '   + r[20] : '', // U: メールログ
    ].map(String).filter(function(s){ return s.trim(); });
    var memo = parts.join(' / ');

    // ステージ正規化
    var stage = String(r[11] || '').trim();
    var stageMap = {
      'アポ確定':     'アポ確定',
      'アプローチ中': 'アプローチ中',
      '失注':         '失注',
      '保留':         '保留',
      'リスト':       '未架電',
    };
    stage = stageMap[stage] || (stage ? 'アプローチ中' : '未架電');

    // 架電日（Dateなら整形）
    var callRaw     = r[1];
    var callDateStr = callRaw instanceof Date && !isNaN(callRaw.getTime())
      ? Utilities.formatDate(callRaw, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(callRaw || '').trim();

    newRows.push([
      company,              // A: 会社名
      contactFull,          // B: 担当者名
      String(r[5] || ''),   // C: 電話番号
      String(r[8] || ''),   // D: メールアドレス
      String(r[6] || ''),   // E: URL
      String(r[16] || ''),  // F: 業種
      String(r[18] || ''),  // G: 所在地
      String(r[19] || ''),  // H: 流入経路
      stage,                // I: ステージ
      parseInt(r[13]) || 0, // J: 架電回数
      callDateStr,          // K: 最終架電日
      apo,                  // L: アポ日時
      memo,                 // M: メモ
    ]);
  });

  // シートを完全にクリア（入力規則・書式・内容すべて）
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.getRange(1, 1, 1, PROSPECT_HEADERS.length).setValues([PROSPECT_HEADERS]);
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, 13).setValues(newRows);
  }

  // 架電回数列を数値フォーマットに
  if (newRows.length > 0) {
    sheet.getRange(2, PC.CALL_COUNT, newRows.length, 1).setNumberFormat('0');
  }

  // ヘッダー行を太字に
  sheet.getRange(1, 1, 1, PROSPECT_HEADERS.length).setFontWeight('bold');

  return { migrated: newRows.length, message: newRows.length + '社のデータを新形式に移行しました' };
}

