// ─── 週次フィードバック分析 ──────────────────────────────────────
function analyzeFeedback() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { summary: 'データなし', suggestions: [] };

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
    'claude-haiku-4-5-20251001', 600
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

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
// 施工パートナー登録が狙える会社（設計施工・施工監理あり）を東海＋関東で収集
var AUTO_KEYWORDS = [
  '建築設計事務所', '設計事務所', '工務店', '総合建設', 'ゼネコン',
  '施工管理会社', '建設会社', '内装施工', 'リフォーム施工会社', '電気設備設計',
  '設備工事会社', '建築工事会社', '商業施設建設', '医療施設建設', '工場建設'
];
var AUTO_AREAS = [
  // 東海（愛知）
  '名古屋市中区', '名古屋市中村区', '名古屋市東区', '名古屋市千種区',
  '名古屋市西区', '名古屋市北区', '名古屋市昭和区', '名古屋市瑞穂区',
  '名古屋市名東区', '名古屋市守山区',
  '豊田市', '岡崎市', '豊橋市', '一宮市', '刈谷市',
  // 東海（静岡・岐阜・三重）
  '静岡市', '浜松市', '岐阜市', '四日市市', '津市',
  // 関東（東京）
  '千代田区', '中央区', '港区', '新宿区', '渋谷区',
  '品川区', '大田区', '世田谷区', '江東区', '豊島区',
  // 関東（神奈川・埼玉・千葉）
  '横浜市西区', '横浜市中区', '川崎市', 'さいたま市', '千葉市',
  // 中国（広島）
  '広島市中区', '広島市西区', '広島市南区', '福山市'
];

// 未スコアのリードを1回最大20社、AIで自動採点してS・T列に保存
function autoScoreLeads() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { scored: 0 };

  var cols = Math.max(sheet.getLastColumn(), 21);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();

  // 未スコア（E列=0 or 空）の営業リードを最大20件取得
  var targets = [];
  for (var i = 0; i < data.length; i++) {
    var stage    = String(data[i][PC.STAGE      - 1] || '');
    var listType = String(data[i][PC.LIST_TYPE  - 1] || '営業');
    var aiScore  = parseInt(data[i][PC.AI_SCORE - 1]) || 0;
    var company  = String(data[i][PC.COMPANY    - 1] || '').trim();
    if (!company) continue;
    if (listType === '協力会社') continue;
    if (stage === '失注' || stage === '受注') continue;
    if (aiScore > 0) continue;
    targets.push({ rowIndex: i + 2, rowData: data[i] });
    if (targets.length >= 20) break;
  }

  var scored = 0;
  targets.forEach(function(t) {
    try {
      var result = _analyzeCompanyInternal(t.rowIndex, false);
      if (result && result.analysis && result.analysis.score) scored++;
      Utilities.sleep(3000); // API rate limit
    } catch(e) { Logger.log('autoScore error: ' + e); }
  });

  Logger.log('✅ autoScoreLeads: ' + scored + '社採点');
  return { scored: scored };
}

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
  Logger.log(msg);
  return { added: totalAdded, nextIdx: nextIdx, total: total };
}

// ─── リード条件フィルタ（夜間バッチ）────────────────────────────────
// スクリプトプロパティ LEAD_CONDITIONS に条件を記述
// 例: "施工監理をしている / 資本金1000万円以上または従業員10名以上"
var DEFAULT_LEAD_CONDITIONS =
  '施工監理・工事監理を行う設計事務所・建設会社・工務店（電気工事の協力業者を必要とする発注元）/ ' +
  '電気工事の外注・下請けを活用している or しそうな規模感（資本金1000万円以上 or 従業員10名以上）/ ' +
  'コンビニ・飲食店・小売店・個人宅・電気店は除外';

function filterLeadsBatch() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { checked: 0 };

  var conditions = getProp('LEAD_CONDITIONS') || DEFAULT_LEAD_CONDITIONS;
  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();

  // 未チェック（未架電 + URLあり + メモに[条件NG]なし + まだフィルタ未実施）を最大10件処理
  var BATCH = 10;
  var checked = 0, passed = 0, rejected = 0;

  for (var i = 0; i < data.length && checked < BATCH; i++) {
    var stage   = String(data[i][PC.STAGE   - 1] || '').trim();
    var url     = String(data[i][PC.URL     - 1] || '').trim();
    var memo    = String(data[i][PC.MEMO    - 1] || '');
    var company = String(data[i][PC.COMPANY - 1] || '').trim();
    var industry= String(data[i][PC.INDUSTRY- 1] || '').trim();

    // 未架電 + URLあり + まだフィルタ未実施のみ対象
    if (stage !== '未架電') continue;
    if (memo.indexOf('[条件OK]') !== -1 || memo.indexOf('[条件NG]') !== -1) continue;

    checked++;
    var siteText = url ? fetchSiteText_(url) : '';
    var prompt =
      '以下の会社が営業ターゲット条件に合うか判断してください。\n' +
      '条件: ' + conditions + '\n\n' +
      '会社名: ' + company + '\n業種: ' + industry + '\n' +
      (siteText ? 'サイト情報:\n' + siteText.slice(0, 1500) : 'サイト情報なし') + '\n\n' +
      '「OK」か「NG」の1単語のみ回答。不明な場合はOK。';

    var result = callClaude('条件判定', prompt, 'claude-haiku-4-5-20251001', 10);
    var isOk = !result || result.trim().toUpperCase().indexOf('NG') === -1;

    var newMemo = memo + (memo ? '\n' : '') + (isOk ? '[条件OK]' : '[条件NG]');
    sheet.getRange(i + 2, PC.MEMO).setValue(newMemo);
    if (!isOk) {
      sheet.getRange(i + 2, PC.STAGE).setValue('対象外');
      rejected++;
    } else {
      passed++;
    }
    Utilities.sleep(400);
  }

  Logger.log('条件フィルタ: ' + checked + '件チェック / OK:' + passed + ' / NG:' + rejected);
  return { checked: checked, passed: passed, rejected: rejected };
}

// ─── 飛び込み営業リスト ──────────────────────────────────────────
function getVisitList(area, maxCount) {
  var sheet = getProspectSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
    'aircon':     {
      name: '業務用エアコン入替・新設',
      subject: '業務用エアコンの入替・新設｜補助金活用・工事込み対応｜マルケン電工',
      angle: '飲食店・工場・倉庫・店舗向け。設備工事から施工まで一括対応。補助金活用で費用削減。',
    },
    'cubicle':    {
      name: 'キュービクル更新・点検',
      subject: 'キュービクル（高圧受電設備）の更新・定期点検｜マルケン電工',
      angle: '工場・大型テナントビル・医療施設・学校向け。老朽化設備の更新や法定点検を入口に長期保守へ。',
    },
  };
  var prod = productMap[product] || productMap['energy'];

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
        'claude-haiku-4-5-20251001', 500
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


// ─── 広島電気工事組合 バッチインポート ───────────────────────────────
// GAS実行時間上限(6分)対策のため1回60社ずつ処理。
// ScriptPropertyの HIROSHIMA_CURSOR でどこまで処理したか管理する。

var HIROSHIMA_CURSOR_KEY  = 'HIROSHIMA_CURSOR';
var LIST_OPP_CACHE_KEY    = 'LIST_OPPORTUNITIES_JSON';

// ─── リスト機会分析 ─────────────────────────────────────────────────

function analyzeListOpportunities() {
  var prospects = getProspects(5000);
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  if (!prospects.length) return { ok: false, error: 'データなし' };

  // ── 集計 ─────────────────────────────────────────────────────────
  var total     = prospects.length;
  var noUrl     = prospects.filter(function(p){ return !p.url; }).length;
  var noPhone   = prospects.filter(function(p){ return !p.phone; }).length;
  var called    = prospects.filter(function(p){ return (p.callCount||0) > 0; }).length;
  var uncalled  = total - called;

  // ステージ分布
  var stageMap = {};
  prospects.forEach(function(p) {
    var s = p.stage || '未架電';
    stageMap[s] = (stageMap[s] || 0) + 1;
  });

  // 業種 TOP10
  var indMap = {};
  prospects.forEach(function(p) {
    var ind = (p.industry || '不明').split('（')[0].trim().slice(0, 15);
    indMap[ind] = (indMap[ind] || 0) + 1;
  });
  var indTop = Object.keys(indMap)
    .sort(function(a,b){ return indMap[b]-indMap[a]; })
    .slice(0,10)
    .map(function(k){ return { name:k, count:indMap[k] }; });

  // エリア TOP8
  var prefMap = {};
  prospects.forEach(function(p) {
    var pref = p.pref || '不明';
    prefMap[pref] = (prefMap[pref]||0) + 1;
  });
  var prefTop = Object.keys(prefMap)
    .sort(function(a,b){ return prefMap[b]-prefMap[a]; })
    .slice(0,8)
    .map(function(k){ return { pref:k, count:prefMap[k] }; });

  // AIスコア分布
  var scoreHigh = prospects.filter(function(p){ return (p.aiScore||0) >= 8; }).length;
  var scoreMid  = prospects.filter(function(p){ var s=p.aiScore||0; return s>=6&&s<8; }).length;
  var scoreNone = prospects.filter(function(p){ return !(p.aiScore||0); }).length;
  var highUncalled = prospects.filter(function(p){ return (p.aiScore||0)>=7 && !(p.callCount||0); }).length;

  // 長期放置（架電あり・最終架電30日超・スコア6以上）
  var today = new Date(); today.setHours(0,0,0,0);
  var stale = prospects.filter(function(p) {
    if ((p.aiScore||0) < 6) return false;
    if (!(p.callDate)) return false;
    var d = new Date(p.callDate.replace(/\//g,'-'));
    return !isNaN(d) && (today - d) / 86400000 > 30;
  }).length;

  // source / listType 分布
  var sourceMap = {};
  prospects.forEach(function(p) {
    var s = (p.source||'不明').slice(0,20);
    sourceMap[s] = (sourceMap[s]||0) + 1;
  });

  // HP未確認×業種（どの業種にHP紹介が刺さるか）
  var noUrlByInd = {};
  prospects.filter(function(p){ return !p.url; }).forEach(function(p) {
    var ind = (p.industry||'不明').split('（')[0].trim().slice(0,15);
    noUrlByInd[ind] = (noUrlByInd[ind]||0) + 1;
  });
  var noUrlIndTop = Object.keys(noUrlByInd)
    .sort(function(a,b){ return noUrlByInd[b]-noUrlByInd[a]; })
    .slice(0,5)
    .map(function(k){ return k+'('+noUrlByInd[k]+'社)'; })
    .join(', ');

  // アポ率・受注率
  var apoCount = stageMap['アポ確定'] || 0;
  var wonCount = stageMap['受注'] || 0;
  var apoRate  = called ? Math.round(apoCount/called*100) : 0;

  var stats = {
    total: total, noUrl: noUrl, noPhone: noPhone,
    called: called, uncalled: uncalled,
    stageMap: stageMap,
    industryTop10: indTop, prefTop8: prefTop,
    scoreHigh: scoreHigh, scoreMid: scoreMid, scoreNone: scoreNone,
    highScoreUncalled: highUncalled, staleHighScore: stale,
    apoCount: apoCount, wonCount: wonCount, apoRate: apoRate,
    noUrlByIndustryTop5: noUrlIndTop,
    sourceBreakdown: sourceMap,
  };

  // ── Claude に分析させる ──────────────────────────────────────────
  var prompt = [
    '【マルケン電工とは】',
    MARUKEN_PROFILE,
    '',
    '【営業リストの統計データ（' + now + '時点）】',
    JSON.stringify(stats, null, 0),
    '',
    '上記データを基に、マルケン電工のリストに眠っているビジネス機会をトップ5で分析してください。',
    '電気工事以外の収益源（紹介ビジネス・アライアンス・新商材）も含めて考えてください。',
    '',
    '以下のJSON形式で返してください（日本語・JSONのみ・説明文不要）:',
    '{',
    '  "opportunities": [',
    '    {',
    '      "rank": 1,',
    '      "title": "機会のタイトル（20字以内）",',
    '      "category": "web紹介|alliance|新商材|架電優先|リスト活用 のいずれか",',
    '      "evidence": "リストデータから読み取れる根拠（数字を含む1文）",',
    '      "potentialRevenue": "推定収益（例: 月15〜30万円）",',
    '      "difficulty": "易|中|難",',
    '      "nextAction": "明日できる具体的な1アクション（30字以内）",',
    '      "urgency": 8',
    '    }',
    '  ],',
    '  "topAlert": "今すぐ動くべき最重要インサイト1文（50字以内）",',
    '  "blindSpot": "見落としがちだが実は大きいチャンス1文"',
    '}',
  ].join('\n');

  var result = callClaudeJSON(
    'マルケン電工の営業担当として、リストデータからビジネス機会を発見するプロフェッショナルアナリスト。JSONのみ出力。',
    prompt,
    'claude-sonnet-4-6'
  );

  if (!result) return { ok: false, error: 'Claude分析失敗', stats: stats };

  var output = { ok: true, opportunities: result, stats: stats, analyzedAt: now };
  // キャッシュ保存（script properties は 9KB 制限のため stringify して保存）
  try {
    var json = JSON.stringify(output);
    if (json.length <= 7000) {
      PropertiesService.getScriptProperties().setProperty(LIST_OPP_CACHE_KEY, json);
    } else {
      // フル出力が大きすぎる場合は機会部分のみ保存
      var slim = { ok: true, opportunities: result, analyzedAt: now };
      var slimJson = JSON.stringify(slim);
      if (slimJson.length <= 7000) {
        PropertiesService.getScriptProperties().setProperty(LIST_OPP_CACHE_KEY, slimJson);
      } else {
        Logger.log('機会分析キャッシュ容量超過: ' + slimJson.length + '文字');
      }
    }
  } catch(e) { Logger.log('機会分析キャッシュ保存失敗: ' + e); }

  return output;
}

function getListOpportunities() {
  var cached = PropertiesService.getScriptProperties().getProperty(LIST_OPP_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  // キャッシュなし → 簡易集計だけ返す（分析は夜間バッチに任せる）
  return { ok: false, message: '分析中… 初回は夜間バッチ（23時）で実行されます。' };
}

function batchImportHiroshima() {
  var apiKey = getProp('MAPS_API_KEY');
  if (!apiKey) return { error: 'MAPS_API_KEY がスクリプトプロパティに未設定です' };

  var companies = getHiroshimaCompanyList_();
  var cursor    = parseInt(getProp(HIROSHIMA_CURSOR_KEY) || '0');

  if (cursor >= companies.length) {
    return { done: true, message: '全 ' + companies.length + ' 社の処理が完了しています。リセットするには resetHiroshimaImport() を実行してください。' };
  }

  var sheet   = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };

  // 既存会社名を取得（重複チェック用）
  var lastRow      = sheet.getLastRow();
  var existingNorm = {};
  if (lastRow > 1) {
    var existingData = sheet.getRange(2, PC.COMPANY, lastRow - 1, 1).getValues();
    existingData.forEach(function(r) {
      existingNorm[normalizeCompanyName_(String(r[0] || ''))] = true;
    });
  }

  var batch    = companies.slice(cursor, cursor + 60);
  var places   = [];

  for (var i = 0; i < batch.length; i++) {
    var name = batch[i];
    if (existingNorm[normalizeCompanyName_(name)]) continue;

    var info = hiroshimaLookup_(name, apiKey);
    places.push({
      name:     name,
      phone:    info.phone    || '',
      website:  info.website  || '',
      pref:     info.pref     || '広島県',
      address:  info.address  || '',
      industry: '電気工事業',
      source:   '広島電気工事組合',
    });
    Utilities.sleep(120); // API制限対策
  }

  // addProspects は source を '流入経路' に使うため、SOURCE列だけ '広島電気工事組合' に差し替え
  var sheet2  = getProspectSheet_();
  var added   = 0;
  var skipped = 0;
  for (var j = 0; j < places.length; j++) {
    var p   = places[j];
    var nm  = normalizeCompanyName_(p.name);
    if (existingNorm[nm]) { skipped++; continue; }

    var row = new Array(15).fill('');
    row[PC.COMPANY    - 1] = p.name;
    row[PC.PHONE      - 1] = p.phone;
    row[PC.URL        - 1] = p.website;
    row[PC.INDUSTRY   - 1] = p.industry;
    row[PC.PREF       - 1] = p.pref;
    row[PC.SOURCE     - 1] = '広島電気工事組合';
    row[PC.STAGE      - 1] = '未架電';
    row[PC.CALL_COUNT - 1] = 0;
    row[PC.MEMO       - 1] = p.address;
    row[PC.LIST_TYPE  - 1] = '協力会社';

    sheet2.appendRow(row);
    existingNorm[nm] = true;
    added++;
  }

  var newCursor = cursor + batch.length;
  PropertiesService.getScriptProperties().setProperty(HIROSHIMA_CURSOR_KEY, String(newCursor));

  return {
    added:     added,
    skipped:   skipped,
    cursor:    newCursor,
    total:     companies.length,
    remaining: Math.max(0, companies.length - newCursor),
    message:   added + '社追加 / ' + skipped + '社スキップ（' + newCursor + '/' + companies.length + '社処理済み、残り' + Math.max(0, companies.length - newCursor) + '社）',
  };
}

// 1社分のPlaces API検索（会社名 + 広島 でテキスト検索）
function hiroshimaLookup_(companyName, apiKey) {
  try {
    var res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri',
      },
      payload: JSON.stringify({ textQuery: companyName + ' 広島', languageCode: 'ja', regionCode: 'JP', maxResultCount: 1 }),
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    if (data.error || !data.places || !data.places.length) return {};
    var p    = data.places[0];
    var addr = p.formattedAddress || '';
    return {
      phone:   p.nationalPhoneNumber || '',
      website: p.websiteUri          || '',
      address: addr,
      pref:    extractPref_(addr),
    };
  } catch(e) {
    return {};
  }
}

// インポート進捗リセット（最初からやり直したいとき）
function resetHiroshimaImport() {
  PropertiesService.getScriptProperties().deleteProperty(HIROSHIMA_CURSOR_KEY);
  return { reset: true, message: 'カーソルをリセットしました。次回 batchImportHiroshima() を実行すると最初から処理します。' };
}

// 進捗確認
function getHiroshimaImportStatus() {
  var companies = getHiroshimaCompanyList_();
  var cursor    = parseInt(getProp(HIROSHIMA_CURSOR_KEY) || '0');
  return {
    cursor:    cursor,
    total:     companies.length,
    remaining: Math.max(0, companies.length - cursor),
    percent:   Math.floor(cursor / companies.length * 100),
    message:   cursor + '/' + companies.length + '社処理済み（' + Math.floor(cursor / companies.length * 100) + '%）',
  };
}

// 全1,772社を名前だけで即時一括インポート（電話/URLなし → 夜間バッチで補完）
function importAllHiroshimaQuick() {
  var companies = getHiroshimaCompanyList_();
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };

  var lastRow = sheet.getLastRow();
  var existingNorm = {};
  if (lastRow > 1) {
    var existingData = sheet.getRange(2, PC.COMPANY, lastRow - 1, 1).getValues();
    existingData.forEach(function(r) {
      existingNorm[normalizeCompanyName_(String(r[0] || ''))] = true;
    });
  }

  var places = [];
  companies.forEach(function(name) {
    var normalized = expandCompanyAbbr_(name.trim());
    if (!normalized) return;
    var key = normalizeCompanyName_(normalized);
    if (existingNorm[key]) return;
    places.push({
      name:     normalized,
      phone:    '',
      website:  '',
      pref:     '広島県',
      address:  '',
      industry: '電気工事業',
      source:   '広島電気工事組合',
      listType: '協力会社',
    });
    existingNorm[key] = true;
  });

  if (!places.length) return { ok: true, added: 0, skipped: companies.length, message: '全社インポート済み' };
  var r = addProspects(places);
  return { ok: true, added: r.added || 0, skipped: (companies.length - places.length) + (r.skipped || 0), message: (r.added || 0) + '社をリストに追加しました' };
}


// ─── リスト種別 マイグレーション ──────────────────────────────────────
// 既存行に「リスト種別」列（R列）を追加する。初回1回だけ実行。

function migrateAddListTypeColumn() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };

  // ヘッダーセット
  sheet.getRange(1, PC.LIST_TYPE).setValue('リスト種別');
  sheet.getRange(1, PC.LIST_TYPE).setFontWeight('bold');

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { migrated: 0 };

  // 既存行は全て '営業' をデフォルト設定
  // ただし SOURCE が '広島電気工事組合' の行は '協力会社' に設定
  var data = sheet.getRange(2, PC.SOURCE, lastRow - 1, 1).getValues();
  var values = data.map(function(r) {
    return [String(r[0] || '').trim() === '広島電気工事組合' ? '協力会社' : '営業'];
  });
  sheet.getRange(2, PC.LIST_TYPE, lastRow - 1, 1).setValues(values);

  return { migrated: lastRow - 1, message: (lastRow - 1) + '行にリスト種別を設定しました' };
}


// ─── 協力会社メール一括送信 ──────────────────────────────────────────

var PARTNER_JOB_IINOSHIMA = {
  title:    '広島・飯野島 貨物船照明交換',
  location: '広島県 飯野島',
  freq:     '2ヶ月に1回',
  duration: '3〜4日間（前乗り含め約1週間）',
  scale:    '作業員20名程度（電気工事士資格不要の方も可）',
  note:     '継続的にご参加いただける方・フルで入れる方を優先',
};

// メール本文生成
