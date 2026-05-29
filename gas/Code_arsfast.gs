var SUPABASE_URL  = 'https://yqqhnldrbzmkrpcnpqmt.supabase.co';
var SUPABASE_ANON = 'sb_publishable_u62lqaFf_3Njb2BF2pT9iA_1Q0MqzDd';

// 案件選択元スプレッドシート（一覧タブ）
var ARSFAST_SS_ID       = '1UptuKwGKdMiYGiyWwL55yLKXNQ5xkevKv-X0MVikcKw';
var ARSFAST_SHEET_GID   = 62240899;

// 一覧シート 追加列（N〜R）
var AF_COL_FLAG   = 14; // N: AFフラグ（○）
var AF_COL_TO     = 15; // O: 返信先メール（TO）
var AF_COL_CC     = 16; // P: CC
var AF_COL_THREAD = 17; // Q: スレッドID
var AF_COL_DETAIL = 18; // R: 依頼内容詳細

// 半角カタカナ → 全角カタカナに正規化（ｶﾞ→ガ など濁点結合も処理）
function normalizeJP(s) {
  var map = {
    'ｦ':'ヲ','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ',
    'ｯ':'ッ','ｰ':'ー','ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ',
    'ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ',
    'ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ',
    'ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ',
    'ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ',
    'ﾜ':'ワ','ﾝ':'ン'
  };
  var dak = {'カ':'ガ','キ':'ギ','ク':'グ','ケ':'ゲ','コ':'ゴ',
             'サ':'ザ','シ':'ジ','ス':'ズ','セ':'ゼ','ソ':'ゾ',
             'タ':'ダ','チ':'ヂ','ツ':'ヅ','テ':'デ','ト':'ド',
             'ハ':'バ','ヒ':'ビ','フ':'ブ','ヘ':'ベ','ホ':'ボ','ウ':'ヴ'};
  var han = {'ハ':'パ','ヒ':'ピ','フ':'プ','ヘ':'ペ','ホ':'ポ'};
  var res = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i], n = s[i + 1], fc = map[c];
    if (fc) {
      if (n === 'ﾞ' && dak[fc]) { res += dak[fc]; i++; }
      else if (n === 'ﾟ' && han[fc]) { res += han[fc]; i++; }
      else { res += fc; }
    } else { res += c; }
  }
  return res.replace(/[\s　]/g, '').toLowerCase();
}

// doGet はorchestrator.gsに一本化（ルーティング済み）

// ─── ヘルパー ─────────────────────────────────────────────────

function getSheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === gid) return sheets[i];
  }
  return null;
}

// Supabaseのarsfast未送信案件を全件取得（メールアドレス補完用）
function getAllArsfastFromSupabase_() {
  var url = SUPABASE_URL + '/rest/v1/work_reports'
    + '?select=id,site_no,site_name,site_address,site_tel,requester,work_type,request_detail,work_date,requested_at,reply_to_email,reply_cc_emails,in_reply_to'
    + '&client_format=eq.arsfast&status=neq.submitted&order=created_at.desc&limit=200';
  try {
    var res = UrlFetchApp.fetch(url, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      muteHttpExceptions: true,
      deadline: 8
    });
    var parsed = JSON.parse(res.getContentText());
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    Logger.log('getAllArsfastFromSupabase_ error: ' + e);
    return [];
  }
}

// "Name <email>" または "<email>" から email だけ取り出す
function extractEmailAddr_(s) {
  if (!s) return '';
  var m = String(s).match(/<([^>]+)>/);
  return m ? m[1].trim().toLowerCase() : String(s).trim().toLowerCase();
}

// 会社名でSupabaseレコードを探す（サイト詳細情報の補完用）
// 完全一致優先、部分一致は短い方が7文字以上の場合のみ（チェーン店名での誤爆防止）
function findSupaRecBySiteName_(supaOrders, company) {
  if (!company || !supaOrders.length) return null;
  var compLower = company.toLowerCase();
  var bestMatch = null, bestScore = 0;
  for (var j = 0; j < supaOrders.length; j++) {
    var sn = String(supaOrders[j].site_name || '').trim().toLowerCase();
    if (!sn) continue;
    if (sn === compLower) return supaOrders[j]; // 完全一致は即返す
    // 部分一致: 短い方が7文字以上の場合のみ（「ニトリ」「ウエルシア」などで誤爆しない）
    var shorter = Math.min(sn.length, compLower.length);
    if (shorter >= 7 && (sn.indexOf(compLower) !== -1 || compLower.indexOf(sn) !== -1)) {
      if (shorter > bestScore) { bestScore = shorter; bestMatch = supaOrders[j]; }
    }
  }
  return bestMatch;
}

// ─── 案件取得 ──────────────────────────────────────────────────

// 一覧シートの備考に [AF] タグがある未完了案件のみ取得
// メールアドレス等の詳細はSupabaseで補完
function getOrders() {
  try {
    var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
    var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
    if (!sheet) {
      Logger.log('getOrders: 一覧シートが見つかりません (gid=' + ARSFAST_SHEET_GID + ')');
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    var data       = sheet.getRange(2, 1, lastRow - 1, 18).getValues();  // A〜R列
    var supaOrders = getAllArsfastFromSupabase_();

    var orders = [];
    // パス1: 完了済み現場名を収集（重複検出用）※B列のみ使用、会社名フォールバックなし
    var DONE = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];
    var completedNm = {};
    var REPEAT_CUTOFF = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90日以内の完了のみ重複扱い
    data.forEach(function(row) {
      var st = String(row[10] || '').trim();
      var jDone = row[9] === true || String(row[9]).toLowerCase() === 'true';
      if (DONE.indexOf(st) !== -1 || jDone) {
        // 完了日（E列）が90日超なら繰り返し案件を許可（completedNmに追加しない）
        var cdRaw = row[4];
        var cd = cdRaw instanceof Date ? cdRaw : (cdRaw ? new Date(String(cdRaw)) : null);
        if (cd && !isNaN(cd.getTime()) && cd < REPEAT_CUTOFF) return;
        var nm = normalizeJP(String(row[1] || ''));
        if (nm.length >= 3) completedNm[nm] = true;
      }
    });

    var BLOCKED_TO = ['s.shigeno1016@gmail.com', 'mky7584gd@gmail.com'];
    data.forEach(function(row, idx) {
      var company      = String(row[0]  || '').trim(); // A: 会社名
      var siteName     = String(row[1]  || '').trim() || company; // B: 現場名（なければ会社名）
      var workType     = String(row[2]  || '').trim(); // C: 施工内容
      var workDate     = row[3];                       // D: 施工日
      var completeDate = row[4];                       // E: 完了日
      var aiDate       = row[5];                       // F: AIから転送日
      var status       = String(row[10] || '').trim(); // K: ステータス
      var afFlag       = String(row[13] || '').trim(); // N: AFフラグ
      var replyToRaw   = String(row[14] || '').trim().toLowerCase();
      var replyToEmail = BLOCKED_TO.indexOf(replyToRaw) !== -1 ? '' : String(row[14] || '').trim(); // O: 返信先メール
      var ccRaw        = String(row[15] || '').trim(); // P: CC
      var threadId     = String(row[16] || '').trim(); // Q: スレッドID
      var requestDetail= String(row[17] || '').trim(); // R: 依頼内容詳細

      // N列にAFフラグがない案件はスキップ
      if (!afFlag) return;
      // 完了済みステータスはスキップ（J列ではなくステータスで判断）
      if (DONE.indexOf(status) !== -1) return;
      if (!company) return;
      // 同じ現場名（B列のみ）で完了済み行が存在すれば重複とみなしてスキップ
      // ※会社名(A列)はフォールバックしない（複数案件を誤って除外するため）
      var siteNmForDup = normalizeJP(String(row[1] || '').trim());
      var isDuplicate = siteNmForDup.length >= 3 && (
        completedNm[siteNmForDup] || Object.keys(completedNm).some(function(cn) {
          // 短い方が7文字未満の部分一致は誤爆の元（「ニトリ」「ウエルシア」でチェーン全店非表示になる）
          var shorter = Math.min(cn.length, siteNmForDup.length);
          if (shorter < 7) return false;
          return siteNmForDup.indexOf(cn) !== -1 || cn.indexOf(siteNmForDup) !== -1;
        })
      );
      if (isDuplicate) return;

      var rowNum = idx + 2;
      var ccEmails = ccRaw ? ccRaw.split(',').map(function(s){return s.trim();}).filter(function(e){ return e && BLOCKED_TO.indexOf(e.toLowerCase()) === -1; }) : [];

      // Supabaseは住所・TEL・依頼者の補完のみ（メール情報はシート列優先）
      var supaRec = findSupaRecBySiteName_(supaOrders, siteName) || findSupaRecBySiteName_(supaOrders, company);

      // 施工日を文字列化
      var workDateStr = '';
      if (workDate instanceof Date && !isNaN(workDate.getTime())) {
        workDateStr = Utilities.formatDate(workDate, 'Asia/Tokyo', 'yyyy/MM/dd');
      } else if (workDate) {
        workDateStr = String(workDate);
      }

      // requested_at: Supabase優先、なければAI転送日
      var requestedAt = '';
      if (supaRec && supaRec.requested_at) {
        requestedAt = supaRec.requested_at;
      } else if (aiDate instanceof Date && !isNaN(aiDate.getTime())) {
        requestedAt = aiDate.toISOString();
      } else if (aiDate) {
        try { requestedAt = new Date(aiDate).toISOString(); } catch(e) {}
      }

      var orderId = 'sheet:' + rowNum + (supaRec ? ':supa:' + supaRec.id : '');

      orders.push({
        id:             orderId,
        site_no:        supaRec ? (supaRec.site_no        || '') : '',
        site_name:      siteName,
        site_address:   supaRec ? (supaRec.site_address   || '') : '',
        site_tel:       supaRec ? (supaRec.site_tel       || '') : '',
        requester:      supaRec ? (supaRec.requester      || '') : '',
        work_type:      workType || (supaRec ? (supaRec.work_type || '') : ''),
        request_detail: requestDetail || (supaRec ? (supaRec.request_detail || '') : ''),
        work_date:      supaRec ? (supaRec.work_date || workDateStr) : workDateStr,
        requested_at:   requestedAt,
        reply_to_email:  replyToEmail  || (function() {
          var fb = (supaRec && supaRec.reply_to_email) ? supaRec.reply_to_email : '';
          return BLOCKED_TO.indexOf(fb.toLowerCase()) !== -1 ? '' : fb;
        })(),
        reply_cc_emails: ccEmails.length ? ccEmails : (supaRec ? supaRec.reply_cc_emails || [] : []),
        in_reply_to:     threadId      || (supaRec ? supaRec.in_reply_to    || '' : ''),
      });
    });

    return orders;
  } catch(e) {
    Logger.log('getOrders error: ' + e);
    return [];
  }
}

// ─── ステータス更新 ────────────────────────────────────────────

// 案件ステータスを「報告済」に更新（シート + Supabase）
// orderId 形式: 'sheet:rowNum' または 'sheet:rowNum:supa:supabaseId'
function updateOrderStatus(orderId) {
  if (!orderId) return;

  var sheetRow = null;
  var supaId   = null;

  var parts = String(orderId).split(':');
  if (parts[0] === 'sheet' && parts[1]) {
    sheetRow = parseInt(parts[1], 10);
  }
  var supaIdx = parts.indexOf('supa');
  if (supaIdx !== -1 && parts[supaIdx + 1]) {
    supaId = parts[supaIdx + 1];
  }

  // 一覧シートのステータスと完了日を更新
  if (sheetRow) {
    try {
      var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
      var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
      if (sheet) {
        var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
        sheet.getRange(sheetRow, 11).setValue('報告済');  // K: ステータス
        sheet.getRange(sheetRow, 5).setValue(today);      // E: 完了日
        sheet.getRange(sheetRow, 10).setValue(true);      // J: 完了報告
        Logger.log('シート行' + sheetRow + 'を報告済に更新');
      }
    } catch(e) {
      Logger.log('updateOrderStatus sheet error: ' + e);
    }
  }

  // SupabaseのステータスをsubmittedにPATCH
  if (supaId) {
    try {
      var url = SUPABASE_URL + '/rest/v1/work_reports?id=eq.' + supaId;
      UrlFetchApp.fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        payload: JSON.stringify({ status: 'submitted' })
      });
    } catch(e) {
      Logger.log('updateOrderStatus supabase error: ' + e);
    }
  }
}

function createPDF(data) {
  var ss = SpreadsheetApp.openById('1LQUMHAUdJcdlKAlfsmm58tepmUzqye1kQXqlwLP1hXQ');
  var sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['送信日時','店舗No.','お客様名','住所','TEL','御依頼者','御依頼日','依頼時刻','依頼内容','依頼内容詳細','作業者名','作業日','開始','終了','完了状況','作業内容','故障機器1','故障機器2','故障機器3','使用部品1','使用部品2','使用部品3','使用部品4','使用部品5','使用部品6','送付先','CC']);
  }
  var dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.appendRow([
    dateStr,
    data.storeNo||'',
    data.clientName||'',
    data.address||'',
    data.tel||'',
    data.requester||'',
    data.reqDate||'',
    data.reqTime||'',
    data.workType||'',
    data.requestDetail||'',
    data.workerName||'',
    data.workDate||'',
    data.startTime||'',
    data.endTime||'',
    data.workStatus||'',
    data.workDetail||'',
    ((data.faults||[])[0]||[]).join(' '),
    ((data.faults||[])[1]||[]).join(' '),
    ((data.faults||[])[2]||[]).join(' '),
    ((data.parts||[])[0]||[]).join(' '),
    ((data.parts||[])[1]||[]).join(' '),
    ((data.parts||[])[2]||[]).join(' '),
    ((data.parts||[])[3]||[]).join(' '),
    ((data.parts||[])[4]||[]).join(' '),
    ((data.parts||[])[5]||[]).join(' '),
    data.toEmail||'',
    data.ccEmail||''
  ]);
  // ログが200行超えたら古い行を削除
  var logLastRow = sheet.getLastRow();
  if (logLastRow > 201) { sheet.deleteRows(2, logLastRow - 201); }

  var templateId = '1eht40dFfBprEHLldmZbc4sklGbmQj1cBpkqps59ws9g';
  var fileDateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var filename = 'アースファスト報告書_' + (data.clientName||'') + '_' + fileDateStr;
  var folder = DriveApp.getFolderById('1V_epzfbW6ERny39Gno-339wLWKrhFBec');
  var subFolder = folder.createFolder((data.clientName||'未入力') + '_' + fileDateStr);
  try {

  var copy = DriveApp.getFileById(templateId).makeCopy(filename, subFolder);
  var copySS = SpreadsheetApp.openById(copy.getId());
  var sheet2 = copySS.getSheets()[0];

  var replacements = {
    '{{storeNo}}':       data.storeNo||'',
    '{{clientName}}':    data.clientName||'',
    '{{address}}':       data.address||'',
    '{{tel}}':           data.tel||'',
    '{{reqDate}}':       data.reqDate||'',
    '{{reqTime}}':       data.reqTime||'',
    '{{requester}}':     data.requester||'',
    '{{workType}}':      data.workType||'',
    '{{requestDetail}}': data.requestDetail||'',
    '{{workerName}}':    data.workerName||'',
    '{{workDate}}':      data.workDate||'',
    '{{startTime}}':     data.startTime||'',
    '{{endTime}}':       data.endTime||'',
    '{{workStatus}}':    data.workStatus||'',
    '{{workDetail}}':    data.workDetail||'',
    '{{fault1}}':        ((data.faults||[])[0]||[])[0]||'',
    '{{fault1type}}':    ((data.faults||[])[0]||[])[1]||'',
    '{{fault1qty}}':     ((data.faults||[])[0]||[])[2]||'',
    '{{fault2}}':        ((data.faults||[])[1]||[])[0]||'',
    '{{fault2type}}':    ((data.faults||[])[1]||[])[1]||'',
    '{{fault2qty}}':     ((data.faults||[])[1]||[])[2]||'',
    '{{fault3}}':        ((data.faults||[])[2]||[])[0]||'',
    '{{fault3type}}':    ((data.faults||[])[2]||[])[1]||'',
    '{{fault3qty}}':     ((data.faults||[])[2]||[])[2]||'',
    '{{part1}}':         ((data.parts||[])[0]||[])[0]||'',
    '{{part1type}}':     ((data.parts||[])[0]||[])[1]||'',
    '{{part1qty}}':      ((data.parts||[])[0]||[])[2]||'',
    '{{part2}}':         ((data.parts||[])[1]||[])[0]||'',
    '{{part2type}}':     ((data.parts||[])[1]||[])[1]||'',
    '{{part2qty}}':      ((data.parts||[])[1]||[])[2]||'',
    '{{part3}}':         ((data.parts||[])[2]||[])[0]||'',
    '{{part3type}}':     ((data.parts||[])[2]||[])[1]||'',
    '{{part3qty}}':      ((data.parts||[])[2]||[])[2]||'',
    '{{part4}}':         ((data.parts||[])[3]||[])[0]||'',
    '{{part4type}}':     ((data.parts||[])[3]||[])[1]||'',
    '{{part4qty}}':      ((data.parts||[])[3]||[])[2]||'',
    '{{part5}}':         ((data.parts||[])[4]||[])[0]||'',
    '{{part5type}}':     ((data.parts||[])[4]||[])[1]||'',
    '{{part5qty}}':      ((data.parts||[])[4]||[])[2]||'',
    '{{part6}}':         ((data.parts||[])[5]||[])[0]||'',
    '{{part6type}}':     ((data.parts||[])[5]||[])[1]||'',
    '{{part6qty}}':      ((data.parts||[])[5]||[])[2]||''
  };

  // 一括読み込み→メモリ内置換→変更セルのみ書き込み（API呼び出し数を最小化）
  var maxRow = sheet2.getLastRow();
  var maxCol = sheet2.getLastColumn();
  var allVals = sheet2.getRange(1, 1, maxRow, maxCol).getValues();
  for (var i = 0; i < allVals.length; i++) {
    for (var j = 0; j < allVals[i].length; j++) {
      // ロゴエリア(O2:T7 = 行2-7, 列15-20)はスキップ（0-indexed: 行1-6, 列14-19）
      if (i >= 1 && i <= 6 && j >= 14 && j <= 19) continue;
      var cellVal = allVals[i][j];
      if (typeof cellVal !== 'string' || cellVal.indexOf('{{') === -1) continue;
      var newVal = cellVal;
      for (var key in replacements) {
        if (newVal.indexOf(key) !== -1) {
          newVal = newVal.replace(new RegExp(key.replace(/[{}]/g,'\\$&'),'g'), replacements[key]);
        }
      }
      if (newVal !== cellVal) {
        try { sheet2.getRange(i + 1, j + 1).setValue(newVal); } catch(_) {}
      }
    }
  }

   // 署名画像を挿入
  if (data.signImage && (data.signImage.indexOf('data:image/png;base64,') === 0 || data.signImage.indexOf('data:image/jpeg;base64,') === 0)) {
    var base64 = data.signImage.replace(/^data:image\/(png|jpeg);base64,/, '');
    var imgBlob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'signature.png');
    sheet2.getRange(30, 16).setValue('');
    var overGridImage = sheet2.insertImage(imgBlob, 16, 30, 20, 60);
    overGridImage.setWidth(180);
    overGridImage.setHeight(150);
  }

  SpreadsheetApp.flush();
  Utilities.sleep(1000); // シート書き込みがPDFエクスポートに反映されるまでの待機

  // PDF変換（1ページ・グリッドなし）
  var sheetId = sheet2.getSheetId();
  var ssId = copy.getId();
  var url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export'
    + '?format=pdf'
    + '&size=A4'
    + '&portrait=true'
    + '&fitw=true'
    + '&fith=true'
    + '&top_margin=0.5'
    + '&bottom_margin=0.5'
    + '&left_margin=0.5'
    + '&right_margin=0.5'
    + '&sheetnames=false'
    + '&printtitle=false'
    + '&pagenumbers=false'
    + '&gridlines=false'
    + '&fzr=false'
    + '&gid=' + sheetId;

  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  });

  var pdfBlob = response.getBlob().setName(filename + '.pdf');
  var pdfFile = subFolder.createFile(pdfBlob);
  copy.setTrashed(true);

  // 施工前写真フォルダ
  var beforeFolder = subFolder.createFolder('施工前写真');
  var afterFolder = subFolder.createFolder('施工後写真');

  var photoBlobs = [];
  var photosBefore = data.photosBefore || [];
  for (var p = 0; p < photosBefore.length; p++) {
    var photo = photosBefore[p];
    if (photo.base64 && photo.name) {
      var photoBase64 = photo.base64.replace(/^data:image\/\w+;base64,/, '');
      var photoBlob = Utilities.newBlob(
        Utilities.base64Decode(photoBase64),
        'image/jpeg',
        '施工前_' + (p+1) + '_' + photo.name
      );
      beforeFolder.createFile(photoBlob);
      photoBlobs.push(photoBlob);
    }
  }

  var photosAfter = data.photosAfter || [];
  for (var q = 0; q < photosAfter.length; q++) {
    var photoA = photosAfter[q];
    if (photoA.base64 && photoA.name) {
      var photoBase64A = photoA.base64.replace(/^data:image\/\w+;base64,/, '');
      var photoBlobA = Utilities.newBlob(
        Utilities.base64Decode(photoBase64A),
        'image/jpeg',
        '施工後_' + (q+1) + '_' + photoA.name
      );
      afterFolder.createFile(photoBlobA);
      photoBlobs.push(photoBlobA);
    }
  }
// メール送信
  var folderUrl = subFolder.getUrl();
  var subject = '【作業報告】' + (data.workDate||'') + (data.storeNo ? ' 店舗No.' + data.storeNo : '') + ' ' + (data.clientName||'') + '様';
  var mailBody =
    'お世話になっております。\n\n' +
    (data.workDate||'') + ' に実施いたしました作業報告書および施工写真をお送りします。\n\n' +
    (data.storeNo ? '【店舗No.】　' + data.storeNo + '\n' : '') +
    '【お客様名】' + (data.clientName||'') + ' 様\n' +
    '【作業日時】' + (data.workDate||'') + ' ' + (data.startTime||'') + '〜' + (data.endTime||'') + '\n' +
    '【完了状況】' + (data.workStatus||'') + '\n\n' +
    '施工写真・報告書：' + folderUrl + '\n\n' +
    '▼過去の報告書一覧はこちら\n' +
    'https://drive.google.com/drive/folders/1V_epzfbW6ERny39Gno-339wLWKrhFBec?usp=drive_link\n\n' +
    'ご確認のほどよろしくお願いいたします。';

  var attachments = [pdfBlob];
  for (var a = 0; a < photoBlobs.length; a++) {
    attachments.push(photoBlobs[a]);
  }

  var mailOptions = { attachments: attachments, name: '株式会社マルケン電工' };
  if (data.ccEmail) mailOptions.cc = data.ccEmail;

  // 元メールのスレッドIDがあれば返信形式で送信、なければ新規送信
  var sent = false;
  if (data.inReplyTo) {
    try {
      var thread = GmailApp.getThreadById(data.inReplyTo);
      if (thread) {
        thread.reply(mailBody, mailOptions);
        sent = true;
      }
    } catch(e) {
      Logger.log('スレッド返信失敗。新規送信に切り替え: ' + e);
    }
  }
  if (!sent) {
    GmailApp.sendEmail(data.toEmail || '', subject, mailBody, mailOptions);
  }

  // 案件ステータスを報告済に更新
  if (data.pendingOrderId) {
    updateOrderStatus(data.pendingOrderId);
  }

  return folderUrl;
  } catch(e) {
    // PDF作成・メール送信に失敗した場合はゴミフォルダをtrash
    try { subFolder.setTrashed(true); } catch(_) {}
    throw e;
  }
}

// 既存の[AF]行にSupabaseのメール情報をバックフィルする（手動1回実行）
function runArsfastEmailMigration() {
  var supaOrders = getAllArsfastFromSupabase_();
  // submittedも含めて全件取得
  try {
    var allUrl = SUPABASE_URL + '/rest/v1/work_reports'
      + '?select=id,site_name,reply_to_email,reply_cc_emails,in_reply_to'
      + '&client_format=eq.arsfast&order=created_at.desc&limit=500';
    var res = UrlFetchApp.fetch(allUrl, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      muteHttpExceptions: true
    });
    supaOrders = JSON.parse(res.getContentText());
  } catch(e) { Logger.log('migration fetch error: ' + e); return; }

  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var data = sheet.getRange(2, 1, lastRow - 1, 17).getValues(); // A〜Q列

  var updated = 0;
  data.forEach(function(row, idx) {
    var notes    = String(row[12] || '');
    var company  = String(row[0]  || '').trim();
    var siteName = String(row[1]  || '').trim() || company;
    var afFlag   = String(row[13] || '').trim(); // N: AFフラグ
    var toEmail  = String(row[14] || '').trim(); // O: 返信先メール

    if (afFlag !== '○') return;
    // ブロックアドレスがO列に入っている場合は空として扱う
    var BLOCK_ADDR = ['s.shigeno1016@gmail.com', 'mky7584gd@gmail.com'];
    if (BLOCK_ADDR.indexOf(toEmail.toLowerCase()) !== -1) toEmail = '';
    // CC にブロックアドレスが含まれる・またはmaruken単独の場合も再処理
    var ccRawP = String(row[15] || '').replace(/\s/g, '').toLowerCase();
    var ccIncomplete = !ccRawP
      || ccRawP === 'info@marukendenkou.com'
      || ccRawP.indexOf('mky7584gd') !== -1
      || ccRawP.indexOf('s.shigeno1016') !== -1;
    if (toEmail && !ccIncomplete) return; // O・P共に揃っていればスキップ

    var supaRec = findSupaRecBySiteName_(supaOrders, siteName) || findSupaRecBySiteName_(supaOrders, company);

    var replyTo = supaRec ? supaRec.reply_to_email : null;
    var ccEmails = supaRec ? (supaRec.reply_cc_emails || []) : [];
    var threadId = supaRec ? supaRec.in_reply_to : null;

    // Supabaseのreplyカがブロックアドレスなら早期クリア（Gmail検索が動くように）
    var MIGRATION_BLOCKED = ['s.shigeno1016@gmail.com', 'mky7584gd@gmail.com'];
    if (replyTo && MIGRATION_BLOCKED.indexOf(replyTo.toLowerCase()) !== -1) replyTo = null;
    ccEmails = ccEmails.filter(function(e) {
      var addr = extractEmailAddr_(e);
      return MIGRATION_BLOCKED.indexOf(addr) === -1;
    });

    // ①[ID:msgId]からGmail直接取得（replyToがない OR CCが不完全な場合）
    if (!replyTo || ccIncomplete) {
      var msgIdMatch = notes.match(/\[ID:([^\]]+)\]/);
      if (msgIdMatch) {
        try {
          var msg = GmailApp.getMessageById(msgIdMatch[1]);
          if (msg) {
            var fromRaw = msg.getFrom();
            if (fromRaw && fromRaw.indexOf('mky7584gd@gmail.com') !== -1) {
              var body = msg.getPlainBody();
              // replyTo が未設定の場合のみ上書き
              if (!replyTo) {
                var arsfastMatch = body.match(/([a-zA-Z0-9._+\-]+@arsfast\.com)/);
                replyTo = arsfastMatch ? arsfastMatch[1] : null;
              }
              // CC は常に転送本文から再取得
              var fwdCC = extractForwardedCC_(body);
              if (fwdCC.length > 0) ccEmails = fwdCC;
              if (!threadId) threadId = msg.getThread().getId();
            } else {
              if (!replyTo) replyTo = extractEmailAddr_(fromRaw);
              if (ccIncomplete) {
                var ccRaw = msg.getCc();
                if (ccRaw) {
                  ccEmails = ccRaw.split(',').map(function(s){ return extractEmailAddr_(s.trim()); }).filter(Boolean);
                }
              }
              if (!threadId) threadId = msg.getThread().getId();
            }
          }
        } catch(e) { Logger.log('Gmail[ID] lookup error: ' + e); }
      }
    }

    // ② [ID]なし or マッチなし → 店舗名でGmail検索（複数パターン試行）
    if ((!replyTo || ccIncomplete) && siteName && siteName.length > 2) {
      // {} はGmail検索のOR構文（APIコール数を削減）
      var queries = [
        siteName + ' {from:arsfast.com to:arsfast.com cc:arsfast.com}',
        siteName + ' from:mky7584gd@gmail.com',
      ];
      // 名前が長い場合は先頭6文字でも試す
      if (siteName.length > 6) {
        queries.push(siteName.substring(0, 6) + ' {from:arsfast.com to:arsfast.com cc:arsfast.com}');
        queries.push(siteName.substring(0, 6) + ' from:mky7584gd@gmail.com');
      }
      // よくある誤字を修正して再検索
      var corrected = siteName
        .replace('ドラック', 'ドラッグ')
        .replace('mytstic', 'Mystic');
      if (corrected !== siteName) {
        queries.push(corrected + ' {from:arsfast.com to:arsfast.com cc:arsfast.com}');
        queries.push(corrected.substring(0, 6) + ' {from:arsfast.com to:arsfast.com cc:arsfast.com}');
      }
      for (var qi = 0; qi < queries.length && (!replyTo || ccEmails.length <= 1); qi++) {
        var isMkyQuery = queries[qi].indexOf('from:mky7584gd@gmail.com') !== -1;
        var isCcQuery  = queries[qi].indexOf(' cc:arsfast.com') !== -1;
        try {
          var threads = GmailApp.search(queries[qi], 0, 5);
          for (var ti = 0; ti < threads.length && (!replyTo || ccEmails.length <= 1); ti++) {
            var msgs = threads[ti].getMessages();
            for (var mi = 0; mi < msgs.length && (!replyTo || ccEmails.length <= 1); mi++) {
              var m = msgs[mi];
              var fromRaw2 = m.getFrom();
              var toRaw2   = m.getTo();
              var ccRaw2x  = m.getCc() || '';
              var isMkyMsg = fromRaw2 && fromRaw2.indexOf('mky7584gd@gmail.com') !== -1;
              // arsfast.com が FROM/TO/CC にある か mky転送クエリの場合のみ採用
              var hasArsfast = (fromRaw2 && fromRaw2.indexOf('arsfast.com') !== -1) ||
                               (toRaw2   && toRaw2.indexOf('arsfast.com') !== -1) ||
                               (ccRaw2x  && ccRaw2x.indexOf('arsfast.com') !== -1);
              if (!hasArsfast && !isMkyMsg) continue;

              var body2 = null;
              if (isMkyMsg) {
                // 転送メール：本文から arsfast.com アドレスと元CCを取得
                body2 = m.getPlainBody();
                var af2 = body2.match(/([a-zA-Z0-9._+\-]+@arsfast\.com)/);
                if (af2) replyTo = af2[1];
              } else if (fromRaw2 && fromRaw2.indexOf('arsfast.com') !== -1) {
                replyTo = extractEmailAddr_(fromRaw2);
              } else if (toRaw2 && toRaw2.indexOf('arsfast.com') !== -1) {
                var toEmails = toRaw2.split(',').map(function(s){ return extractEmailAddr_(s.trim()); });
                for (var te = 0; te < toEmails.length; te++) {
                  if (toEmails[te].indexOf('arsfast.com') !== -1) { replyTo = toEmails[te]; break; }
                }
              } else if (ccRaw2x && ccRaw2x.indexOf('arsfast.com') !== -1) {
                // CCにarsfast.comアドレスがある → TOに昇格
                var ccEmails2x = ccRaw2x.split(',').map(function(s){ return extractEmailAddr_(s.trim()); });
                for (var ce = 0; ce < ccEmails2x.length; ce++) {
                  if (ccEmails2x[ce].indexOf('arsfast.com') !== -1) { replyTo = ccEmails2x[ce]; break; }
                }
              }

              if (replyTo) {
                if (isMkyMsg && body2) {
                  // 転送メール：元本文のCCを解析
                  var fwdCC2 = extractForwardedCC_(body2);
                  ccEmails = fwdCC2.length > 0 ? fwdCC2 : [];
                } else {
                  var allCcRaw2 = m.getCc();
                  ccEmails = allCcRaw2 ? allCcRaw2.split(',').map(function(s){ return extractEmailAddr_(s.trim()); }).filter(function(e){ return e.indexOf('arsfast.com') === -1; }) : [];
                }
                threadId = threads[ti].getId();
                Logger.log('Gmail検索ヒット[' + qi + ']: ' + siteName + ' → ' + replyTo + ' CC:' + ccEmails.join(','));
              }
            }
          }
        } catch(e) { Logger.log('Gmail search error[' + qi + ']: ' + e); }
      }
    }

    // ブロックリストから最終除外（MIGRATION_BLOCKEDは関数冒頭で宣言済み）
    if (replyTo && MIGRATION_BLOCKED.indexOf(replyTo.toLowerCase()) !== -1) replyTo = null;
    ccEmails = ccEmails.filter(function(e) { return MIGRATION_BLOCKED.indexOf(e.toLowerCase()) === -1; });

    // TOが空でもCCにarsfast.comアドレスがあればTOに昇格
    if (!replyTo) {
      for (var ci = 0; ci < ccEmails.length; ci++) {
        var ceAddr = extractEmailAddr_(ccEmails[ci]);
        if (ceAddr.indexOf('@arsfast.com') !== -1) {
          replyTo = ceAddr; // アドレスのみ取り出す
          ccEmails.splice(ci, 1); // CCからは除去
          Logger.log('CCからTO昇格: 行' + (idx+2) + ' ' + siteName + ' → ' + replyTo);
          break;
        }
      }
    }

    // メールが見つからなくてもN列にフラグだけ立てる（TO/CC/THREADは空）
    var rowNum = idx + 2;
    var origToRaw = String(row[14] || '').trim();
    sheet.getRange(rowNum, AF_COL_FLAG).setValue('○');   // N: AFフラグ
    if (replyTo && (!toEmail || MIGRATION_BLOCKED.indexOf(origToRaw.toLowerCase()) !== -1)) {
      // TOが空またはブロックアドレスの場合に書き込む
      sheet.getRange(rowNum, AF_COL_TO).setValue(replyTo);                       // O: TO
    }
    if (ccEmails.length > 0 && ccIncomplete) {
      sheet.getRange(rowNum, AF_COL_CC).setValue(ccEmails.join(','));            // P: CC
    }
    if (threadId && !String(row[16] || '').trim()) {
      sheet.getRange(rowNum, AF_COL_THREAD).setValue(threadId);                  // Q: スレッドID（空の場合のみ）
    }
    // M列から[AF*]タグを除去（[ID:...]は残す）
    var cleaned = notes.replace(/\s*\[AF[^\]]*\]/g, '').trim();
    sheet.getRange(rowNum, 13).setValue(cleaned);

    var finalTo = replyTo || toEmail;
    var logLine = '行' + rowNum + ' ' + siteName + ' → TO:' + (finalTo||'(なし)') + ' CC:' + (ccEmails.join(',') || '(なし)');
    Logger.log(logLine);
    updated++;
  });
  Logger.log('バックフィル完了: ' + updated + '件更新');
  return updated + '件処理しました';
}

// B列（現場名）が住所になってる重複行を削除する（1回実行用）
function deleteAddressDuplicateRows() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  var lastRow = sheet.getLastRow();
  var deleted = 0;

  // B列を一括取得してから下から削除（行番号のずれを防ぐ）
  var bVals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = lastRow; i >= 2; i--) {
    var siteName = String(bVals[i - 2][0] || '').trim();
    // 住所パターン：丁目・番地・番・号・都道府県名を含む
    var isAddress = /丁目|番地|番町|[0-9]-[0-9]/.test(siteName) ||
                    /岐阜県|愛知県|三重県|静岡県|滋賀県/.test(siteName);
    if (isAddress) {
      sheet.deleteRow(i);
      Logger.log('削除: 行' + i + ' [' + siteName + ']');
      deleted++;
    }
  }
  Logger.log('削除完了: ' + deleted + '件');
}

// フォームの管理ボタンから呼び出されるアクションハンドラー
function adminRunAction(action) {
  if (action === 'fixFlags') {
    fixMissingArsfastFlags();
    return 'AFフラグ修正が完了しました';
  }
  if (action === 'fillEmails') {
    var fillResult = runArsfastEmailMigration();
    return fillResult || 'メール補完が完了しました';
  }
  if (action === 'debugCC') {
    return debugCCExtraction_();
  }
  if (action === 'fixDups') {
    var result = fixDuplicateRows();
    return result || '重複行の削除が完了しました';
  }
  if (action === 'diagnose') {
    return diagnoseDuplicatesAndMissingTO_();
  }
  if (action === 'diagnoseDup') {
    return diagnoseSpecificDups_();
  }
  if (action === 'recoverSiteNames') {
    return recoverSiteNamesFromGmail_();
  }
  if (action === 'debugNitori') {
    return debugNitoriTO_();
  }
  if (action === 'cleanBadNames') {
    return cleanBadSiteNames_();
  }
  if (action === 'diagnoseSketchers') {
    return diagnoseStoreRows_('スケッチャーズ');
  }
  if (action === 'setupTrigger') {
    return setupArsfastDailyTrigger();
  }
  if (action === 'checkTrigger') {
    return checkArsfastTrigger();
  }
  if (action === 'testPipeline') {
    // メール受信→AI分類→スプシ記録→LINE通知→Webhookシミュレーションの全ステップ統合テスト
    try {
      var r = runEmailPipelineIntegrationTest_();
      var ok = r && r.ok;
      var stepLines = (r && r.steps || []).map(function(s) {
        return (s.ok ? '✅' : '❌') + ' ' + s.name + '\n  ' + s.detail;
      }).join('\n');
      return '🧪 パイプライン統合テスト完了（' + (r && r.elapsed || 0) + '秒）\n' +
             (ok ? '🎉 全ステップ成功' : '❌ 失敗あり') + '\n\n' + stepLines;
    } catch(e) {
      return 'テスト実行エラー: ' + e.toString();
    }
  }
  if (action === 'systemTest') {
    try {
      runFullSystemTest();
      return '✅ フルシステムテストを実行しました。\nLINE通知で結果を確認してください。';
    } catch(e) {
      return 'エラー: ' + e.toString();
    }
  }
  return '不明なアクション: ' + action;
}

// ニトリ行のTO/CC状況を詳細診断
function debugNitoriTO_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 17).getValues();

  // Supabase から ニトリの情報を取得
  var supaOrders = [];
  try {
    var allUrl = SUPABASE_URL + '/rest/v1/work_reports'
      + '?select=id,site_name,reply_to_email,reply_cc_emails,in_reply_to'
      + '&client_format=eq.arsfast&site_name=like.*ニトリ*&order=created_at.desc&limit=20';
    var res = UrlFetchApp.fetch(allUrl, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      muteHttpExceptions: true
    });
    supaOrders = JSON.parse(res.getContentText());
  } catch(e) { Logger.log('Supabase error: ' + e); }

  var lines = [];
  data.forEach(function(row, idx) {
    var siteName = String(row[1] || row[0] || '').trim();
    if (siteName.indexOf('ニトリ') === -1) return;
    var rowNum   = idx + 2;
    var afFlag   = String(row[13] || '').trim();
    var toEmail  = String(row[14] || '').trim();
    var ccRaw    = String(row[15] || '').trim();
    var notes    = String(row[12] || '');

    lines.push('=== 行' + rowNum + ': ' + siteName + ' ===');
    lines.push('AF=' + afFlag + ' O列(TO)=' + (toEmail || '(空)'));
    lines.push('P列(CC)=' + (ccRaw || '(空)'));

    // Supabaseの対応レコード
    var supa = null;
    supaOrders.forEach(function(r) {
      if (r.site_name && r.site_name.indexOf(siteName.substring(0, 4)) !== -1) supa = r;
    });
    if (supa) {
      lines.push('Supabase reply_to=' + (supa.reply_to_email || '(空)'));
      lines.push('Supabase reply_cc=' + JSON.stringify(supa.reply_cc_emails));
    } else {
      lines.push('Supabase: マッチなし');
    }

    // CCにarsfast.comが含まれるか
    var ccList = ccRaw ? ccRaw.split(',').map(function(s){ return s.trim(); }) : [];
    var afInCC = ccList.filter(function(e){ return e.indexOf('arsfast.com') !== -1; });
    lines.push('CCの中のarsfast.com: ' + (afInCC.length ? afInCC.join(',') : 'なし'));

    // Gmail検索テスト
    var testQueries = [
      siteName.substring(0, 6) + ' from:arsfast.com',
      siteName.substring(0, 6) + ' to:arsfast.com',
      siteName.substring(0, 6) + ' cc:arsfast.com',
    ];
    testQueries.forEach(function(q) {
      try {
        var threads = GmailApp.search(q, 0, 3);
        lines.push('Gmail[' + q + ']: ' + threads.length + '件');
        threads.forEach(function(t) {
          var msgs = t.getMessages();
          msgs.forEach(function(m) {
            lines.push('  件名=' + m.getSubject());
            lines.push('  FROM=' + m.getFrom());
            lines.push('  TO=' + m.getTo());
            lines.push('  CC=' + m.getCc());
          });
        });
      } catch(e) { lines.push('Gmail error: ' + e); }
    });
  });

  return lines.length ? lines.join('\n') : 'ニトリ行が見つかりません';
}

// B列（現場名）が空のAF行をGmailの件名から復元してシートに書き込む
function recoverSiteNamesFromGmail_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  var DONE = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];
  var results = [];

  data.forEach(function(row, idx) {
    var af       = String(row[13] || '').trim();
    if (af !== '○') return;
    var siteName = String(row[1]  || '').trim();
    if (siteName) return;
    var status   = String(row[10] || '').trim();
    if (DONE.indexOf(status) !== -1) return;

    var company  = String(row[0]  || '').trim();
    var workType = String(row[2]  || '').trim();
    var toEmail  = String(row[14] || '').trim();
    var notes    = String(row[12] || '');
    var rowNum   = idx + 2;

    var subject = null;

    // Gmail メッセージを取得（ID直接 or 検索）
    var foundMsg = null;
    var BLOCKED_ADDR = ['s.shigeno1016@gmail.com', 'mky7584gd@gmail.com'];
    var safeToEmail = BLOCKED_ADDR.indexOf(toEmail.toLowerCase()) !== -1 ? '' : toEmail;

    // ①[ID]タグから直接取得
    var msgIdMatch = notes.match(/\[ID:([^\]]+)\]/);
    if (msgIdMatch) {
      try {
        var msg0 = GmailApp.getMessageById(msgIdMatch[1]);
        if (msg0) foundMsg = msg0;
      } catch(e) {}
    }

    // ②TOアドレス + 工事種類で検索（arsfast.com宛/からのメールに絞る）
    if (!foundMsg && safeToEmail) {
      var kw = workType.length > 4 ? workType.substring(0, 4) : workType;
      var q2list = [
        'from:' + safeToEmail + ' ' + kw,
        'to:' + safeToEmail + ' ' + kw,
        'from:' + safeToEmail,
      ];
      for (var qi2 = 0; qi2 < q2list.length && !foundMsg; qi2++) {
        try {
          var th2 = GmailApp.search(q2list[qi2], 0, 5);
          for (var ti2 = 0; ti2 < th2.length && !foundMsg; ti2++) {
            var ms2 = th2[ti2].getMessages();
            for (var mi2 = 0; mi2 < ms2.length && !foundMsg; mi2++) {
              var m2 = ms2[mi2];
              var f2 = m2.getFrom(), t2 = m2.getTo(), c2 = m2.getCc() || '';
              // arsfast.com が FROM/TO/CC にあるメールのみ対象
              if ((f2 && f2.indexOf('arsfast.com') !== -1) ||
                  (t2 && t2.indexOf('arsfast.com') !== -1) ||
                  (c2 && c2.indexOf('arsfast.com') !== -1)) {
                foundMsg = m2;
              }
            }
          }
        } catch(e) {}
      }
    }

    if (!foundMsg) {
      results.push('行' + rowNum + ' ' + company + '（' + workType + '）: メール取得失敗');
      return;
    }

    // 本文から現場名ラベルを探す（最優先）
    var siteName2 = extractSiteNameFromBody_(foundMsg.getPlainBody());
    var usedSource = '本文';

    // 本文で取れなければ件名から抽出
    if (!siteName2) {
      siteName2 = extractSiteNameFromSubject_(foundMsg.getSubject(), workType);
      usedSource = '件名';
    }

    results.push('行' + rowNum + ' 件名: ' + foundMsg.getSubject());
    results.push('  → 抽出候補[' + usedSource + ']: 「' + (siteName2 || '取得失敗') + '」');

    if (!siteName2) {
      results.push('  → 店舗名を特定できず（手動で設定してください）');
    } else {
      sheet.getRange(rowNum, 2).setValue(siteName2);
      results.push('  → B列に書き込みました ✓');
    }
  });

  return results.length ? results.join('\n') : '対象行なし（B列が空のAF行なし）';
}

// AF付き全アクティブ行を出力（重複調査用）
function diagnoseSpecificDups_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  var DONE = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];

  var lines = [];
  for (var i = 0; i < data.length; i++) {
    var af = String(data[i][13] || '').trim();
    if (af !== '○') continue;
    var st = String(data[i][10] || '').trim();
    if (DONE.indexOf(st) !== -1) continue;
    var company  = String(data[i][0] || '').trim();
    var siteName = String(data[i][1] || '').trim();
    var workType = String(data[i][2] || '').trim();
    lines.push('行' + (i+2) + ' A=' + company + ' / B=' + siteName + ' / C=' + workType + ' / K=' + (st||'空'));
  }
  return lines.length ? lines.join('\n') : 'AF付きアクティブ行なし';
}

// 重複行・TO未設定行の現状を診断して返す
function diagnoseDuplicatesAndMissingTO_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();

  var DONE = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];
  var BLOCKED_TO = ['s.shigeno1016@gmail.com', 'mky7584gd@gmail.com'];

  // 完了済み現場名セット（B列のみ、会社名フォールバックなし）
  var completedNm = {};
  var REPEAT_CUTOFF_D = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  for (var i = 0; i < data.length; i++) {
    var st = String(data[i][10] || '').trim();
    var jDone = data[i][9] === true || String(data[i][9]).toLowerCase() === 'true';
    if (DONE.indexOf(st) !== -1 || jDone) {
      var cdRaw0 = data[i][4];
      var cd0 = cdRaw0 instanceof Date ? cdRaw0 : (cdRaw0 ? new Date(String(cdRaw0)) : null);
      if (cd0 && !isNaN(cd0.getTime()) && cd0 < REPEAT_CUTOFF_D) continue;
      var nm0 = normalizeJP(String(data[i][1] || ''));
      if (nm0.length >= 3) completedNm[nm0] = true;
    }
  }
  var completedKeys = Object.keys(completedNm);

  var missingTO = [];
  var dups = [];
  var activeNmMap = {};
  var activeDups = [];

  for (var j = 0; j < data.length; j++) {
    var row = data[j];
    if (String(row[13] || '').trim() !== '○') continue;
    var status = String(row[10] || '').trim();
    if (DONE.indexOf(status) !== -1) continue;
    var company  = String(row[0] || '').trim();
    if (!company) continue;
    var siteName = String(row[1] || '').trim() || company;
    var toRaw    = String(row[14] || '').trim();
    var toEmail  = BLOCKED_TO.indexOf(toRaw.toLowerCase()) !== -1 ? '' : toRaw;
    var rowNum   = j + 2;

    if (!toEmail) missingTO.push('行' + rowNum + ': ' + siteName);

    // 重複チェックはB列のみ（会社名フォールバックなし）
    var nm = normalizeJP(String(data[j][1] || '').trim());
    if (nm.length >= 3 && completedNm[nm]) {
      dups.push('行' + rowNum + ': ' + siteName);
    } else if (nm.length >= 3) {
      for (var k = 0; k < completedKeys.length; k++) {
        var cn = completedKeys[k];
        var shorter = Math.min(cn.length, nm.length);
        if (shorter >= 7 && (nm.indexOf(cn) !== -1 || cn.indexOf(nm) !== -1)) {
          dups.push('行' + rowNum + ': ' + siteName + ' (→' + cn + ')');
          break;
        }
      }
    }

    // 未完了同名の重複検出（B列のみ、exact match）
    if (nm.length >= 3) {
      if (activeNmMap[nm]) {
        activeDups.push('行' + activeNmMap[nm] + ' と 行' + rowNum + ': ' + siteName);
      } else {
        activeNmMap[nm] = rowNum;
      }
    }
  }

  var lines = [];
  lines.push('=== TO未設定 (' + missingTO.length + '件) ===');
  missingTO.forEach(function(r) { lines.push(r); });
  lines.push('');
  lines.push('=== 重複（完了済みと同名） (' + dups.length + '件) ===');
  dups.forEach(function(r) { lines.push(r); });
  lines.push('');
  lines.push('=== 重複（未完了同名） (' + activeDups.length + '件) ===');
  activeDups.forEach(function(r) { lines.push(r); });
  return lines.join('\n');
}

// アースファスト案件でAFフラグが未設定のものを一括修正（1回だけ実行する）
// 対象: 会社名に「アースファスト」を含み、ステータスが完了/請求済み/報告済以外で、AFフラグが空の行
function fixMissingArsfastFlags() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) { Logger.log('シートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  var SKIP_STATUSES = ['完了', '請求済み', '報告済', 'キャンセル'];
  var fixed = 0;

  data.forEach(function(row, idx) {
    var company  = String(row[0]  || '').trim();
    var status   = String(row[10] || '').trim();
    var afFlag   = String(row[13] || '').trim();

    if (afFlag) return;
    if (company.indexOf('アースファスト') === -1) return;
    if (SKIP_STATUSES.indexOf(status) !== -1) return;
    if (!company) return;

    var rowNum = idx + 2;
    sheet.getRange(rowNum, AF_COL_FLAG).setValue('○');
    Logger.log('AFフラグ設定: 行' + rowNum + ' ' + company + ' / ' + String(row[1] || ''));
    fixed++;
  });

  Logger.log('完了: ' + fixed + '件にAFフラグを設定しました');
}

// 確認済み重複行を一括削除（1回だけ実行する）
function fixDuplicateRows() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) { Logger.log('シートが見つかりません'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  var toDelete = [];

  // 汎用重複検出
  var DONE_STATUS_DUP = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];
  var SAFE_TO_DELETE  = ['新規', ''];  // これ以外のステータスは削除しない
  var normalizedRows = [];
  data.forEach(function(row, idx) {
    if (toDelete.indexOf(idx + 2) !== -1) return;
    var nm  = normalizeJP(String(row[1] || ''));
    if (nm.length < 3) return;
    var kSt   = String(row[10] || '').trim();
    var wt    = normalizeJP(String(row[2]  || '').trim());
    var jDone = row[9] === true || String(row[9]).toLowerCase() === 'true';
    normalizedRows.push({
      rowNum:      idx + 2,
      nm:          nm,
      wt:          wt,
      isDone:      DONE_STATUS_DUP.indexOf(kSt) !== -1 || jDone,
      safeDelete:  SAFE_TO_DELETE.indexOf(kSt) !== -1
    });
  });

  for (var pi = 0; pi < normalizedRows.length; pi++) {
    for (var pj = pi + 1; pj < normalizedRows.length; pj++) {
      var a = normalizedRows[pi];
      var b = normalizedRows[pj];
      var nmShorter = Math.min(a.nm.length, b.nm.length);
      var nameMatch = a.nm === b.nm ||
        (nmShorter >= 7 && (a.nm.indexOf(b.nm) !== -1 || b.nm.indexOf(a.nm) !== -1));
      if (!nameMatch) continue;

      // ①両方「新規」で同名・工事種別も一致（または一方が空） → 古い行(a)を削除
      // ※工事種別が違う場合は同名でも別案件（同店舗の2件依頼）なので削除しない
      var wtSame = !a.wt || !b.wt || a.wt === b.wt || a.wt.indexOf(b.wt) !== -1 || b.wt.indexOf(a.wt) !== -1;
      if (!a.isDone && !b.isDone && a.safeDelete && wtSame && toDelete.indexOf(a.rowNum) === -1) {
        toDelete.push(a.rowNum);
        Logger.log('同名新規重複削除: 行' + a.rowNum + '→行' + b.rowNum + 'を残す 現場:' + a.nm);
      }

      // ②工事種類も一致する場合のみ: 完了済みと「新規」が同名同工事 → 「新規」を削除
      var wtMatch = a.wt && b.wt && (a.wt === b.wt || a.wt.indexOf(b.wt) !== -1 || b.wt.indexOf(a.wt) !== -1);
      if (wtMatch) {
        if (a.isDone && !b.isDone && b.safeDelete && toDelete.indexOf(b.rowNum) === -1) {
          toDelete.push(b.rowNum);
          Logger.log('完了済同工事重複削除: 行' + b.rowNum + ' 現場:' + b.nm + ' 工事:' + b.wt);
        }
        if (b.isDone && !a.isDone && a.safeDelete && toDelete.indexOf(a.rowNum) === -1) {
          toDelete.push(a.rowNum);
          Logger.log('完了済同工事重複削除(逆): 行' + a.rowNum + ' 現場:' + a.nm + ' 工事:' + a.wt);
        }
      }
    }
  }

  if (toDelete.length === 0) {
    Logger.log('削除対象なし（すでにクリーン）');
    return '削除対象なし（重複行は見つかりませんでした）';
  }

  // 下から削除（行番号ずれを防ぐ）
  toDelete.sort(function(a, b) { return b - a; });
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  Logger.log('削除完了: ' + toDelete.length + '行');
  return toDelete.length + '行を削除しました（行番号: ' + toDelete.join(', ') + '）';
}

// CC補完デバッグ：CC不完全な行をスキャンし、Gmailメッセージが取得できた最初の行の本文を返す
function debugCCExtraction_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 17).getValues();
  var DONE = ['報告済', '報告済み', '完了', '完了済', '請求済み', 'キャンセル'];

  var skipped = [];
  for (var idx = 0; idx < data.length; idx++) {
    var row     = data[idx];
    var afFlag  = String(row[13] || '').trim();
    var toEmail = String(row[14] || '').trim();
    var ccRawP  = String(row[15] || '').replace(/\s/g, '').toLowerCase();
    var ccIncomplete = !ccRawP || ccRawP === 'info@marukendenkou.com'
      || ccRawP.indexOf('mky7584gd') !== -1 || ccRawP.indexOf('s.shigeno1016') !== -1;
    if (afFlag !== '○' || !toEmail || !ccIncomplete) continue;
    var status = String(row[10] || '').trim();
    if (DONE.indexOf(status) !== -1) continue;

    var notes = String(row[12] || '');
    var siteName = String(row[1] || row[0] || '').trim();
    var msgIdMatch = notes.match(/\[ID:([^\]]+)\]/);
    if (!msgIdMatch) {
      skipped.push('行' + (idx+2) + ':IDタグなし');
      continue;
    }
    try {
      var msg = GmailApp.getMessageById(msgIdMatch[1]);
      if (!msg) {
        skipped.push('行' + (idx+2) + ':msg=null');
        continue;
      }
      var body = msg.getPlainBody();
      var fromRaw = msg.getFrom();
      var ccHeader = msg.getCc();
      var extracted = extractForwardedCC_(body);
      var prefix = skipped.length ? '[スキップ: ' + skipped.join(', ') + ']\n' : '';
      return prefix + '行' + (idx+2) + ' ' + siteName
        + '\nFROM=' + fromRaw
        + '\nmsg.getCc()=' + ccHeader
        + '\n抽出CC=' + extracted.join(',')
        + '\n本文冒頭300字:\n' + body.substring(0, 300);
    } catch(e) {
      skipped.push('行' + (idx+2) + ':' + e.toString().substring(0, 40));
    }
  }
  var skipInfo = skipped.length ? '\nスキップ: ' + skipped.join(', ') : '';
  return 'CC不完全な対象行なし' + skipInfo;
}

// 転送メール本文のヘッダー部分（From/To/Cc）から全メールアドレスを抽出
// Cc: 行だけでなく To: 行・折り返し行も対象にする
function extractForwardedCC_(body) {
  // 転送セクション開始を探す
  var fwdMarkers = ['---------- Forwarded message', '-------- Forwarded Message', 'Forwarded message', '転送されたメッセージ'];
  var fwdIdx = -1;
  for (var si = 0; si < fwdMarkers.length; si++) {
    fwdIdx = body.indexOf(fwdMarkers[si]);
    if (fwdIdx !== -1) break;
  }
  // 転送セクションが見つからなければ全体を対象
  var section = fwdIdx !== -1 ? body.substring(fwdIdx) : body;

  // ヘッダー部分のみ（最初の空行まで）
  var blankLine = section.search(/\r?\n\r?\n/);
  var headerSection = blankLine !== -1 ? section.substring(0, blankLine) : section.substring(0, 2000);

  // ヘッダー内のメールアドレスを全て抽出（From/To/Cc 問わず）
  var BLOCK = ['mky7584gd', 's.shigeno1016'];
  var emails = [];
  var pat = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  var m;
  while ((m = pat.exec(headerSection)) !== null) {
    var e = m[0].toLowerCase();
    if (BLOCK.every(function(b) { return e.indexOf(b) === -1; }) && emails.indexOf(e) === -1) {
      emails.push(e);
    }
  }
  return emails;
}

// ─── 一時保存（複数対応・PropertiesService）────────────────────
function saveDraftServer(id, json) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('arsfast_draft_' + id, json);
  var idx = JSON.parse(props.getProperty('arsfast_draft_index') || '[]');
  if (idx.indexOf(id) === -1) idx.push(id);
  props.setProperty('arsfast_draft_index', JSON.stringify(idx));
  return 'OK';
}

function loadDraftListServer() {
  var props = PropertiesService.getScriptProperties();
  var idx = JSON.parse(props.getProperty('arsfast_draft_index') || '[]');
  var list = [];
  idx.forEach(function(id) {
    var raw = props.getProperty('arsfast_draft_' + id);
    if (!raw) return;
    try {
      var d = JSON.parse(raw);
      list.push({ id: id, savedAt: d.savedAt || '', siteName: d.order ? (d.order.site_name || '') : '' });
    } catch(e) {}
  });
  list.sort(function(a, b) { return b.savedAt.localeCompare(a.savedAt); });
  return JSON.stringify(list);
}

function loadDraftServer(id) {
  return PropertiesService.getScriptProperties().getProperty('arsfast_draft_' + id) || '';
}

function deleteDraftServer(id) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('arsfast_draft_' + id);
  var idx = JSON.parse(props.getProperty('arsfast_draft_index') || '[]');
  idx = idx.filter(function(i) { return i !== id; });
  props.setProperty('arsfast_draft_index', JSON.stringify(idx));
  return 'OK';
}

// 指定店舗名を含む全行の詳細を表示（重複か繰り返し客かの判断用）
function diagnoseStoreRows_(storeName) {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  var lines = [];

  data.forEach(function(row, idx) {
    var company  = String(row[0]  || '').trim();
    var site     = String(row[1]  || '').trim();
    var workType = String(row[2]  || '').trim();
    var status   = String(row[10] || '').trim();
    var af       = String(row[13] || '').trim();
    var toEmail  = String(row[14] || '').trim();
    // M列の備考から[ID:...]を確認
    var notes    = String(row[12] || '');
    var hasId    = notes.indexOf('[ID:') !== -1;

    var label = site || company;
    if (label.indexOf(storeName) === -1) return;

    lines.push('--- 行' + (idx + 2) + ' ---');
    lines.push('A列(会社): ' + company);
    lines.push('B列(現場): ' + (site || '(空)'));
    lines.push('C列(工事): ' + workType);
    lines.push('K列(状態): ' + (status || '(空)'));
    lines.push('N列(AF) : ' + (af || '(空)'));
    lines.push('O列(TO) : ' + (toEmail || '(空)'));
    lines.push('IDタグ  : ' + (hasId ? 'あり' : 'なし'));
  });

  return lines.length ? lines.join('\n') : storeName + ' の行が見つかりません';
}

// メール本文から現場名・店舗名を抽出する（「現場名：」「施工場所：」等のラベルを探す）
function extractSiteNameFromBody_(body) {
  if (!body) return '';
  // ラベルパターン: 「現場名：〇〇店」「施工場所：〇〇」「店舗名：〇〇」など
  var labelPatterns = [
    /(?:現場名|施工場所|店舗名|現場|物件名|対象店舗|作業場所)\s*[:：]\s*([^\r\n]{2,40})/,
    /(?:場所|住所)\s*[:：]\s*(?![0-9〒])([^\r\n]{2,30}(?:店|館|センター|工場|ビル|病院|学校))/,
  ];
  for (var pi = 0; pi < labelPatterns.length; pi++) {
    var m = body.match(labelPatterns[pi]);
    if (m) {
      var val = m[1].trim()
        .replace(/[\s　]+/g, ' ')
        .replace(/[（(][^）)]*[）)]/g, '')  // 括弧内を除去
        .trim();
      if (val.length >= 2 && val.length <= 40) return val;
    }
  }
  return '';
}

// 件名から店舗名・現場名を抽出する。抽出できなかった場合は '' を返す
function extractSiteNameFromSubject_(subject, workType) {
  // Fwd/Re/FW プレフィックスを再帰的に除去
  var s = subject;
  s = s.replace(/^((Fwd?|Re|RE|FW|fw|re|転送|返信)\s*[:：]\s*)+/i, '');
  // 【】[] タグを除去
  s = s.replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  // メアドを除去
  s = s.replace(/[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // 日付パターンを除去（6/1(月)、6月1日、R7.6.1 など）
  s = s.replace(/[0-9]+\s*[\/]\s*[0-9]+\s*[\(（][月火水木金土日][）\)]/g, '');
  s = s.replace(/[0-9]+月[0-9]+日/g, '');
  s = s.replace(/[RH][0-9]+\.[0-9]+\.[0-9]+/g, '');
  // スペース整理
  s = s.replace(/[\s　]+/g, ' ').trim();

  // 工事種類・作業種類のキーワード（件名から除外するノイズ）
  var noiseWords = ['工事','修繕','修理','交換','取替','依頼','確認','調査','報告','見積',
    '施工','対応','照明','ライティング','TV','テレビ','エアコン','電気','設備',
    'の件','について','ご依頼','ご確認','至急','再調査','施工費','費用'];

  // スラッシュ・読点で分割してトークン化
  var tokens = s.split(/[\/\/\s　・,、]/);

  // 店舗名らしいトークンを優先的に採用
  // 店舗名パターン: 固有名詞＋（店・センター・工場・ビル・病院・学校など）
  var storePattern = /[ぁ-んァ-ヶ一-龠a-zA-Zａ-ｚＡ-Ｚ0-9０-９]{2,}/;
  var storeSuffix  = /[店舗院館場所区棟ホールセンタービル工場学校市]/;

  var candidate = '';
  for (var ti = 0; ti < tokens.length; ti++) {
    var t = tokens[ti].trim();
    if (t.length < 2) continue;
    // ノイズワードだけのトークンはスキップ
    var isNoise = noiseWords.some(function(n) { return t === n || t.indexOf(n) !== -1 && t.length <= n.length + 2; });
    if (isNoise) continue;
    // 店舗系サフィックスがあれば優先採用
    if (storePattern.test(t) && storeSuffix.test(t)) { candidate = t; break; }
    // なければ最初のまともなトークンをキープ
    if (!candidate && storePattern.test(t)) candidate = t;
  }

  // 候補が工事種類そのもの・日本語助詞始まり・短すぎる場合はNG
  if (!candidate) return '';
  if (candidate.length < 3) return '';
  var isJunk = noiseWords.some(function(n) { return candidate === n; })
    || /^[のはがをにへでもや]/.test(candidate)
    || (workType && candidate === workType);
  if (isJunk) return '';

  return candidate;
}

// B列に誤って書き込まれた件名っぽい値を消去（Fwd:/Re:始まりや「〜の件」パターン）
function cleanBadSiteNames_() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  if (!sheet) return 'シートなし';
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
  var cleared = [];

  data.forEach(function(row, idx) {
    var af = String(row[13] || '').trim();
    if (af !== '○') return;
    var siteName = String(row[1] || '').trim();
    if (!siteName) return;

    // 件名パターン判定
    var isBad = /^(Fwd?|Re|RE|FW|fw|re)\s*[:：]/i.test(siteName)
      || /^(転送|返信)[:：]/.test(siteName)
      || /[のについ].*[件頼告]$/.test(siteName)
      || /[0-9]+\s*\/\s*[0-9]+[\(（][月火水木金土日][）\)]/.test(siteName);

    if (isBad) {
      sheet.getRange(idx + 2, 2).setValue('');
      cleared.push('行' + (idx + 2) + ': 「' + siteName + '」→ 消去');
    }
  });

  return cleared.length ? cleared.join('\n') : '不正な現場名なし';
}

// ─── 自動補完トリガー ──────────────────────────────────────────────

// タイムトリガーから呼ばれる自動補完エントリーポイント
function arsfastAutoFill() {
  runArsfastEmailMigration();
  recoverSiteNamesFromGmail_();
  // fixDuplicateRows は自動実行しない（リピート案件の誤削除防止）
}

// 毎日早朝6時に自動補完を実行するトリガーをセット（1回だけ実行すればOK）
function setupArsfastDailyTrigger() {
  // 既存の同名トリガーを削除してから再登録（重複防止）
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'arsfastAutoFill') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('arsfastAutoFill')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  return '毎日6時に自動補完トリガーをセットしました';
}

// トリガーの現在の状態を確認
function checkArsfastTrigger() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'arsfastAutoFill';
  });
  if (triggers.length === 0) return 'トリガー未設定';
  return 'トリガー設定済み: ' + triggers.length + '件（毎日6時に自動実行）';
}
