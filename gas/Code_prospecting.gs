// ─── 営業リスト管理（リード発掘・メール送信） ──────────────────────

var PROSPECT_SS_ID     = '1CH-kXnv49mxjXYYOPczOoRC7ioMjy_WckEH_IegrRHg';
var PROSPECT_SHEET_GID = 1022515681;

// 列構成（14列）
var PC = {
  COMPANY:    1,  // A: 会社名
  CONTACT:    2,  // B: 担当者名（役職込み）
  PHONE:      3,  // C: 電話番号
  EMAIL:      4,  // D: メールアドレス
  URL:        5,  // E: URL
  INDUSTRY:   6,  // F: 業種
  PREF:       7,  // G: 所在地
  SOURCE:     8,  // H: 流入経路
  STAGE:      9,  // I: ステージ
  CALL_COUNT: 10, // J: 架電回数
  CALL_DATE:  11, // K: 最終架電日
  APO:        12, // L: アポ日時
  MEMO:       13, // M: メモ
  CORP_NUM:   14, // N: 法人番号（T番号）
};

var PROSPECT_HEADERS = [
  '会社名','担当者名','電話番号','メールアドレス','URL',
  '業種','所在地','流入経路','ステージ','架電回数','最終架電日','アポ日時','メモ','法人番号'
];

// 会社名正規化（株式会社等を除去してデュープ判定に使用）
function normalizeCompanyName_(name) {
  return String(name || '')
    .replace(/^(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|医療法人|学校法人|\(株\)|\(有\))/g, '')
    .replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\))$/g, '')
    .replace(/[　\s・\-（）()\[\]【】]/g, '')
    .toLowerCase()
    .trim();
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
  var data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
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
  sheet.getRange(1, 1, 1, 13).setValues([PROSPECT_HEADERS]);
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, 13).setValues(newRows);
  }

  // 架電回数列を数値フォーマットに
  if (newRows.length > 0) {
    sheet.getRange(2, PC.CALL_COUNT, newRows.length, 1).setNumberFormat('0');
  }

  // ヘッダー行を太字に
  sheet.getRange(1, 1, 1, 13).setFontWeight('bold');

  return { migrated: newRows.length, message: newRows.length + '社のデータを新形式に移行しました' };
}

// ─── 検索（Maps / Web 統合） ────────────────────────────────────

function generateQueryVariations(keyword, area) {
  var text = callClaude(
    '検索クエリ生成。JSON配列のみ出力。説明不要。',
    'キーワード「' + keyword + '」でBtoB会社リストを探す際の言い換え・関連業種バリエーションを5つ生成。\n' +
    'エリア: ' + (area || '日本全国') + '\n' +
    '例 "設計事務所"→["建築設計事務所","構造設計事務所","インテリアデザイン","建築士事務所","設計コンサル"]\n' +
    'JSON配列のみ: ["変形1","変形2","変形3","変形4","変形5"]',
    'claude-haiku-4-5', 150
  );
  if (!text) return [];
  var match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]).slice(0, 5).filter(function(s){ return typeof s === 'string'; }); }
  catch(e) { return []; }
}

function searchPlacesWithPagination(keyword, area, maxPerQuery) {
  var apiKey = getProp('MAPS_API_KEY');
  if (!apiKey) return { error: 'MAPS_API_KEY未設定', results: [] };
  var places = [];
  var nextToken = null;

  for (var page = 0; page < 3 && places.length < (maxPerQuery || 60); page++) {
    try {
      var body = {
        textQuery: (keyword + (area ? ' ' + area : '')).trim(),
        languageCode: 'ja',
        regionCode: 'JP',
        maxResultCount: 20
      };
      if (nextToken) body.pageToken = nextToken;
      var res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,nextPageToken'
        },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });
      var data = JSON.parse(res.getContentText());
      if (data.error) break;
      (data.places || []).forEach(function(p) {
        var addr = p.formattedAddress || '';
        places.push({ name: (p.displayName || {}).text || '', address: addr, phone: p.nationalPhoneNumber || '', website: p.websiteUri || '', pref: extractPref_(addr), industry: keyword });
      });
      nextToken = data.nextPageToken || null;
      if (!nextToken) break;
      Utilities.sleep(2000);
    } catch(e) { break; }
  }
  return { results: places };
}

// エリアをサブ市区町村に分割（県単位 → 主要都市リスト）
function getSubAreas_(area) {
  if (!area) return [];
  var subAreaMap = {
    '愛知': ['名古屋市','豊田市','岡崎市','一宮市','豊橋市','春日井市','安城市'],
    '愛知県': ['名古屋市','豊田市','岡崎市','一宮市','豊橋市','春日井市','安城市'],
    '東京': ['渋谷区','新宿区','港区','品川区','目黒区','千代田区','中央区'],
    '東京都': ['渋谷区','新宿区','港区','品川区','目黒区','千代田区','中央区'],
    '大阪': ['大阪市','堺市','東大阪市','豊中市','吹田市','高槻市'],
    '大阪府': ['大阪市','堺市','東大阪市','豊中市','吹田市','高槻市'],
    '神奈川': ['横浜市','川崎市','相模原市','藤沢市','横須賀市'],
    '神奈川県': ['横浜市','川崎市','相模原市','藤沢市','横須賀市'],
    '埼玉': ['さいたま市','川口市','越谷市','所沢市','川越市'],
    '埼玉県': ['さいたま市','川口市','越谷市','所沢市','川越市'],
  };
  return subAreaMap[area] || [];
}

// ─── 一時修正: 会社名を検索して更新 ────────────────────────────────
function fixCompanyName_sekku() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === '株式会社セック') {
      sheet.getRange(i + 1, PC.COMPANY).setValue('セック株式会社');
      Logger.log('Row ' + (i + 1) + ' → セック株式会社 に更新');
      return;
    }
  }
  Logger.log('株式会社セック が見つからなかった');
}

function searchLeads(keyword, area, source, maxResults, quick) {
  var combined = [];
  var seen = {};
  var errors = [];
  var addAll = function(arr) {
    (arr || []).forEach(function(p) {
      var key = String(p.name || '').toLowerCase().replace(/[\s　]/g, '');
      if (key && !seen[key]) { seen[key] = true; combined.push(p); }
    });
  };

  if (quick) {
    var r1 = searchPlaces(keyword, area, 20);
    if (!r1.error) addAll(r1.results); else errors.push('Maps: ' + r1.error);
  } else {
    // Deep: AI variations + pagination + sub-area splits
    var variations = generateQueryVariations(keyword, area);
    var rp = searchPlacesWithPagination(keyword, area, 60);
    if (!rp.error) addAll(rp.results); else errors.push('Maps: ' + rp.error);
    variations.forEach(function(q) {
      Utilities.sleep(300);
      var r = searchPlaces(q, area, 20);
      if (!r.error) addAll(r.results);
    });
    var subAreas = getSubAreas_(area);
    for (var i = 0; i < subAreas.length; i++) {
      Utilities.sleep(300);
      var sr = searchPlaces(keyword, subAreas[i], 20);
      if (!sr.error) addAll(sr.results);
    }
  }

  if (!combined.length) {
    var msg = errors.length ? errors.join(' / ') : '検索結果が0件でした（キーワードを変えてみてください）';
    return { error: msg };
  }
  return { results: combined };
}

// Google Custom Search（Web検索）
function searchWeb(keyword, area, maxResults) {
  maxResults = maxResults || 10;
  var apiKey = getProp('MAPS_API_KEY');
  var cx     = getProp('SEARCH_CX_ID');
  if (!apiKey) return { error: 'MAPS_API_KEY がスクリプトプロパティに未設定です。' };
  if (!cx)     return { error: 'SEARCH_CX_ID がスクリプトプロパティに未設定です。' };

  var query = encodeURIComponent(keyword + ' ' + area + ' 会社');
  var url = 'https://www.googleapis.com/customsearch/v1'
    + '?key=' + apiKey + '&cx=' + cx
    + '&q=' + query + '&num=' + Math.min(maxResults, 10) + '&lr=lang_ja';

  try {
    var res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    if (data.error) return { error: 'Custom Search APIエラー: ' + data.error.message };

    var places = (data.items || []).map(function(item) {
      return {
        name:     item.title.replace(/\s*[\|－\-].*$/, '').trim(),
        address:  item.snippet || '',
        phone:    '',
        website:  item.link,
        pref:     extractPref_(item.snippet || item.title || ''),
        industry: keyword,
      };
    });
    return { results: places };
  } catch(e) {
    return { error: e.toString() };
  }
}

// Google Maps検索（Places API New）
function searchPlaces(keyword, area, maxResults) {
  maxResults = maxResults || 20;
  var apiKey = getProp('MAPS_API_KEY');
  if (!apiKey) return { error: 'MAPS_API_KEY がスクリプトプロパティに未設定です。' };

  try {
    var body = {
      textQuery: (keyword + (area ? ' ' + area : '')).trim(),
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: Math.min(maxResults, 20)
    };
    var res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.error) {
      return { error: 'Places API: ' + (data.error.message || JSON.stringify(data.error)) };
    }
    var places = (data.places || []).map(function(p) {
      var addr = p.formattedAddress || '';
      return { name: (p.displayName || {}).text || '', address: addr, phone: p.nationalPhoneNumber || '', website: p.websiteUri || '', pref: extractPref_(addr), industry: keyword };
    });
    return { results: places };
  } catch(e) {
    return { error: 'Maps fetch失敗: ' + e.toString() };
  }
}

// APIキー動作確認（GASエディタから手動実行してログで確認）
function diagSearchApis() {
  var mapsKey = getProp('MAPS_API_KEY');
  var cx      = getProp('SEARCH_CX_ID');
  Logger.log('MAPS_API_KEY: ' + (mapsKey ? '✅ 設定済 (' + mapsKey.slice(0,8) + '...)' : '❌ 未設定'));
  Logger.log('SEARCH_CX_ID: ' + (cx ? '✅ 設定済' : '❌ 未設定（Web検索は無効）'));
  Logger.log('Places API (New) を使用中');
  if (mapsKey) {
    var r = searchPlaces('設計事務所', '愛知県', 3);
    if (r.error) {
      Logger.log('Maps テスト: ❌ ' + r.error);
      Logger.log('→ Google Cloud ConsoleでPlaces API (New)を有効化してください');
    } else {
      Logger.log('Maps テスト: ✅ ' + (r.results||[]).length + '件');
      (r.results || []).slice(0, 3).forEach(function(p) { Logger.log('  - ' + p.name + ' / ' + p.address); });
    }
  }
}

function extractPref_(text) {
  var prefs = ['北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬',
    '埼玉','千葉','東京','神奈川','新潟','富山','石川','福井','山梨','長野',
    '岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山',
    '鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡',
    '佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'];
  for (var i = 0; i < prefs.length; i++) {
    if (text.indexOf(prefs[i]) !== -1) return prefs[i];
  }
  return '';
}

// ─── リスト操作 ─────────────────────────────────────────────────

function addProspects(places) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };

  // ヘッダーがなければ追加
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 14).setValues([PROSPECT_HEADERS]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
  }

  var lastRow = sheet.getLastRow();
  var added = 0, skipped = 0;

  // 重複チェック: T番号優先 → 正規化社名フォールバック
  var existingCorpNums = {};
  var existingNormNames = {};
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
    existing.forEach(function(row) {
      var cn = String(row[PC.CORP_NUM - 1] || '').trim();
      var nm = normalizeCompanyName_(String(row[PC.COMPANY - 1] || ''));
      if (cn) existingCorpNums[cn] = true;
      if (nm) existingNormNames[nm] = true;
    });
  }

  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    if (!p.name) continue;
    var cn = String(p.corpNum || '').trim();
    var nm = normalizeCompanyName_(p.name);
    if ((cn && existingCorpNums[cn]) || existingNormNames[nm]) { skipped++; continue; }

    var row = new Array(14).fill('');
    row[PC.COMPANY   - 1] = p.name;
    row[PC.PHONE     - 1] = p.phone    || '';
    row[PC.URL       - 1] = p.website  || '';
    row[PC.INDUSTRY  - 1] = (p.industry || '').slice(0, 20);
    row[PC.PREF      - 1] = p.pref     || '';
    row[PC.SOURCE    - 1] = 'リード発掘';
    row[PC.STAGE     - 1] = '未架電';
    row[PC.CALL_COUNT- 1] = 0;
    row[PC.MEMO      - 1] = p.address  || '';
    row[PC.CORP_NUM  - 1] = cn;

    sheet.appendRow(row);
    if (cn) existingCorpNums[cn] = true;
    existingNormNames[nm] = true;
    lastRow++;
    added++;
  }
  return { added: added, skipped: skipped };
}

function getProspects(limit) {
  limit = limit || 100;
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var cols = Math.max(sheet.getLastColumn(), 14);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var result = [];

  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY - 1] || '').trim();
    if (!company) return;
    result.push({
      rowIndex:   idx + 2,
      company:    company,
      contact:    row[PC.CONTACT    - 1],
      phone:      row[PC.PHONE      - 1],
      email:      row[PC.EMAIL      - 1],
      url:        row[PC.URL        - 1],
      industry:   row[PC.INDUSTRY   - 1],
      pref:       row[PC.PREF       - 1],
      source:     row[PC.SOURCE     - 1],
      stage:      row[PC.STAGE      - 1],
      callCount:  row[PC.CALL_COUNT - 1],
      callDate:   row[PC.CALL_DATE  - 1],
      apo:        row[PC.APO        - 1],
      memo:       row[PC.MEMO       - 1],
      corpNum:    row[PC.CORP_NUM   - 1] || '',
    });
  });
  return result.slice(-limit).reverse();
}

// ─── 架電記録 ────────────────────────────────────────────────────

function logCallResult(rowIndex, result, notes) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var cur   = parseInt(sheet.getRange(rowIndex, PC.CALL_COUNT).getValue() || 0);

  sheet.getRange(rowIndex, PC.CALL_DATE).setValue(today);
  sheet.getRange(rowIndex, PC.CALL_COUNT).setNumberFormat('0');
  sheet.getRange(rowIndex, PC.CALL_COUNT).setValue(cur + 1);

  // ステージ更新
  if (result === 'アポ取れた') sheet.getRange(rowIndex, PC.STAGE).setValue('アポ確定');
  if (result === 'NG')         sheet.getRange(rowIndex, PC.STAGE).setValue('失注');
  if (result === '興味あり')   sheet.getRange(rowIndex, PC.STAGE).setValue('興味あり');
  if (result === '商談中')     sheet.getRange(rowIndex, PC.STAGE).setValue('商談中');
  if (result === '追い中')     sheet.getRange(rowIndex, PC.STAGE).setValue('追い中');
  if (result === '受注')       sheet.getRange(rowIndex, PC.STAGE).setValue('受注');

  // メモに追記
  var cur_memo = String(sheet.getRange(rowIndex, PC.MEMO).getValue() || '');
  var entry    = today + '【' + result + '】' + (notes ? ' ' + notes : '');
  sheet.getRange(rowIndex, PC.MEMO).setValue(cur_memo ? cur_memo + '\n' + entry : entry);

  return { success: true, callCount: cur + 1 };
}

// ─── シート整理 ─────────────────────────────────────────────────

function cleanProspectSheet() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { deleted: 0, message: '対象なし' };

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var seen = {};
  var toDelete = [];

  for (var i = data.length - 1; i >= 0; i--) {
    var company = String(data[i][PC.COMPANY - 1] || '').trim();
    if (!company) {
      toDelete.push(i + 2);
    } else if (seen[company]) {
      toDelete.push(i + 2);
    } else {
      seen[company] = true;
    }
  }
  toDelete.sort(function(a,b){return b-a;});
  toDelete.forEach(function(r){ sheet.deleteRow(r); });

  // 架電回数列のフォーマットを数値に修正
  var newLast = sheet.getLastRow();
  if (newLast > 1) sheet.getRange(2, PC.CALL_COUNT, newLast - 1, 1).setNumberFormat('0');

  return { deleted: toDelete.length, message: toDelete.length + '行削除しました' };
}

// ─── 一括整理 ────────────────────────────────────────────────────
function bulkCleanup() {
  var log = [];

  // 1. 空行・重複削除
  var r1 = cleanProspectSheet();
  log.push('🗑 重複削除: ' + (r1.deleted || 0) + '行');

  // 2. 業種の長文汚染を修正
  var r2 = cleanIndustryField();
  log.push('🔧 業種修正: ' + (r2.cleaned || 0) + '社');

  // 3. 業種を自動補完（空欄のみ）
  var r3 = fillMissingIndustry();
  log.push('✨ 業種補完: ' + (r3.filled || 0) + '社');

  // 4. URLがある会社の電話・メール・担当者をWebから補完
  var r4 = autoFillCompanyDetails();
  log.push('🌐 Web補完: ' + (r4.filled || 0) + '社');

  return { success: true, log: log, message: log.join(' / ') };
}

// ─── 業種自動補完 ─────────────────────────────────────────────

function fillMissingIndustry() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { filled: 0, message: 'データなし' };

  var data   = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var filled = 0;

  data.forEach(function(row, idx) {
    var company  = String(row[PC.COMPANY  - 1] || '').trim();
    var industry = String(row[PC.INDUSTRY - 1] || '').trim();
    var url      = String(row[PC.URL      - 1] || '').trim();
    if (!company || industry) return;

    var guess = callClaude(
      '会社名・URLから業種を推定します。',
      '以下の会社の業種を10文字以内で答えてください。（例：設計事務所、内装施工会社、IT企業）\n会社名: ' + company + '\nURL: ' + url + '\n\n業種のみ出力:',
      'claude-haiku-4-5', 50
    );
    var guessClean = guess ? guess.trim().slice(0, 20) : '';
    var badChk = /申し訳|判断|以下の|\*\*|URL|提供いただ|ありません|できません|わかりません/;
    if (guessClean && !badChk.test(guessClean)) {
      sheet.getRange(idx + 2, PC.INDUSTRY).setValue(guessClean);
      filled++;
      Utilities.sleep(300);
    }
  });
  return { filled: filled, message: filled + '社の業種を補完しました' };
}

// 業種フィールドの長文汚染を修正（>20文字 or AI説明文パターン）
function cleanIndustryField() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  var cleaned = 0;
  var badPatterns = /申し訳|判断すると|以下の|考えられます|確認できません|アクセスして|記載されていない|\*\*|URLが|提供いただ|ありません|できません|わかりません/;
  data.forEach(function(row, idx) {
    var industry = String(row[PC.INDUSTRY - 1] || '').trim();
    if (!industry) return;
    if (industry.length > 20 || badPatterns.test(industry)) {
      var company = String(row[PC.COMPANY - 1] || '').trim();
      var url     = String(row[PC.URL - 1] || '').trim();
      var newVal = callClaude(
        '業種を推定します。',
        '以下の会社の業種を10文字以内で回答してください。（例: 設計事務所、内装施工会社、IT企業）\n会社名: ' + company + '\nURL: ' + url + '\n\n業種のみ出力:',
        'claude-haiku-4-5', 50
      );
      var cleaned_ = newVal ? newVal.trim().slice(0, 20) : '';
      if (cleaned_ && !badPatterns.test(cleaned_)) {
        sheet.getRange(idx + 2, PC.INDUSTRY).setValue(cleaned_);
        cleaned++;
        Utilities.sleep(300);
      }
    }
  });
  return { cleaned: cleaned, message: cleaned + '社の業種を修正しました' };
}

// ─── AIトークスクリプト生成 ────────────────────────────────────

function generateTalkScript(rowIndex) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 13).getValues()[0];

  var company  = String(row[PC.COMPANY  - 1] || '');
  var industry = String(row[PC.INDUSTRY - 1] || '');
  var url      = String(row[PC.URL      - 1] || '');
  var memo     = String(row[PC.MEMO     - 1] || '');

  var result = callClaudeJSON(
    '電話営業のプロです。マルケン電工（愛知県の電気工事会社）の営業担当が使うトークスクリプトを作成します。',
    '以下の会社への電話営業トークスクリプトをJSONで作成してください。\n' +
    '会社名: ' + company + '\n業種: ' + industry + '\nURL: ' + url + '\nメモ: ' + memo + '\n\n' +
    '【重要ルール】\n' +
    '・冒頭は必ず「お世話になっております。株式会社マルケン電工の〇〇です。」から始める\n' +
    '・受付突破の鉄則:\n' +
    '  1. 担当者名が分かる場合 → 名前をそのまま呼ぶ「〇〇さんいらっしゃいますか？」\n' +
    '     - 「以前少しお話ししたことがありまして」「〇〇の件でご連絡したんですが」と付け加えると繋いでもらいやすい\n' +
    '  2. 担当者名が分からない場合 → 推測で部署名を言う（外れても構わない）\n' +
    '     - 設計事務所なら「設計のご担当の方」、工場なら「設備管理のご担当の方」など\n' +
    '     - 「〇〇工事の件でご相談がありまして」と具体的な件名を作ると通りやすい\n' +
    '  3. 「ご担当者をお願いします」は絶対NG（受付に止められる）\n' +
    '・折り返しと言われたときの対応（受付に止められた場合）:\n' +
    '  1. まず担当者名を聞く → 「少しお名前を伺ってもよろしいですか？」\n' +
    '     （断られることもあるが一応聞く。名前が分かれば次回の突破率が上がる）\n' +
    '  2. 担当者がいる時間帯をしつこく聞く → 「今日、〇〇時ごろはいらっしゃいますか？」\n' +
    '     - 午前ダメなら午後、今日ダメなら明日と食い下がる\n' +
    '     - 「どうしても今日中にお話ししたいんですが」という熱意を出す\n' +
    '     - 人に会いたいと伝えることは失礼ではない。堂々と聞いてOK\n' +
    '  3. 時間帯が聞けたら「では〇時ごろに改めてお電話します」と伝えてから切る\n' +
    '・「資料を送ってください」と言われたときの対応:\n' +
    '  - 強気スタンスで返す: 「送ることは可能なんですけど、送るだけだと私たちが本当に伝えたい弊社の良さを100%お伝えできないまま判断されてしまうのが困るんですよね」\n' +
    '  - そのうえで「5分だけでも直接お話しさせていただけませんか？」とアポに持ち込む\n' +
    '  - 相手が「分かった」と言えばラッキー。しかしねばりすぎると嫌がられるのでほどほどに。1回だけ押す\n' +
    '  - どうしても断られたら「では資料をお送りしますね。また改めてご連絡させてください」で次回架電の口実を作る\n' +
    '・このシステムは「誰でも営業が取れる」ことを目標にしているため、新人でも実践できる具体的なセリフにする\n\n' +
    '{\n' +
    '  "opening": "受付突破トーク（担当者名あり/なし両パターン、折り返しと言われたときの応答も含める）",\n' +
    '  "pitch": "担当者に繋いでもらったあとの提案トーク（30秒・電気工事との接点を明確に）",\n' +
    '  "objections": [\n' +
    '    {"q": "よくある断り文句1", "a": "切り返しトーク"},\n' +
    '    {"q": "よくある断り文句2", "a": "切り返しトーク"},\n' +
    '    {"q": "よくある断り文句3", "a": "切り返しトーク"}\n' +
    '  ],\n' +
    '  "close": "アポ取得のクロージングトーク（日程提案まで）"\n' +
    '}',
    'claude-haiku-4-5'
  );

  if (!result) return { error: 'スクリプト生成失敗' };
  return { success: true, script: result };
}

// ─── AIメール個別化生成 ─────────────────────────────────────────

function generatePersonalizedEmail(rowIndex, templateId, note) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 13).getValues()[0];

  var company = String(row[PC.COMPANY  - 1] || '');
  var industry= String(row[PC.INDUSTRY - 1] || '');
  var contact = String(row[PC.CONTACT  - 1] || '') || '御担当者';
  var url     = String(row[PC.URL      - 1] || '');
  var email   = String(row[PC.EMAIL    - 1] || '');
  var apo     = String(row[PC.APO      - 1] || '');

  var typeMap = {
    'first':       '初回アプローチ（完全な新規開拓）',
    'followup':    '架電後フォロー（電話で話した後の御礼メール）',
    'appointment': 'アポ日程確認（アポが決まった後の確認メール）',
    'thanks':      '訪問御礼（実際に訪問・商談した後のお礼メール）',
  };
  var typeName = typeMap[templateId] || '初回アプローチ';

  var body = callClaude(
    '株式会社マルケン電工（愛知県の電気工事会社）の営業担当としてメールを書きます。',
    '以下の情報をもとに「' + typeName + '」の営業メール本文を作成してください。\n' +
    '- 宛先会社: ' + company + '\n- 業種: ' + industry + '\n- 担当者名: ' + contact +
    '\n- URL: ' + url + (apo ? '\n- アポ日時: ' + apo : '') + (note ? '\n- 追記事項: ' + note : '') + '\n\n' +
    '【条件】冒頭は「' + contact + '様」から始める / 末尾に署名不要 / 業種特性を踏まえた具体的な文章 / 簡潔に300字以内 / 本文のみ出力',
    'claude-haiku-4-5', 800
  );

  if (!body) return { error: 'メール生成失敗' };

  var templates = getEmailTemplates();
  var subject   = '';
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === templateId) { subject = templates[i].subject; break; }
  }
  return { success: true, to: email, subject: subject, body: body + MARUKEN_SIGNATURE, company: company, hasEmail: !!email };
}

// ─── 統計 ────────────────────────────────────────────────────────

// 業種名の表記ゆれを正規化（統計集計用）
function normalizeIndustry_(name) {
  var s = name.trim();
  // 設計・建築系
  if (/設計事務所|建築設計|設計会社|建築士事務所/.test(s)) return '設計事務所';
  if (/工務店|住宅建設|住宅会社|ハウスビルダー/.test(s)) return '工務店';
  if (/ゼネコン|総合建設|建設会社|建設業/.test(s)) return '建設会社';
  if (/内装|リフォーム|リノベ/.test(s)) return '内装・リフォーム';
  if (/設備工事|電気工事|管工事|空調/.test(s)) return '設備工事';
  // デザイン系
  if (/デザイン|グラフィック|クリエイティブ|広告制作/.test(s)) return 'デザイン・広告';
  // IT系
  if (/IT|システム|ソフトウェア|WEB|web|ウェブ|DX/.test(s)) return 'IT・システム';
  // 製造・工場
  if (/製造|工場|メーカー|部品|加工/.test(s)) return '製造業';
  // 不動産
  if (/不動産|マンション|賃貸|仲介|管理会社/.test(s)) return '不動産';
  // 医療・福祉
  if (/医療|クリニック|病院|介護|福祉|歯科/.test(s)) return '医療・福祉';
  // 飲食・小売
  if (/飲食|レストラン|カフェ|小売|スーパー|ショップ/.test(s)) return '飲食・小売';
  return s;
}

function getStats() {
  var sheet = getProspectSheet_();
  if (!sheet) return {};
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { total: 0, calledToday: 0, interested: 0, apo: 0, ng: 0, byIndustry: {} };

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var data  = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var stats = { total: 0, calledToday: 0, interested: 0, apo: 0, ng: 0, byIndustry: {} };

  var byStage = {};
  data.forEach(function(row) {
    var company  = String(row[PC.COMPANY   - 1] || '').trim();
    if (!company) return;
    stats.total++;

    var callDate = String(row[PC.CALL_DATE - 1] || '');
    var stage    = String(row[PC.STAGE     - 1] || '') || '未架電';
    var industryRaw = String(row[PC.INDUSTRY - 1] || '').trim();
    var badPat = /申し訳|判断すると|以下の|考えられます|確認できません|アクセスして|記載されていない|\*\*|URLが|提供いただ/;
    var industry = (!industryRaw || industryRaw.length > 20 || badPat.test(industryRaw)) ? '（未分類）' : normalizeIndustry_(industryRaw);
    var memo     = String(row[PC.MEMO      - 1] || '');

    if (callDate === today) stats.calledToday++;
    if (stage === '興味あり' || memo.indexOf('興味あり') !== -1) stats.interested++;
    if (stage === 'アポ確定') stats.apo++;
    if (stage === '失注') stats.ng++;
    if (stage === '受注') stats.won = (stats.won || 0) + 1;

    byStage[stage] = (byStage[stage] || 0) + 1;

    if (!stats.byIndustry[industry]) stats.byIndustry[industry] = { total: 0, called: 0, apo: 0 };
    stats.byIndustry[industry].total++;
    if (callDate) stats.byIndustry[industry].called++;
    if (stage === 'アポ確定') stats.byIndustry[industry].apo++;
  });

  stats.byStage = byStage;
  return stats;
}

// ─── メールテンプレート ──────────────────────────────────────────

function getEmailTemplates() {
  return [
    {
      id:      'first',
      name:    '初回アプローチ',
      subject: '電気工事のご相談について - 株式会社マルケン電工',
      body:
        '{{contact}}様\n\n' +
        '突然のご連絡失礼いたします。\n' +
        '愛知県名古屋市を拠点に電気工事を手掛けております、株式会社マルケン電工と申します。\n\n' +
        '御社の業務において電気工事・設備工事のお手伝いができればと思い、ご連絡いたしました。\n\n' +
        '【弊社の強み】\n・全国対応可能\n・迅速な現地対応（最短翌日）\n・商業施設・医療施設・工場など幅広い施工実績\n\n' +
        '{{note}}まずはお気軽にご相談いただければ幸いです。\n\nどうぞよろしくお願いいたします。\n\n' +
        MARUKEN_SIGNATURE,
    },
    {
      id:      'followup',
      name:    '架電後フォロー',
      subject: '先ほどのお電話のお礼 - 株式会社マルケン電工',
      body:
        '{{contact}}様\n\n' +
        '先ほどはお時間をいただきありがとうございました。\n株式会社マルケン電工でございます。\n\n' +
        'お電話でご案内いたしました通り、弊社では電気工事全般を承っております。\nご検討の際はぜひお声がけください。\n\n' +
        '{{note}}ご不明な点がございましたら、お気軽にご連絡ください。\n\nどうぞよろしくお願いいたします。\n\n' +
        MARUKEN_SIGNATURE,
    },
    {
      id:      'appointment',
      name:    'アポ日程確認',
      subject: 'ご訪問日程のご確認 - 株式会社マルケン電工',
      body:
        '{{contact}}様\n\n' +
        'お世話になっております。株式会社マルケン電工でございます。\n\n' +
        '{{apo}}にご訪問させていただくことをご確認いたします。\n' +
        'ご都合が変わる場合は、お気軽にご連絡ください。\n\n' +
        '{{note}}どうぞよろしくお願いいたします。\n\n' +
        MARUKEN_SIGNATURE,
    },
    {
      id:      'thanks',
      name:    '訪問御礼',
      subject: '本日のご訪問のお礼 - 株式会社マルケン電工',
      body:
        '{{contact}}様\n\n' +
        'お世話になっております。株式会社マルケン電工でございます。\n\n' +
        '本日はお忙しい中、お時間をいただきありがとうございました。\n' +
        '弊社のご説明をご丁寧に聞いていただき、大変感謝しております。\n\n' +
        'ご検討の上、ご不明な点やご要望等ございましたら、いつでもお気軽にご連絡ください。\n' +
        '引き続きどうぞよろしくお願いいたします。\n\n' +
        '{{note}}' +
        MARUKEN_SIGNATURE,
    },
  ];
}

function previewEmail(rowIndex, templateId, note) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 13).getValues()[0];

  var company = String(row[PC.COMPANY - 1] || '');
  var contact = String(row[PC.CONTACT - 1] || '') || '御担当者';
  var email   = String(row[PC.EMAIL   - 1] || '');
  var apo     = String(row[PC.APO     - 1] || '');

  var templates = getEmailTemplates();
  var tmpl = null;
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === templateId) { tmpl = templates[i]; break; }
  }
  if (!tmpl) return { error: 'テンプレートが見つかりません' };

  var noteStr = note ? note + '\n\n' : '';
  var body = tmpl.body
    .replace(/{{contact}}/g, contact)
    .replace(/{{note}}/g,    noteStr)
    .replace(/{{apo}}/g,     apo);

  return { to: email, subject: tmpl.subject, body: body, company: company, contact: contact, hasEmail: !!email };
}

function sendProspectEmail(rowIndex, templateId, note, asDraft) {
  var preview = previewEmail(rowIndex, templateId, note);
  if (preview.error) return { error: preview.error };
  if (!preview.to)   return { error: 'メールアドレスが未登録です。' };

  var sheet = getProspectSheet_();
  var now   = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  var label = asDraft ? '下書き' : '送信';

  try {
    var opts = { name: '株式会社マルケン電工', replyTo: 'info@marukendenkou.com' };
    if (asDraft) {
      GmailApp.createDraft(preview.to, preview.subject, preview.body, opts);
    } else {
      GmailApp.sendEmail(preview.to, preview.subject, preview.body, opts);
    }
    var cur_memo = String(sheet.getRange(rowIndex, PC.MEMO).getValue() || '');
    var entry    = now + '【メール' + label + ': ' + templateId + '】';
    sheet.getRange(rowIndex, PC.MEMO).setValue(cur_memo ? cur_memo + '\n' + entry : entry);
    return { success: true, asDraft: !!asDraft };
  } catch(e) {
    return { error: e.toString() };
  }
}

// ─── セル単体更新 ────────────────────────────────────────────────
function updateProspectCell(rowIndex, col, value) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  try {
    var cell = sheet.getRange(rowIndex, col);
    cell.setValue(value);
    if (col === PC.CALL_COUNT) cell.setNumberFormat('0');
    return { success: true };
  } catch(e) {
    return { error: e.toString() };
  }
}

// JSON文字列内の不正文字をエスケープ + trailing comma 除去
function sanitizeJson_(text) {
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
  // trailing comma の除去（Claude が末尾カンマを生成することがある）
  return result.replace(/,(\s*[}\]])/g, '$1');
}

// ブラケット対応でアウターmost JSONオブジェクトを安全に抽出
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

// ─── 会社分析（Haiku・標準・約¥1〜2/回） ────────────────────────
function analyzeCompany(rowIndex) {
  return _analyzeCompanyInternal(rowIndex, false);
}

// ─── 会社精密分析（Sonnet・約¥8〜12/回） ────────────────────────
function analyzeCompanyDeep(rowIndex) {
  return _analyzeCompanyInternal(rowIndex, true);
}

function _analyzeCompanyInternal(rowIndex, deep) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 13).getValues()[0];

  var company  = String(row[PC.COMPANY  - 1] || '').trim();
  var contact  = String(row[PC.CONTACT  - 1] || '');
  var industry = String(row[PC.INDUSTRY - 1] || '不明');
  var pref     = String(row[PC.PREF     - 1] || '');
  var url      = String(row[PC.URL      - 1] || '');
  var memo     = String(row[PC.MEMO     - 1] || '').slice(0, 200);

  if (!company) return { error: '会社名が未入力です' };

  var hasWeb = !!url;
  var system = [
    'マルケン電工（愛知県・電気工事会社）の営業戦略を立案する。JSONのみ出力。説明文不要。',
    MARUKEN_PROFILE,
    '',
    '【種まき思想（必ず反映）】',
    '「電気工事のマルケン」として相手の頭に刷り込むことが最優先。即売りより認知定着が重要。',
    '種まき行為の例: 「電気のことなら何でも相談してください」「見積もりだけでもOK」',
    '「今すぐ工事じゃなくても、顔つなぎだけでも」「無料診断で情報だけ提供」',
    '相手の警戒を下げ、次回接触のフックを残すことを各フェーズで意識する。',
    !hasWeb ? '【注意】このリードはHPが未確認。HPなし企業は"まずマルケンを知ってもらうフェーズ"が特に重要。' : '',
  ].filter(Boolean).join('\n');

  var prompt = [
    '【対象】' + company + ' / ' + industry + ' / ' + (pref || '所在地不明'),
    'URL: ' + (url || 'なし（HP未確認）') + ' / 担当者: ' + (contact || '不明') + ' / メモ: ' + (memo || 'なし'),
    '',
    '【マルケン主力商材】',
    '① 施工パートナー（設計・工務店向け外注受付）',
    '② LED・設備改修（古い施設・テナント向け）',
    '③ 省エネ診断・太陽光・EV充電（電力コスト削減切り口）',
    '④ 電気設備保守管理（定期点検・緊急対応）',
    !hasWeb ? '⑤ HP提案紹介（HP未保有 → Web制作業者へ橋渡し。「無料でいい業者紹介できますよ」で関係構築）' : '',
    '',
    '【重要】approachは "call"/"email"/"visit"/"seed" のいずれかで返すこと。',
    '"seed" = 今すぐ売らず認知・関係構築を目的とするアクション',
    '',
    '以下のJSON（必須・日本語）を返す:',
    '{',
    '  "score": 7,',
    '  "scoreReason": "この会社固有の根拠1文（業種・規模・電力消費等から）",',
    '  "seedStrategy": "種まき最優先アクション（どうやってマルケンを覚えてもらうか具体的に）",',
    '  "products": [',
    '    {"name":"商材名","score":9,"reason":"この会社固有の理由","approach":"call","pitch":"15秒トーク（業種ワード必須）","estimatedRevenue":"目安金額","timeToClose":"期間"},',
    '    {"name":"商材名","score":7,"reason":"...","approach":"seed","pitch":"...","estimatedRevenue":"...","timeToClose":"..."},',
    '    {"name":"商材名","score":5,"reason":"...","approach":"email","pitch":"...","estimatedRevenue":"...","timeToClose":"..."}',
    '  ],',
    '  "callScript": {',
    '    "opener": "受付突破トーク（担当者あり版 / 担当者なし版 / 折り返し切り返し、各パターンを含む）",',
    '    "seedPitch": "今日の目標は売ることじゃなく顔つなぎ。担当者に覚えてもらうための30秒トーク",',
    '    "pitch": "本格提案トーク（業種固有ワード入り・30秒）",',
    '    "objections": [',
    '      {"q":"断り文句1","a":"切り返し（種まきとして次回接触を残す）"},',
    '      {"q":"断り文句2","a":"切り返し"},',
    '      {"q":"資料を送って","a":"強気で1回押す + 送っても次回電話の約束を取る"}',
    '    ],',
    '    "close": "アポ取りクロージング（無理ならせめて次回電話OKをもらう）"',
    '  },',
    '  "attackPlan": {',
    '    "step1": "今日やること（種まき具体行動）",',
    '    "step2": "2週間後（関係を育てる行動）",',
    '    "step3": "1ヶ月後（商談化への引き上げ）"',
    '  },',
    '  "verdict": "★1〜5 + 最優先アクション1文"',
    '}',
  ].filter(function(l){return l!=='';}).join('\n');

  // deep=true のときは Sonnet で全項目
  var deepPrompt = '';
  if (deep) {
    deepPrompt = prompt.replace(
      '"verdict": "★1〜5 + 最優先アクション1文"',
      '"companyProfile": {"businessModel":"...","estimatedSize":"...","facilities":"...","powerConsumption":"月X〜Y万円","growthStage":"..."},' +
      '"partnerAngle": "施工パートナー可能性",' +
      '"newProductIdea": "新商材アイデア",' +
      '"decisionMaker": {"role":"...","approach":"...","pain":"...","trigger":"..."},' +
      '"timing": "最適タイミング",' +
      '"emailStrategy": {"subject":"...","body":"250字","followupTiming":"..."},' +
      '"risks": [{"risk":"...","mitigation":"..."},{"risk":"...","mitigation":"..."}],' +
      '"verdict": "★1〜5 + 最優先アクション1文"'
    );
  }

  var model  = deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5';
  var tokens = deep ? 4000 : 3000;
  var text = callClaude(system, deep ? deepPrompt : prompt, model, tokens);
  if (!text) return { error: 'AI分析に失敗しました。もう一度お試しください。' };

  var raw = extractOutermostJson_(text);
  if (!raw) return { error: 'AI応答の解析に失敗しました（JSON未検出）' };

  var result;
  try { result = JSON.parse(sanitizeJson_(raw)); }
  catch(e) {
    var pos = parseInt((e.toString().match(/position (\d+)/) || [])[1]) || 0;
    var sanitized = sanitizeJson_(raw);
    var ctx = sanitized.slice(Math.max(0, pos - 60), pos + 60);
    Logger.log('JSON parse error at pos ' + pos + ': ' + ctx);
    return { error: 'JSON解析失敗: ' + e.toString() };
  }

  try {
    var topProd = (result.products && result.products[0]) ? result.products[0].name : '';
    var nowTs = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    var entry = nowTs + '【AI分析: ' + (result.verdict || '') + (topProd ? ' / 推奨:' + topProd : '') + '】';
    var curMemo = String(sheet.getRange(rowIndex, PC.MEMO).getValue() || '');
    sheet.getRange(rowIndex, PC.MEMO).setValue(curMemo ? curMemo + '\n' + entry : entry);
  } catch(e) {}

  return { analysis: result, company: company, deep: deep };
}

// ─── Web情報補完（URL→HTML→電話・メール・担当者を自動抽出） ──────
function fetchSiteText_(url) {
  if (!url || !url.match(/^https?:\/\//)) return null;
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
    });
    if (res.getResponseCode() !== 200) return null;
    var html = res.getContentText('UTF-8').slice(0, 12000);
    // スクリプト・スタイル除去してテキスト抽出
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 3000)
      .trim();
  } catch(e) { return null; }
}

function autoFillCompanyDetails() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { filled: 0, message: 'データなし' };

  var data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var filled = 0;
  var skipped = 0;
  var failed = 0;

  data.forEach(function(row, idx) {
    var url     = String(row[PC.URL      - 1] || '').trim();
    var phone   = String(row[PC.PHONE    - 1] || '').trim();
    var email   = String(row[PC.EMAIL    - 1] || '').trim();
    var contact = String(row[PC.CONTACT  - 1] || '').trim();

    // URLなし or 全項目埋まっていたらスキップ
    if (!url) { skipped++; return; }
    if (phone && email && contact) { skipped++; return; }

    var text = fetchSiteText_(url);
    if (!text) { failed++; return; }

    // まず正規表現で電話・メールを無料抽出
    var phoneMatch = text.match(/\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}/);
    var emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}/);
    var newPhone = (!phone && phoneMatch) ? phoneMatch[0].replace(/\s/g, '-') : '';
    var newEmail = (!email && emailMatch) ? emailMatch[0] : '';

    // 担当者名はClaude Haikuで抽出（担当者名はパターン抽出が難しいため）
    var newContact = '';
    if (!contact) {
      var raw = callClaude(
        '会社サイトのテキストから担当者名または部署名を抽出。10文字以内で1件のみ。なければ空文字。',
        '次のサイトテキストから担当者名・部署名を抽出:\n' + text.slice(0, 1500) + '\n\n担当者名のみ出力（なければ空欄のみ）:',
        'claude-haiku-4-5', 30
      );
      if (raw) newContact = raw.trim().replace(/[「」『』]/g, '').slice(0, 20);
    }

    // 何か新情報があれば書き込む
    var updated = false;
    if (newPhone) { sheet.getRange(idx + 2, PC.PHONE).setValue(newPhone); updated = true; }
    if (newEmail) { sheet.getRange(idx + 2, PC.EMAIL).setValue(newEmail); updated = true; }
    if (newContact && newContact.length > 1) { sheet.getRange(idx + 2, PC.CONTACT).setValue(newContact); updated = true; }

    if (updated) { filled++; } else { skipped++; }
    Utilities.sleep(400);
  });

  return { filled: filled, skipped: skipped, failed: failed,
    message: filled + '社を補完（取得失敗: ' + failed + '社 / スキップ: ' + skipped + '社）' };
}

// ─── 週次フィードバック分析 ──────────────────────────────────────
function analyzeFeedback() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { summary: 'データなし', suggestions: [] };

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var feedbacks = [];
  data.forEach(function(row) {
    var memo = String(row[PC.MEMO - 1] || '');
    memo.split('\n').forEach(function(line) {
      var m = line.match(/\[気づき: (.+)\]/);
      if (m && m[1].trim()) {
        feedbacks.push({ company: String(row[PC.COMPANY - 1] || ''), text: m[1].trim() });
      }
    });
  });

  if (!feedbacks.length) return { summary: '今週の気づきがまだありません', suggestions: [], count: 0 };

  var feedbackText = feedbacks.slice(-30).map(function(f) {
    return '・' + (f.company ? '[' + f.company + '] ' : '') + f.text;
  }).join('\n');

  var raw = callClaude(
    'マルケン電工（愛知県・電気工事会社）営業担当の現場フィードバックを分析する。',
    '以下は現場担当者が架電・営業活動中に記録した気づきメモです（' + feedbacks.length + '件）:\n\n' +
    feedbackText + '\n\n' +
    '上記を分析し来週への改善提案をJSONで返す。\n' +
    '{"summary":"全体的な傾向（1〜2文）","suggestions":["具体的な改善提案1","具体的な改善提案2","具体的な改善提案3"],"topPattern":"最も多いパターンや反応"}',
    'claude-haiku-4-5', 600
  );
  if (!raw) return { summary: '分析失敗', suggestions: [], count: feedbacks.length };
  var jsonStr = extractOutermostJson_(raw);
  if (!jsonStr) return { summary: raw.slice(0, 100), suggestions: [], count: feedbacks.length };
  try {
    var r = JSON.parse(sanitizeJson_(jsonStr));
    r.count = feedbacks.length;
    return r;
  } catch(e) { return { summary: '解析失敗: ' + e.toString(), suggestions: [], count: feedbacks.length }; }
}

// ─── 週次営業戦略レポート ────────────────────────────────────────
function sendWeeklyStrategyReport() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: 'データなし' };

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var today    = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
  var oneWeek  = new Date(); oneWeek.setDate(oneWeek.getDate() - 7);
  var weekAgo  = Utilities.formatDate(oneWeek, 'Asia/Tokyo', 'yyyy/MM/dd');

  // ── 集計 ──────────────────────────────────────────────────────
  var total = 0, calledThisWeek = 0, apo = 0, ng = 0, won = 0, interested = 0;
  var byIndustry = {}; // { name: { total, called, apo, ng } }
  var byArea     = {};
  var callCounts = []; // 何回目でアポになったか
  var lostReasons= []; // 断り理由テキスト収集
  var feedbacks  = []; // 気づき

  data.forEach(function(row) {
    var company  = String(row[PC.COMPANY   - 1] || '').trim(); if (!company) return;
    var stage    = String(row[PC.STAGE     - 1] || '未架電');
    var industry = String(row[PC.INDUSTRY  - 1] || '不明').trim() || '不明';
    var pref     = String(row[PC.PREF      - 1] || '不明').trim() || '不明';
    var memo     = String(row[PC.MEMO      - 1] || '');
    var callDate = String(row[PC.CALL_DATE - 1] || '');
    var callCnt  = parseInt(row[PC.CALL_COUNT - 1] || 0);

    total++;
    if (stage === 'アポ確定') { apo++; if (callCnt > 0) callCounts.push(callCnt); }
    if (stage === '失注')      ng++;
    if (stage === '受注')      won++;
    if (stage === '興味あり')  interested++;
    if (callDate >= weekAgo && callDate <= today) calledThisWeek++;

    if (!byIndustry[industry]) byIndustry[industry] = { total:0, called:0, apo:0, ng:0 };
    byIndustry[industry].total++;
    if (callDate) byIndustry[industry].called++;
    if (stage === 'アポ確定') byIndustry[industry].apo++;
    if (stage === '失注')     byIndustry[industry].ng++;

    if (!byArea[pref]) byArea[pref] = { total:0, apo:0 };
    byArea[pref].total++;
    if (stage === 'アポ確定') byArea[pref].apo++;

    // 断り理由（NGのメモから抽出）
    if (stage === '失注' && memo) {
      var lines = memo.split('\n');
      lines.forEach(function(l){ if (l.indexOf('【NG】') !== -1 || l.indexOf('【失注】') !== -1) lostReasons.push(l.slice(0, 60)); });
    }
    // 気づき
    memo.split('\n').forEach(function(l){ var m=l.match(/\[気づき: (.+)\]/); if(m) feedbacks.push(m[1]); });
  });

  // 業種別アポ率TOP5
  var industryRanking = Object.keys(byIndustry).map(function(k) {
    var v = byIndustry[k];
    var rate = v.called > 0 ? Math.round(v.apo / v.called * 100) : 0;
    return { name: k, total: v.total, called: v.called, apo: v.apo, ng: v.ng, rate: rate };
  }).filter(function(x){ return x.called >= 2; })
    .sort(function(a,b){ return b.rate - a.rate; })
    .slice(0, 5);

  // エリア別TOP3
  var areaRanking = Object.keys(byArea).map(function(k) {
    var v = byArea[k];
    var rate = v.total > 0 ? Math.round(v.apo / v.total * 100) : 0;
    return { name: k, total: v.total, apo: v.apo, rate: rate };
  }).filter(function(x){ return x.total >= 3; })
    .sort(function(a,b){ return b.rate - a.rate; })
    .slice(0, 3);

  // 平均アポ架電回数
  var avgCalls = callCounts.length > 0
    ? Math.round(callCounts.reduce(function(s,n){return s+n;},0) / callCounts.length * 10) / 10
    : null;

  // ── 補完タスク件数（電話・URL・メール・担当者が空の件数）────────
  var missingPhone = 0, missingUrl = 0, missingEmail = 0, missingContact = 0;
  data.forEach(function(row) {
    var company = String(row[PC.COMPANY-1]||'').trim(); if(!company) return;
    var stage   = String(row[PC.STAGE-1]||'');  if(stage==='失注'||stage==='受注') return;
    if (!String(row[PC.PHONE  -1]||'').trim()) missingPhone++;
    if (!String(row[PC.URL    -1]||'').trim()) missingUrl++;
    if (!String(row[PC.EMAIL  -1]||'').trim()) missingEmail++;
    if (!String(row[PC.CONTACT-1]||'').trim()) missingContact++;
  });

  // ── LINEメッセージ組み立て ────────────────────────────────────
  var week = Utilities.formatDate(oneWeek,'Asia/Tokyo','M/d') + '〜' + Utilities.formatDate(new Date(),'Asia/Tokyo','M/d');
  var msg = '📊 週次営業レポート（' + week + '）\n\n'
    + '📋 リスト総数: ' + total + '社\n'
    + '📞 今週架電: ' + calledThisWeek + '社\n'
    + '🤝 アポ累計: ' + apo + '件\n'
    + '❌ 失注累計: ' + ng + '件\n'
    + (avgCalls ? '⚡ 平均アポ架電: ' + avgCalls + '回\n' : '')
    + '\n🏆 業種別アポ率 TOP3\n'
    + industryRanking.slice(0,3).map(function(x,i){
        return ['①','②','③'][i] + ' ' + x.name + ': ' + x.rate + '% (' + x.apo + '/' + x.called + ')';
      }).join('\n')
    + (areaRanking.length ? '\n\n📍 エリア別\n' + areaRanking.map(function(x){return '・'+x.name+': '+x.apo+'アポ / '+x.total+'社';}).join('\n') : '')
    + '\n\n✏️ データ補完状況\n'
    + '・電話番号なし: ' + missingPhone + '社\n'
    + '・HPなし: ' + missingUrl + '社\n'
    + '・メールなし: ' + missingEmail + '社\n'
    + '・担当者名なし: ' + missingContact + '社\n'
    + (missingPhone + missingUrl > 0 ? '→ アプリの「✏️ 補完」タブから入力できます' : '✅ 基本情報は揃っています');

  try { sendLineToManager(msg); } catch(e) { Logger.log('LINE送信失敗: ' + e); }
  return { success: true, message: msg };
}

// ─── 成約案件の定期連絡チェック ──────────────────────────────────
function checkWonFollowups() {
  var sheet = getProspectSheet_();
  if (!sheet) return;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  var today = new Date();
  var alerts30 = [], alerts60 = [];

  data.forEach(function(row) {
    var company  = String(row[PC.COMPANY   - 1] || '').trim(); if (!company) return;
    var stage    = String(row[PC.STAGE     - 1] || '');
    if (stage !== '受注') return;
    var callDate = row[PC.CALL_DATE - 1];
    if (!callDate) { alerts60.push(company + '（連絡記録なし）'); return; }
    var d = callDate instanceof Date ? callDate : new Date(String(callDate).replace(/\//g, '-'));
    var days = Math.floor((today - d) / (1000 * 60 * 60 * 24));
    if (days >= 60) alerts60.push(company + '（' + days + '日未連絡）');
    else if (days >= 30) alerts30.push(company + '（' + days + '日未連絡）');
  });

  if (!alerts60.length && !alerts30.length) return;
  var msg = '🏆 成約案件 定期連絡チェック\n\n';
  if (alerts60.length) msg += '🚨 60日以上未連絡\n' + alerts60.map(function(s){return '・'+s;}).join('\n') + '\n\n';
  if (alerts30.length) msg += '⚠️ 30日以上未連絡\n' + alerts30.map(function(s){return '・'+s;}).join('\n');
  try { sendLineToManager(msg.trim()); } catch(e) {}
}

// ─── 夜間自動リード発掘 ──────────────────────────────────────────
// ─── 自動リード発掘（夜間バッチ） ────────────────────────────────
var AUTO_KEYWORDS = [
  '設計事務所', '建築設計事務所', '工務店', '建設会社', '内装会社',
  'リフォーム会社', '設備工事会社', '電気設備工事', '施工管理会社',
  'ゼネコン', '不動産管理', '倉庫会社', '工場', 'ホテル', '医療施設'
];
var AUTO_AREAS = [
  '名古屋市中区', '名古屋市中村区', '名古屋市西区', '名古屋市北区',
  '名古屋市東区', '名古屋市千種区', '名古屋市昭和区', '名古屋市瑞穂区',
  '名古屋市天白区', '名古屋市守山区', '名古屋市緑区', '名古屋市南区',
  '名古屋市港区', '名古屋市熱田区', '名古屋市中川区', '名古屋市名東区',
  '豊田市', '岡崎市', '一宮市', '豊橋市', '春日井市', '安城市',
  '刈谷市', '豊川市', '小牧市', '犬山市', '知多市', '半田市',
  '常滑市', '東海市'
];

function autoDiscoverLeads() {
  var props = PropertiesService.getScriptProperties();
  var BATCH = 15;

  // 全組み合わせ生成
  var all = [];
  AUTO_KEYWORDS.forEach(function(k) {
    AUTO_AREAS.forEach(function(a) { all.push({ k: k, a: a }); });
  });
  var total = all.length; // 15 × 30 = 450

  var idx = parseInt(props.getProperty('AUTO_DISCOVER_IDX') || '0');
  if (idx >= total) idx = 0;

  var end = Math.min(idx + BATCH, total);
  var totalAdded = 0;
  var errCount = 0;

  for (var i = idx; i < end; i++) {
    var combo = all[i];
    try {
      var r = searchPlaces(combo.k, combo.a, 20);
      if (!r.error && r.results && r.results.length) {
        var added = addProspects(r.results);
        totalAdded += added.added || 0;
      } else if (r.error) { errCount++; }
    } catch(e) { errCount++; }
    Utilities.sleep(600);
  }

  var nextIdx = end >= total ? 0 : end;
  props.setProperty('AUTO_DISCOVER_IDX', String(nextIdx));

  var cycleMsg = nextIdx === 0 ? '（1サイクル完了🎉）' : ('(' + end + '/' + total + ')');
  var msg = '🤖 自動リード発掘 ' + cycleMsg + '\n+' + totalAdded + '社追加　エラー:' + errCount + '件\n' + all[idx].k + ' @ ' + all[idx].a + ' 〜';
  try { sendLineToManager(msg); } catch(e) {}
  Logger.log(msg);
  return { added: totalAdded, nextIdx: nextIdx, total: total };
}

// ─── 飛び込み営業リスト ──────────────────────────────────────────
function getVisitList(area, maxCount) {
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var results = [];
  var kw = (area || '').replace(/\s/g, '');
  if (!kw) return [];

  var stageScore = { 'アポ確定': 100, '商談中': 90, '興味あり': 60, 'アプローチ中': 30, '未架電': 10 };

  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY - 1] || '').trim();
    if (!company) return;
    var stage = String(row[PC.STAGE - 1] || '未架電');
    if (stage === '失注' || stage === '受注') return;

    var pref    = String(row[PC.PREF  - 1] || '');
    var memo    = String(row[PC.MEMO  - 1] || '');
    // memoの1行目がMaps由来の住所を含むことが多い
    var address = memo.split('\n')[0].slice(0, 80);
    var haystack = (pref + ' ' + address + ' ' + company).replace(/\s/g, '');

    if (haystack.indexOf(kw) === -1) return;

    var priority = stageScore[stage] || 10;
    var aiMatch  = memo.match(/【AI分析:.*?★(\d)/);
    if (aiMatch) priority += parseInt(aiMatch[1]) * 3;

    results.push({
      rowIndex: idx + 2,
      company:  company,
      stage:    stage,
      phone:    String(row[PC.PHONE    - 1] || ''),
      email:    String(row[PC.EMAIL    - 1] || ''),
      url:      String(row[PC.URL      - 1] || ''),
      industry: String(row[PC.INDUSTRY - 1] || ''),
      pref:     pref,
      address:  address,
      memo:     memo,
      priority: priority,
    });
  });

  results.sort(function(a, b) { return b.priority - a.priority; });
  return results.slice(0, parseInt(maxCount) || 20);
}

// ─── 補完タスク（人間への指示キュー） ────────────────────────────
function getHumanTasks() {
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var tasks = [];

  var stageScore = { 'アポ確定': 100, '商談中': 90, '受注': 80, '興味あり': 60, 'アプローチ中': 30, '未架電': 10, '失注': 0 };

  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY   - 1] || '').trim();
    if (!company) return;
    var stage   = String(row[PC.STAGE     - 1] || '未架電');
    var phone   = String(row[PC.PHONE     - 1] || '').trim();
    var email   = String(row[PC.EMAIL     - 1] || '').trim();
    var url     = String(row[PC.URL       - 1] || '').trim();
    var contact = String(row[PC.CONTACT   - 1] || '').trim();
    var industry= String(row[PC.INDUSTRY  - 1] || '').trim();
    var memo    = String(row[PC.MEMO      - 1] || '');

    if (stage === '失注') return;

    // 優先度スコア
    var priority = stageScore[stage] || 10;
    var aiMatch  = memo.match(/【AI分析:.*?★(\d)/);
    if (aiMatch) priority += parseInt(aiMatch[1]) * 5;

    // 不足タスクを判定
    var missing = [];
    if (!phone) {
      missing.push({
        type: 'phone', label: '電話番号',
        instruction: url ? 'HPを開いて電話番号を探して入力' : '「' + company + '」でGoogle検索 → 電話番号を入力',
        searchQ: company + ' ' + industry + ' 電話番号',
        url: url
      });
    }
    if (!url) {
      missing.push({
        type: 'url', label: 'ホームページ',
        instruction: '「' + company + '」でGoogle検索 → 公式サイトのURLを入力',
        searchQ: company + ' ' + industry + ' 公式サイト',
        url: ''
      });
    }
    if (url && !email) {
      missing.push({
        type: 'email', label: 'メールアドレス',
        instruction: 'HPのお問い合わせページでメールアドレスを探して入力',
        url: url
      });
    }
    if (!contact) {
      missing.push({
        type: 'contact', label: '担当者名',
        instruction: phone ? '次回架電時「どちら様にお繋ぎしますか？」と聞いた際の名前を入力' : 'HPの会社概要・スタッフ紹介ページで確認',
        url: url
      });
    }

    if (!missing.length) return;

    tasks.push({
      rowIndex:  idx + 2,
      company:   company,
      stage:     stage,
      industry:  industry,
      priority:  priority,
      missing:   missing,
      phone:     phone,
      url:       url,
      noWeb:     !url  // HPなしフラグ
    });
  });

  tasks.sort(function(a, b) { return b.priority - a.priority; });
  return tasks.slice(0, 60);
}

// ─── キャンペーン一斉メール下書き ────────────────────────────────
function generateCampaign(product, limit) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: 'データがありません' };

  limit = Math.min(parseInt(limit) || 20, 1000);

  var productMap = {
    'partner':    {
      name: '施工パートナー登録',
      subject: '電気工事の外注・協力会社としてご登録のお願い｜マルケン電工',
      angle: '設計・施工・内装・工務店向け。御社の案件の電気工事を弊社が請け負う施工パートナー提案。',
    },
    'energy':     {
      name: '省エネ診断（無料）',
      subject: '【無料診断】御社の電気代を下げる方法があります｜マルケン電工',
      angle: '電力使用量が多い業種向け。無料省エネ診断を入口に、設備改修へ繋げる。',
    },
    'led':        {
      name: 'LED全館改修',
      subject: '照明のLED化で電気代30%削減｜補助金活用可｜マルケン電工',
      angle: '築10年以上・照明が古い施設向け。補助金・リース活用で初期費用を抑える。',
    },
    'inspection': {
      name: '電気設備無料点検',
      subject: '電気設備の無料点検実施中｜法定点検の漏れはありませんか？｜マルケン電工',
      angle: '法定点検が必要な施設向け。無料点検→有料保守契約・設備更新へ繋げる。',
    },
    'solar':      {
      name: '太陽光発電（初期費用ゼロ）',
      subject: '屋根を使って電気代ゼロへ｜初期費用不要プランのご案内｜マルケン電工',
      angle: '屋根面積が大きい工場・倉庫・大型施設向け。PPAモデルで初期費用なし。',
    },
    'ev':         {
      name: 'EV充電設備',
      subject: 'EV充電設備の補助金活用で集客力アップ｜マルケン電工',
      angle: '駐車場がある施設・ホテル・商業施設向け。補助金で低コスト導入。',
    },
  };
  var prod = productMap[product] || productMap['energy'];

  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  var targets = [];
  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY - 1] || '').trim();
    var email   = String(row[PC.EMAIL   - 1] || '').trim();
    var stage   = String(row[PC.STAGE   - 1] || '');
    if (!company || !email) return;
    if (stage === '失注' || stage === 'アポ確定') return;
    if (targets.length >= limit) return;
    targets.push({
      rowIndex: idx + 2,
      company:  company,
      contact:  String(row[PC.CONTACT  - 1] || '御担当者'),
      industry: String(row[PC.INDUSTRY - 1] || ''),
      pref:     String(row[PC.PREF     - 1] || ''),
      email:    email,
    });
  });

  if (!targets.length) return { error: 'メールアドレス登録済みの会社がありません' };

  var drafted = 0;
  var errList = [];
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');

  targets.forEach(function(t) {
    try {
      var body = callClaude(
        'マルケン電工（愛知県名古屋市・電気工事会社）の営業担当としてメールを書く。本文のみ出力（250字以内・署名不要）。電気関連商材の押し売りより、相手の業種・状況に合わせた切り口で書く。',
        '宛先: ' + t.company + '（' + (t.industry || '企業') + '・' + (t.pref || '') + '）\n' +
        '担当者: ' + t.contact + '様\n' +
        '商材角度: ' + prod.angle + '\n' +
        '商材名: ' + prod.name + '\n\n' +
        'この会社の業種・地域・規模感から推測して、最も刺さる切り口でメール本文を作成。冒頭「' + t.contact + '様」で始める。汎用的な文章ではなく業種固有のワードを入れる。',
        'claude-haiku-4-5', 500
      );
      if (!body) throw new Error('本文生成失敗');

      GmailApp.createDraft(
        t.email,
        prod.subject,
        body + MARUKEN_SIGNATURE,
        { name: '株式会社マルケン電工', replyTo: 'info@marukendenkou.com' }
      );

      var cur = String(sheet.getRange(t.rowIndex, PC.MEMO).getValue() || '');
      var entry = now + '【キャンペーン下書き: ' + prod.name + '】';
      sheet.getRange(t.rowIndex, PC.MEMO).setValue(cur ? cur + '\n' + entry : entry);

      drafted++;
      Utilities.sleep(400);
    } catch(e) {
      errList.push(t.company + ': ' + e.toString().substring(0, 50));
    }
  });

  return {
    drafted:  drafted,
    skipped:  targets.length - drafted,
    errors:   errList,
    product:  prod.name,
    message:  'Gmailに' + drafted + '件の下書きを作成しました',
  };
}
