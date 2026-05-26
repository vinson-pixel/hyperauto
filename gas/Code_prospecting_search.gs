// ─── 検索（Maps / Web 統合） ────────────────────────────────────

function generateQueryVariations(keyword, area) {
  var text = callClaude(
    '検索クエリ生成。JSON配列のみ出力。説明不要。',
    'マルケン電工（愛知・電気工事・業務用エアコン・設備工事・キュービクル）の営業リスト収集用に、以下キーワードに対するGoogleマップ検索クエリを5つ生成せよ。\n' +
    'キーワード「' + keyword + '」\nエリア: ' + (area || '日本全国') + '\n\n' +
    'ルール:\n' +
    '- 商材名（業務用エアコン・LED改修・電気工事・太陽光・EV充電器・設備保守・キュービクルなど）が入力された場合 → その商材を必要とするターゲット業種に変換せよ\n' +
    '  例：「業務用エアコン」→["飲食店","工場 製造業","倉庫 物流","介護施設","スーパー"]\n' +
    '  例：「LED改修」→["製造業 工場","倉庫 物流","病院 クリニック","スーパー 商業施設","学校 公共施設"]\n' +
    '  例：「電気工事 店舗」→["内装工事会社","店舗設計事務所","テナント改装 工務店","建設会社 店舗工事","リフォーム会社"]\n' +
    '- 業種名が入力された場合 → 言い換え・関連業種バリエーションを生成せよ\n\n' +
    'JSON配列のみ: ["クエリ1","クエリ2","クエリ3","クエリ4","クエリ5"]',
    'claude-haiku-4-5-20251001', 200
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
// 会社情報を電話番号で照合して修正（GASエディタから手動実行）
function verifyAndFixCompany() {
  var TARGET = '花森'; // 会社名に含まれる文字列で検索

  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var data = sheet.getDataRange().getValues();
  var apiKey = getProp('MAPS_API_KEY');

  var found = false;
  for (var i = 1; i < data.length; i++) {
    var company = String(data[i][PC.COMPANY - 1] || '');
    if (company.indexOf(TARGET) === -1) continue;
    found = true;

    var phone   = String(data[i][PC.PHONE    - 1] || '').trim();
    var url     = String(data[i][PC.URL      - 1] || '').trim();
    var address = String(data[i][PC.MEMO     - 1] || '').split('\n')[0]; // memoの1行目が住所のことが多い
    var pref    = String(data[i][PC.PREF     - 1] || '').trim();

    Logger.log('──────────────────────────');
    Logger.log('対象行: ' + (i + 1) + ' / 会社名: ' + company);
    Logger.log('電話: ' + phone + ' / URL: ' + url + ' / 所在地: ' + pref);

    // ① 電話番号でPlaces検索（最も確実）
    var verified = null;
    if (phone && apiKey) {
      var r = searchPlaces(phone, '', 3);
      if (!r.error && r.results && r.results.length) {
        verified = r.results[0];
        Logger.log('📞 電話番号逆引き結果: ' + verified.name + ' / ' + verified.address);
      }
    }

    // ② 電話番号でヒットしなければ会社名+所在地で検索
    if (!verified && apiKey) {
      var r2 = searchPlaces(company, pref || '愛知県', 3);
      if (!r2.error && r2.results && r2.results.length) {
        verified = r2.results[0];
        Logger.log('🔍 名前検索結果: ' + verified.name + ' / ' + verified.address);
      }
    }

    if (!verified) { Logger.log('❌ 照合できませんでした'); continue; }

    // ③ 現在の情報と照合してログ出力
    Logger.log('');
    Logger.log('【照合結果】');
    Logger.log('会社名: ' + company + ' → ' + verified.name + (company !== verified.name ? ' ⚠️ 異なる' : ' ✅'));
    Logger.log('住所: ' + address + ' → ' + verified.address);
    Logger.log('電話: ' + phone + ' → ' + (verified.phone || '(取得不可)'));
    Logger.log('URL: ' + url + ' → ' + (verified.website || '(取得不可)'));

    // ④ 自動修正（明らかに異なる場合のみ）
    var updates = [];
    if (verified.name && verified.name !== company) {
      sheet.getRange(i + 1, PC.COMPANY).setValue(verified.name);
      updates.push('会社名: ' + company + ' → ' + verified.name);
    }
    if (verified.address && !address) {
      // メモに住所を追記
      var memo = String(data[i][PC.MEMO - 1] || '');
      sheet.getRange(i + 1, PC.MEMO).setValue((verified.address + '\n' + memo).trim());
      updates.push('住所を追加: ' + verified.address);
    }
    if (verified.phone && !phone) {
      sheet.getRange(i + 1, PC.PHONE).setValue(verified.phone);
      updates.push('電話番号を追加: ' + verified.phone);
    }
    if (verified.website && !url) {
      sheet.getRange(i + 1, PC.URL).setValue(verified.website);
      updates.push('URL追加: ' + verified.website);
    }
    if (verified.pref && !pref) {
      sheet.getRange(i + 1, PC.PREF).setValue(verified.pref);
      updates.push('所在地追加: ' + verified.pref);
    }

    if (updates.length) {
      Logger.log('✅ 修正完了:\n' + updates.join('\n'));
    } else {
      Logger.log('ℹ️ 修正不要（情報一致）');
    }
  }

  if (!found) Logger.log('「' + TARGET + '」を含む会社が見つかりませんでした');
}

// 【1回だけ実行】担当者直電をC列（担当者名の隣）に移動
// 旧: A会社名 B担当者名 C電話番号 ... O担当者直電
// 新: A会社名 B担当者名 C担当者直電 D電話番号 ... O法人番号
function migrateDirectPhoneToColC() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  // 既に移行済み確認（C列ヘッダーが「担当者直電」なら終了）
  if (String(sheet.getRange(1, 3).getValue()) === '担当者直電') {
    Logger.log('✅ 既に移行済み（C列=担当者直電）'); return;
  }
  var lastRow = sheet.getLastRow();
  // 旧O列(15)の担当者直電データを保存
  var directData = lastRow > 1
    ? sheet.getRange(2, 15, lastRow - 1, 1).getValues()
    : [];
  // C列の前に新列を挿入 → 旧C-O が D-P にシフト
  sheet.insertColumnBefore(3);
  // 新C(3)に担当者直電ヘッダーと値をセット
  sheet.getRange(1, 3).setValue('担当者直電').setFontWeight('bold');
  if (directData.length) {
    sheet.getRange(2, 3, directData.length, 1).setValues(directData);
  }
  // 旧O(15)が挿入で P(16) になった → 中身をクリア & 列削除
  if (lastRow > 1) sheet.getRange(2, 16, lastRow - 1, 1).clearContent();
  sheet.getRange(1, 16).clearContent();
  sheet.deleteColumn(16);
  Logger.log('✅ 担当者直電をC列に移動完了（' + directData.length + '行処理）');
}

// 【旧】O列「担当者直電」ヘッダー追加（使用済み→migrateDirectPhoneToColCを使うこと）
function migrateAddDirectPhoneColumn() {
  Logger.log('このマイグレーションは不要です。migrateDirectPhoneToColC() を実行してください。');
}

// 【1回だけ実行】Q列「役職」追加 + 担当者名（B列）から役職を分離
// 例: "田中（部長）" → B=田中、Q=部長
// 列を新順序に並べ替え（ヘッダー名ベースで安全に実行）
function migrateReorderColumns() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };

  var lastCol = sheet.getLastColumn();
  var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h).trim(); });

  // 既に新順序なら中断
  if (currentHeaders[0]==='会社名' && currentHeaders[1]==='業種' && currentHeaders[3]==='ステージ') {
    Logger.log('✅ 既に新順序'); return { ok:true, message:'既に新順序です' };
  }

  // ヘッダー名→現在の列インデックス(0始まり)マップ
  var headerIdx = {};
  currentHeaders.forEach(function(h, i){ if(h) headerIdx[h] = i; });

  var newOrder = PROSPECT_HEADERS; // 20列の新ヘッダー配列

  var lastRow = sheet.getLastRow();
  var allData = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  // 新順序でデータを再構築
  var newRows = allData.map(function(row) {
    return newOrder.map(function(h) {
      var idx = headerIdx[h];
      return (idx !== undefined && idx < row.length) ? row[idx] : '';
    });
  });

  // シートを全クリアして書き直し
  sheet.clearContents();
  var hdrRange = sheet.getRange(1, 1, 1, newOrder.length);
  hdrRange.setValues([newOrder]).setFontWeight('bold').setBackground('#dde3ff');

  // 列幅を見やすく設定
  var widths = [160,80,70,80,60,90,70,60,110,120,160,160,60,90,120,200,80,80,120,60];
  widths.forEach(function(w, i){ try{ sheet.setColumnWidth(i+1, w); }catch(e){} });

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newOrder.length).setValues(newRows);
  }

  Logger.log('✅ 列並べ替え完了: ' + (lastRow - 1) + '件');
  return { ok: true, message: '列並べ替え完了 (' + (lastRow - 1) + '件)' };
}

// S列「AIスコア」・T列「推奨商材」ヘッダーを追加（1回だけ実行）
function migrateAddScoreColumns() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var sVal = String(sheet.getRange(1, PC.AI_SCORE).getValue()).trim();
  var tVal = String(sheet.getRange(1, PC.TOP_PRODUCT).getValue()).trim();
  if (sVal === 'AIスコア' && tVal === '推奨商材') {
    Logger.log('✅ 既に移行済み（S=AIスコア, T=推奨商材）'); return;
  }
  sheet.getRange(1, PC.AI_SCORE).setValue('AIスコア').setFontWeight('bold').setBackground('#faf5ff');
  sheet.getRange(1, PC.TOP_PRODUCT).setValue('推奨商材').setFontWeight('bold').setBackground('#faf5ff');
  Logger.log('✅ S列（AIスコア）・T列（推奨商材）追加完了');
}

function migrateExtractRoleColumn() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  if (String(sheet.getRange(1, PC.ROLE).getValue()) === '役職') {
    Logger.log('✅ 既に移行済み（Q列=役職）'); return;
  }
  sheet.getRange(1, PC.ROLE).setValue('役職').setFontWeight('bold');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) { Logger.log('✅ ヘッダーのみ追加（データなし）'); return; }
  var data = sheet.getRange(2, PC.CONTACT, lastRow - 1, 1).getValues();
  var updated = 0;
  for (var i = 0; i < data.length; i++) {
    var full = String(data[i][0] || '').trim();
    if (!full) continue;
    // "田中（部長）" or "田中(部長)" → name/role分割
    var m = full.match(/^(.+?)[\（(]([^\）)]+)[\）)]$/);
    if (m) {
      sheet.getRange(i + 2, PC.CONTACT).setValue(m[1].trim());
      sheet.getRange(i + 2, PC.ROLE).setValue(m[2].trim());
      updated++;
    }
  }
  Logger.log('✅ 役職分離完了: ' + updated + '社 / Q列ヘッダー追加');
  return { updated: updated };
}

// P列「担当者リスト」ヘッダーを追加（1回だけ実行）
function migrateAddContactsColumn() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var header = String(sheet.getRange(1, PC.CONTACTS).getValue()).trim();
  if (header === '担当者リスト') { Logger.log('✅ 既に追加済み'); return; }
  sheet.getRange(1, PC.CONTACTS).setValue('担当者リスト').setFontWeight('bold');
  Logger.log('✅ P列に「担当者リスト」ヘッダーを追加しました');
}

// 全リストの電話番号が結合されているものを分割修正
// 会社番号 → PHONE列, 担当者携帯 → メモに【携帯】として追記
function fixAllPhoneNumbers() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) { Logger.log('データなし'); return; }

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var fixed = 0;

  for (var i = 0; i < data.length; i++) {
    var raw = String(data[i][PC.PHONE - 1] || '').trim();
    if (!raw) continue;

    // 文字列中の全電話番号を抽出
    var allNums = raw.match(/0\d{1,4}[-\s]?\d{2,4}[-\s]?\d{4}/g);
    if (!allNums || allNums.length <= 1) continue; // 1件以下なら問題なし

    var mainPhone = allNums[0];
    var subNums   = allNums.slice(1);
    var company   = String(data[i][PC.COMPANY - 1] || '');

    // PHONE列を会社番号のみに
    sheet.getRange(i + 2, PC.PHONE).setValue(mainPhone);

    // 2つ目以降を直電列に保存（既存がなければ）
    var existingDirect = String(data[i][PC.DIRECT_PHONE - 1] || '').trim();
    if (!existingDirect && subNums.length) {
      sheet.getRange(i + 2, PC.DIRECT_PHONE).setValue(subNums.join(' / '));
    }

    Logger.log('行' + (i+2) + ' ' + company + ': ' + raw + ' → 会社:' + mainPhone + ' / 携帯:' + subNums.join(', '));
    fixed++;
  }

  Logger.log('✅ 修正完了: ' + fixed + '件');
  return { fixed: fixed };
}

// 株式会社花森の情報を正確に修正
function fixHanamori() {
  var sheet = getProspectSheet_();
  if (!sheet) { Logger.log('シートエラー'); return; }
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var company = String(data[i][PC.COMPANY - 1] || '');
    if (company.indexOf('花森') === -1) continue;

    var row = i + 1;
    // 会社名を正式名称に戻す
    sheet.getRange(row, PC.COMPANY).setValue('株式会社花森');

    // 電話番号を分割（2つ連結されているので最初の固定電話だけ使う）
    var rawPhone = String(data[i][PC.PHONE - 1] || '');
    var fixedPhone = rawPhone.match(/0\d{1,4}-\d{2,4}-\d{4}/);
    if (fixedPhone) {
      sheet.getRange(row, PC.PHONE).setValue(fixedPhone[0]);
      Logger.log('電話番号修正: ' + rawPhone + ' → ' + fixedPhone[0]);
    }

    // URLをトップページに修正
    sheet.getRange(row, PC.URL).setValue('https://www.hanamori-k.co.jp/');

    // 所在地を正確に
    sheet.getRange(row, PC.PREF).setValue('愛知県');

    Logger.log('✅ 修正完了 (行' + row + '): 株式会社花森 / ' + (fixedPhone ? fixedPhone[0] : rawPhone));
    return;
  }
  Logger.log('花森が見つかりませんでした');
}

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
      var nameStr = String(p.name || '').trim();
      if (!nameStr) return; // 名前なしはスキップ
      var key = nameStr.toLowerCase().replace(/[\s　（）()株式会社有限会社合同会社]/g, '');
      if (!seen[key]) { seen[key] = true; combined.push(p); }
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
    sheet.getRange(1, 1, 1, PROSPECT_HEADERS.length).setValues([PROSPECT_HEADERS]);
    sheet.getRange(1, 1, 1, PROSPECT_HEADERS.length).setFontWeight('bold');
  }

  var lastRow = sheet.getLastRow();
  var added = 0, skipped = 0;

  // 重複チェック: T番号優先 → 正規化社名フォールバック
  var existingCorpNums = {};
  var existingNormNames = {};
  if (lastRow > 1) {
    var existing = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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

    var row = new Array(21).fill('');
    row[PC.COMPANY     - 1] = expandCompanyAbbr_(p.name);
    row[PC.INDUSTRY    - 1] = (p.industry || '').slice(0, 20);
    row[PC.PREF        - 1] = p.pref      || '';
    row[PC.STAGE       - 1] = '未架電';
    row[PC.PHONE       - 1] = p.phone     || '';
    row[PC.URL         - 1] = p.website   || '';
    row[PC.CALL_COUNT  - 1] = 0;
    row[PC.MEMO        - 1] = p.address   || '';
    row[PC.SOURCE      - 1] = p.source    || 'リード発掘';
    row[PC.LIST_TYPE   - 1] = p.listType  || '営業';
    row[PC.CORP_NUM    - 1] = cn;

    sheet.appendRow(row);
    if (cn) existingCorpNums[cn] = true;
    existingNormNames[nm] = true;
    lastRow++;
    added++;
  }
  return { added: added, skipped: skipped };
}

function getProspects(limit) {
  limit = limit || 99999;
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var cols = Math.max(sheet.getLastColumn(), 21);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var result = [];

  data.forEach(function(row, idx) {
    var company = String(row[PC.COMPANY - 1] || '').trim();
    if (!company) return;
    result.push({
      rowIndex:    idx + 2,
      company:     company,
      contact:     String(row[PC.CONTACT     - 1] || '').trim(),
      phone:       String(row[PC.PHONE       - 1] || '').trim(),
      email:       String(row[PC.EMAIL       - 1] || '').trim(),
      url:         String(row[PC.URL         - 1] || '').trim(),
      industry:    String(row[PC.INDUSTRY    - 1] || '').trim(),
      pref:        String(row[PC.PREF        - 1] || '').trim(),
      source:      String(row[PC.SOURCE      - 1] || '').trim(),
      stage:       String(row[PC.STAGE       - 1] || '').trim(),
      callCount:   row[PC.CALL_COUNT  - 1],
      callDate:    formatSheetDate_(row[PC.CALL_DATE - 1]),
      apo:         formatSheetDate_(row[PC.APO       - 1]),
      memo:        String(row[PC.MEMO        - 1] || '').trim(),
      corpNum:     String(row[PC.CORP_NUM    - 1] || '').trim(),
      directPhone: String(row[PC.DIRECT_PHONE- 1] || '').trim(),
      contacts:    String(row[PC.CONTACTS    - 1] || ''),
      role:        String(row[PC.ROLE        - 1] || '').trim(),
      listType:    String(row[PC.LIST_TYPE   - 1] || '営業').trim(),
      aiScore:     parseInt(row[PC.AI_SCORE   - 1]) || 0,
      topProduct:  String(row[PC.TOP_PRODUCT  - 1] || '').trim(),
      capital:     String(row[PC.CAPITAL      - 1] || '').trim(),
    });
  });
  // アクティブなステージを必ず含める（limitで押し出されないよう優先）
  var ACTIVE_STAGES = {'アポ確定':1,'商談中':1,'追い中':1,'見積提出':1,'受注':1,'興味あり':1};
  var active = result.filter(function(p){ return ACTIVE_STAGES[p.stage]; });
  var rest   = result.filter(function(p){ return !ACTIVE_STAGES[p.stage]; });
  var combined = active.concat(rest.slice(-(Math.max(limit - active.length, 0))));
  combined.sort(function(a,b){ return b.rowIndex - a.rowIndex; });
  return combined;
}

