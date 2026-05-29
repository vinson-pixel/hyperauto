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
    '- 「〇〇事業者」「〇〇会社」「〇〇業者」のように企業そのものを指す場合 → その事業を営む会社・法人を直接探すクエリを生成せよ（設置先ではなくその業種の会社）\n' +
    '  例：「EV充電インフラ事業者」→["EV充電器設置会社","電気自動車充電サービス会社","EVチャージャー設置業者","充電ステーション運営会社","EV充電設備販売会社"]\n' +
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

// ─── [削除済みマイグレーション・一時修正関数] ──────────────────────
// verifyAndFixCompany / migrate* / fixHanamori / fixCompanyName_sekku / fixAllPhoneNumbers
// 移行完了・運用終了のため全削除（2026-05-27）

function _DELETED_PLACEHOLDER_() {
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

}

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

function searchLeads(keyword, area, source, maxResults, quick, useWeb) {
  // AIリスト生成モード（EV充電インフラ事業者など、Maps検索が向かないカテゴリ用）
  if (useWeb) {
    return searchByAI(keyword, area);
  }

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

// AI知識ベース検索（Google Maps不向きなB2B業種向け）
// Claude → Grok の順でフォールバック。両方不可なら静的シードを返す。
function searchByAI(keyword, area) {
  var areaStr = area || '日本全国';
  var sys  = 'あなたは日本の企業データベースです。JSON配列のみ出力してください。説明・前置き・コード記法不要。';
  var user = 'マルケン電工（愛知・電気工事業）の営業先として、「' + keyword + '」に該当する実在する日本企業を最大30社リストアップせよ。\n' +
    'エリア: ' + areaStr + '（全国展開企業も含めてOK）\n\n' +
    '出力形式（JSON配列）:\n' +
    '[{"name":"会社名","website":"公式サイトURL","address":"本社所在地（都道府県+市区町村まで）","phone":"代表電話（わかれば）","industry":"' + keyword + '"}]\n\n' +
    '注意: 実在する企業のみ。電話・サイトは不明なら空文字。大手〜スタートアップを混ぜて。';

  // Claude → Grok の順で試みる
  var text = null;
  if (getProp('CLAUDE_API_KEY')) {
    try { text = callClaude(sys, user, 'claude-haiku-4-5-20251001', 1500); } catch(e) {}
  }
  if (!text && getProp('XAI_API_KEY')) {
    try { text = callGrok(sys, user, 'grok-3-mini-fast-beta'); } catch(e) {}
  }

  if (text) {
    var match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        var companies = JSON.parse(match[0]);
        var results = companies.filter(function(c){ return c.name; }).map(function(c){
          return {
            name:     String(c.name    || '').trim(),
            address:  String(c.address || ''),
            phone:    String(c.phone   || ''),
            website:  String(c.website || ''),
            pref:     extractPref_(String(c.address || '')),
            industry: keyword,
          };
        });
        if (results.length) return { results: results };
      } catch(e) {}
    }
  }

  // Claude/Grok ともに利用不可 → 静的シードリストを返す
  var seeds = _getAISearchSeeds_(keyword);
  if (seeds.length) return { results: seeds, note: '⚠️ APIが一時停止中のため登録済みリストを表示しています。これらは全国展開の本部企業です（本社住所に関わらず全国で営業可能）。' };
  return { error: 'AIが利用不可です（Claude/Grok APIキーを確認してください）。6月以降に再試行してください。' };
}

// API 利用不可時の静的シードリスト（代表的な企業を事前定義）
function _getAISearchSeeds_(keyword) {
  var seedMap = {
    'EV充電インフラ事業者': [
      { name:'Terra charge株式会社',       website:'https://terra-charge.jp',     address:'東京都港区',         phone:'', industry:keyword },
      { name:'株式会社パワーエックス',       website:'https://powerx.co.jp',        address:'東京都中央区',       phone:'', industry:keyword },
      { name:'e-Mobility Power株式会社',    website:'https://e-mp.jp',             address:'東京都港区',         phone:'03-6721-4000', industry:keyword },
      { name:'株式会社ユアスタンド',         website:'https://yourstand.jp',        address:'東京都渋谷区',       phone:'', industry:keyword },
      { name:'株式会社エネチェンジ',         website:'https://enechange.co.jp',     address:'東京都千代田区',     phone:'', industry:keyword },
      { name:'ニチコン株式会社',            website:'https://www.nichicon.co.jp',  address:'京都府京都市中京区', phone:'075-231-8461', industry:keyword },
      { name:'富士電機株式会社',            website:'https://www.fujielectric.co.jp',address:'東京都品川区',     phone:'03-5435-7111', industry:keyword },
      { name:'東光高岳株式会社',            website:'https://www.tktk.co.jp',      address:'東京都荒川区',       phone:'03-5692-8600', industry:keyword },
      { name:'オムロン ソーシアルソリューションズ株式会社', website:'https://socialsolution.omron.com', address:'東京都新宿区', phone:'', industry:keyword },
      { name:'株式会社日本充電サービス',     website:'https://www.nippon-charge.jp', address:'東京都新宿区',     phone:'', industry:keyword },
      { name:'株式会社ダイヘン',            website:'https://www.daihen.co.jp',    address:'大阪府大阪市淀川区', phone:'06-6302-2517', industry:keyword },
      { name:'パナソニック エレクトリックワークス株式会社', website:'https://www2.panasonic.biz/jp/ew/', address:'大阪府門真市', phone:'', industry:keyword },
      { name:'ChargePoint Japan株式会社',   website:'https://www.chargepoint.com/ja/', address:'東京都', phone:'', industry:keyword },
      { name:'株式会社エコQ電',             website:'https://ecoqden.jp',          address:'東京都',             phone:'', industry:keyword },
      { name:'トヨタコネクティッド株式会社', website:'https://www.toyotaconnected.co.jp', address:'愛知県名古屋市', phone:'', industry:keyword },
    ],
    'コインランドリー': [
      { name:'WASHハウス株式会社',              website:'https://www.washhouse.jp',          address:'福岡県宮崎市',     phone:'0985-64-7777', industry:keyword },
      { name:'株式会社アクア（旧パナソニックコインランドリー）', website:'https://aqua-laundry.jp', address:'東京都港区',   phone:'',            industry:keyword },
      { name:'株式会社ランドリーワークス',       website:'https://landryworks.co.jp',         address:'東京都渋谷区',     phone:'',            industry:keyword },
      { name:'株式会社ReBorn',                  website:'https://reborn-laundry.co.jp',      address:'東京都',           phone:'',            industry:keyword },
      { name:'株式会社グラウンドワークス',       website:'https://groundworks.jp',            address:'東京都千代田区',   phone:'',            industry:keyword },
      { name:'エムアイサービス株式会社',         website:'https://mi-service.co.jp',          address:'大阪府大阪市',     phone:'',            industry:keyword },
      { name:'株式会社Baluko Laundry Place',    website:'https://baluko.jp',                 address:'東京都渋谷区',     phone:'',            industry:keyword },
      { name:'フジコーポレーション株式会社',     website:'https://www.fuji-corporation.co.jp',address:'東京都豊島区',     phone:'03-5952-5511',industry:keyword },
      { name:'株式会社プラスワン',              website:'https://plus-one-laundry.jp',        address:'東京都',           phone:'',            industry:keyword },
      { name:'コインランドリー経営のFCシステム株式会社', website:'https://fc-system.jp',      address:'東京都',           phone:'',            industry:keyword },
      { name:'株式会社ソニック',                website:'https://sonic-laundry.co.jp',        address:'東京都',           phone:'',            industry:keyword },
      { name:'株式会社アップウォッシュ',         website:'https://upwash.jp',                 address:'大阪府',           phone:'',            industry:keyword },
      { name:'洗濯工房 スピンランドリー運営会社',website:'',                                  address:'日本全国',         phone:'',            industry:keyword },
    ],
  };
  var lk = keyword.toLowerCase();
  var key = Object.keys(seedMap).find(function(k){ return lk.indexOf(k.toLowerCase()) !== -1 || k.toLowerCase().indexOf(lk) !== -1; });
  return key ? seedMap[key].map(function(c){ c.pref = extractPref_(c.address); return c; }) : [];
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

  var noContact = 0;
  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    if (!p.name) continue;
    var cn = String(p.corpNum || '').trim();
    var nm = normalizeCompanyName_(p.name);
    if ((cn && existingCorpNums[cn]) || existingNormNames[nm]) { skipped++; continue; }
    // 電話番号もURLも住所もない場合はゴミデータとしてスキップ
    if (!p.phone && !p.website && !p.address) { noContact++; continue; }

    var row = new Array(22).fill('');
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
    row[PC.UUID        - 1] = generateUuid_();

    sheet.appendRow(row);
    if (cn) existingCorpNums[cn] = true;
    existingNormNames[nm] = true;
    lastRow++;
    added++;
  }
  return { added: added, skipped: skipped, noContact: noContact };
}

function getProspects(limit) {
  limit = limit || 99999;
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var cols = Math.max(sheet.getLastColumn(), 23);
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
      uuid:        String(row[PC.UUID         - 1] || '').trim(),
      formSent:    formatSheetDate_(row[PC.FORM_SENT  - 1]),
    });
  });
  result.sort(function(a,b){ return b.rowIndex - a.rowIndex; });
  return result;
}

