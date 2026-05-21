// ─── AIトークスクリプト生成 ────────────────────────────────────

function generateTalkScript(rowIndex) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 21).getValues()[0];

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
    'claude-haiku-4-5-20251001'
  );

  if (!result) return { error: 'スクリプト生成失敗' };
  return { success: true, script: result };
}

// ─── AIメール個別化生成 ─────────────────────────────────────────

function generatePersonalizedEmail(rowIndex, templateId, note) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var row = sheet.getRange(rowIndex, 1, 1, 21).getValues()[0];

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
    'claude-haiku-4-5-20251001', 800
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
  var data  = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
  var row = sheet.getRange(rowIndex, 1, 1, 21).getValues()[0];

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
  var row = sheet.getRange(rowIndex, 1, 1, 21).getValues()[0];

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
    '⑤ 業務用エアコン入替・新設（飲食・工場・倉庫・店舗向け）',
    '⑥ キュービクル（高圧受電設備）更新・点検（大型施設・工場・テナントビル向け）',
    !hasWeb ? '⑦ HP提案紹介（HP未保有 → Web制作業者へ橋渡し。「無料でいい業者紹介できますよ」で関係構築）' : '',
    '',
    '【重要】approachは "call"/"email"/"visit"/"seed" のいずれかで返すこと。',
    '"seed" = 今すぐ売らず認知・関係構築を目的とするアクション',
    '',
    '以下のJSON（必須・日本語）を返す:',
    '{',
    '  "score": 7,',
    '  "scoreReason": "この会社固有の根拠1文（業種・規模・電力消費等から）",',
    '  "subIndustry": "業種をより具体的に分類（例: 設計事務所なら「住宅設計」「店舗設計」「オフィス設計」「医療設計」「工場設計」/ 工務店なら「新築住宅」「リフォーム」「店舗工事」/ 不明なら空文字）",',
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

  // JSONのみ返答を強制（コードブロック・説明文なし）
  var jsonSuffix = '\n\n重要: 上記JSONオブジェクトのみ出力。```コードブロック不要。説明文・前置き一切不要。最初の文字は{であること。';
  var finalPrompt = (deep ? deepPrompt : prompt) + jsonSuffix;

  var model  = deep ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
  var tokens = deep ? 6000 : 3000;
  var text = callClaude(system, finalPrompt, model, tokens);
  if (!text) return { error: 'Claude API接続失敗（APIキーを確認してください）' };
  if (String(text).indexOf('__CLAUDE_ERR__:') === 0) return { error: 'Claude APIエラー: ' + text.slice(15) };

  // コードブロック除去してからJSON抽出
  var stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  var raw = extractOutermostJson_(stripped) || extractOutermostJson_(text);
  if (!raw) {
    Logger.log('JSON not found. Response start: ' + text.substring(0, 300));
    return { error: 'AI応答の解析に失敗しました（JSON未検出）' };
  }

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
    // AIスコア・推奨商材・サブ業種を永続保存
    if (result.score) {
      sheet.getRange(rowIndex, PC.AI_SCORE).setValue(parseInt(result.score) || 0);
    }
    if (topProd) {
      sheet.getRange(rowIndex, PC.TOP_PRODUCT).setValue(topProd);
    }
    // subIndustry が返ってきたら業種フィールドを「業種（詳細）」形式で更新
    var sub = String(result.subIndustry || '').trim();
    // ハルシネーションガード: 15文字以下・日本語・英字のみ
    var subValid = sub && sub.length <= 15 && /^[぀-ヿ一-鿿＀-￯a-zA-Z0-9・\-\/]+$/.test(sub);
    if (subValid) {
      var curIndustry = String(sheet.getRange(rowIndex, PC.INDUSTRY).getValue() || '').trim();
      // すでに（）付きなら上書きしない（手動設定を尊重）
      if (curIndustry && !curIndustry.match(/（.+）/)) {
        var baseIndustry = curIndustry.split('（')[0].trim();
        sheet.getRange(rowIndex, PC.INDUSTRY).setValue(baseIndustry + '（' + sub + '）');
      } else if (!curIndustry && industry && !industry.match(/（.+）/)) {
        sheet.getRange(rowIndex, PC.INDUSTRY).setValue(industry + '（' + sub + '）');
      }
    }
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

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
        'claude-haiku-4-5-20251001', 30
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

