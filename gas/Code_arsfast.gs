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

function debugSheetStructure() {
  var ss = SpreadsheetApp.openById('1UptuKwGKdMiYGiyWwL55yLKXNQ5xkevKv-X0MVikcKw');
  var sheets = ss.getSheets();
  sheets.forEach(function(s) {
    var headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
    Logger.log('シート名: ' + s.getName() + ' (gid=' + s.getSheetId() + ')');
    Logger.log('ヘッダー: ' + headers.join(' | '));
    Logger.log('データ行数: ' + (s.getLastRow() - 1));
    Logger.log('---');
  });
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
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
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

// 備考列のAFタグをパースしてメール情報を返す
function parseArsfastNotes_(notes) {
  var toMatch     = notes.match(/\[AF_TO:([^\]]+)\]/);
  var ccMatch     = notes.match(/\[AF_CC:([^\]]*)\]/);
  var threadMatch = notes.match(/\[AF_THREAD:([^\]]+)\]/);
  return {
    reply_to_email:  toMatch     ? toMatch[1].trim()                                          : '',
    reply_cc_emails: ccMatch && ccMatch[1] ? ccMatch[1].split(',').map(function(s){return s.trim();}).filter(Boolean) : [],
    in_reply_to:     threadMatch ? threadMatch[1].trim()                                      : '',
  };
}

// 会社名でSupabaseレコードを探す（サイト詳細情報の補完用・前後方一致）
function findSupaRecBySiteName_(supaOrders, company) {
  if (!company || !supaOrders.length) return null;
  var compLower = company.toLowerCase();
  for (var j = 0; j < supaOrders.length; j++) {
    var sn = String(supaOrders[j].site_name || '').trim().toLowerCase();
    if (!sn) continue;
    if (sn === compLower || sn.indexOf(compLower) !== -1 || compLower.indexOf(sn) !== -1) {
      return supaOrders[j];
    }
  }
  return null;
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
    data.forEach(function(row, idx) {
      var company      = String(row[0]  || '').trim(); // A: 会社名
      var siteName     = String(row[1]  || '').trim() || company; // B: 現場名（なければ会社名）
      var workType     = String(row[2]  || '').trim(); // C: 施工内容
      var workDate     = row[3];                       // D: 施工日
      var completeDate = row[4];                       // E: 完了日
      var aiDate       = row[5];                       // F: AIから転送日
      var status       = String(row[10] || '').trim(); // K: ステータス
      var afFlag       = String(row[13] || '').trim(); // N: AFフラグ
      var replyToEmail = String(row[14] || '').trim(); // O: 返信先メール
      var ccRaw        = String(row[15] || '').trim(); // P: CC
      var threadId     = String(row[16] || '').trim(); // Q: スレッドID
      var requestDetail= String(row[17] || '').trim(); // R: 依頼内容詳細

      // N列にAFフラグがない案件はスキップ
      if (!afFlag) return;
      // J列（完了報告）にチェックが入っていたらスキップ
      if (row[9] === true || row[9] === 'TRUE') return;
      if (!company) return;

      var rowNum = idx + 2;
      var ccEmails = ccRaw ? ccRaw.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];

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
        reply_to_email:  replyToEmail  || (supaRec ? supaRec.reply_to_email  || '' : ''),
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

  var templateId = '1eht40dFfBprEHLldmZbc4sklGbmQj1cBpkqps59ws9g';
  var fileDateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var filename = 'アースファスト報告書_' + (data.clientName||'') + '_' + fileDateStr;
  var folder = DriveApp.getFolderById('1V_epzfbW6ERny39Gno-339wLWKrhFBec');
  var subFolder = folder.createFolder((data.clientName||'未入力') + '_' + fileDateStr);

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

  // セルを1つずつ置換（画像セルをスキップ）
  var maxRow = sheet2.getLastRow();
  var maxCol = sheet2.getLastColumn();
  for (var i = 1; i <= maxRow; i++) {
    for (var j = 1; j <= maxCol; j++) {
      // ロゴエリア(O2:T7 = 行2-7, 列15-20)と署名セルはスキップ
      if (i >= 2 && i <= 7 && j >= 15 && j <= 20) continue;
      try {
        var cell = sheet2.getRange(i, j);
        var cellVal = cell.getValue();
        if (typeof cellVal === 'string' && cellVal.indexOf('{{') !== -1) {
          for (var key in replacements) {
            if (cellVal.indexOf(key) !== -1) {
              cellVal = cellVal.replace(new RegExp(key.replace(/[{}]/g,'\\$&'),'g'), replacements[key]);
            }
          }
          cell.setValue(cellVal);
        }
      } catch(e) {
        // 画像セルなどはスキップ
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
  Utilities.sleep(1000);

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
  var fileUrl = pdfFile.getUrl();
  var folderUrl = subFolder.getUrl();
  var subject = '【作業報告】' + (data.workDate||'') + ' 店舗No.' + (data.storeNo||'') + ' ' + (data.clientName||'') + '様';
  var mailBody =
    'お世話になっております。\n\n' +
    (data.workDate||'') + ' に実施いたしました作業報告書および施工写真をお送りします。\n\n' +
    '【店舗No.】　' + (data.storeNo||'') + '\n' +
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
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  var updated = 0;
  data.forEach(function(row, idx) {
    var notes   = String(row[12] || '');
    var company = String(row[0]  || '').trim();
    var siteName = String(row[1] || '').trim() || company;

    // [AF]タグがある行のみ対象（N列未設定のものを移行）
    if (notes.indexOf('[AF]') === -1) return;
    // N列（AFフラグ）がすでに設定済みならスキップ
    if (String(row[13] || '').trim()) return;

    var supaRec = findSupaRecBySiteName_(supaOrders, siteName) || findSupaRecBySiteName_(supaOrders, company);

    var replyTo = supaRec ? supaRec.reply_to_email : null;
    var ccEmails = supaRec ? (supaRec.reply_cc_emails || []) : [];
    var threadId = supaRec ? supaRec.in_reply_to : null;

    // Supabaseマッチなし → ①[ID:msgId]からGmail直接取得、②店舗名でGmail検索
    if (!replyTo) {
      // ① 備考の[ID:msgId]でメッセージを取得
      var msgIdMatch = notes.match(/\[ID:([^\]]+)\]/);
      if (msgIdMatch) {
        try {
          var msg = GmailApp.getMessageById(msgIdMatch[1]);
          if (msg) {
            var fromRaw = msg.getFrom();
            if (fromRaw && fromRaw.indexOf('mky7584gd@gmail.com') !== -1) {
              var body = msg.getPlainBody();
              var arsfastMatch = body.match(/([a-zA-Z0-9._+\-]+@arsfast\.com)/);
              replyTo = arsfastMatch ? arsfastMatch[1] : null;
            } else {
              replyTo = extractEmailAddr_(fromRaw);
            }
            if (replyTo) {
              var ccRaw = msg.getCc();
              if (ccRaw) {
                ccEmails = ccRaw.split(',').map(function(s){ return extractEmailAddr_(s.trim()); }).filter(Boolean);
              }
              threadId = msg.getThread().getId();
            }
          }
        } catch(e) { Logger.log('Gmail[ID] lookup error: ' + e); }
      }
    }

    // ② [ID]なし or マッチなし → 店舗名でGmail検索（複数パターン試行）
    if (!replyTo && siteName && siteName.length > 2) {
      var queries = [
        siteName + ' from:arsfast.com',
        siteName + ' to:arsfast.com',
        siteName + ' (from:arsfast.com OR to:arsfast.com)',
      ];
      // 名前が長い場合は先頭6文字でも試す
      if (siteName.length > 6) {
        queries.push(siteName.substring(0, 6) + ' from:arsfast.com');
        queries.push(siteName.substring(0, 6) + ' to:arsfast.com');
      }
      // よくある誤字を修正して再検索
      var corrected = siteName
        .replace('ドラック', 'ドラッグ')
        .replace('mytstic', 'mystic')
        .replace('mytstic', 'Mystic');
      if (corrected !== siteName) {
        queries.push(corrected + ' from:arsfast.com');
        queries.push(corrected + ' to:arsfast.com');
        queries.push(corrected.substring(0, 6) + ' from:arsfast.com');
      }
      for (var qi = 0; qi < queries.length && !replyTo; qi++) {
        try {
          var threads = GmailApp.search(queries[qi], 0, 5);
          for (var ti = 0; ti < threads.length && !replyTo; ti++) {
            var msgs = threads[ti].getMessages();
            for (var mi = 0; mi < msgs.length && !replyTo; mi++) {
              var m = msgs[mi];
              var fromRaw2 = m.getFrom();
              var toRaw2   = m.getTo();
              // arsfast.com が FROM か TO にある場合のみ採用
              var hasArsfast = (fromRaw2 && fromRaw2.indexOf('arsfast.com') !== -1) ||
                               (toRaw2   && toRaw2.indexOf('arsfast.com') !== -1);
              if (!hasArsfast) continue;

              if (fromRaw2 && fromRaw2.indexOf('mky7584gd@gmail.com') !== -1) {
                // 転送メール：本文から arsfast.com アドレスを探す
                var body2 = m.getPlainBody();
                var af2 = body2.match(/([a-zA-Z0-9._+\-]+@arsfast\.com)/);
                if (af2) replyTo = af2[1];
              } else if (fromRaw2 && fromRaw2.indexOf('arsfast.com') !== -1) {
                replyTo = extractEmailAddr_(fromRaw2);
              } else if (toRaw2 && toRaw2.indexOf('arsfast.com') !== -1) {
                // TO が arsfast.com → 弊社からアースファストへの返信スレッド
                var toEmails = toRaw2.split(',').map(function(s){ return extractEmailAddr_(s.trim()); });
                for (var te = 0; te < toEmails.length; te++) {
                  if (toEmails[te].indexOf('arsfast.com') !== -1) { replyTo = toEmails[te]; break; }
                }
              }

              if (replyTo) {
                var ccRaw2 = m.getCc();
                if (ccRaw2) {
                  ccEmails = ccRaw2.split(',').map(function(s){ return extractEmailAddr_(s.trim()); }).filter(Boolean);
                }
                threadId = threads[ti].getId();
                Logger.log('Gmail検索ヒット[' + qi + ']: ' + siteName + ' → ' + replyTo);
              }
            }
          }
        } catch(e) { Logger.log('Gmail search error[' + qi + ']: ' + e); }
      }
    }

    // メールが見つからなくてもN列にフラグだけ立てる（TO/CC/THREADは空）
    var rowNum = idx + 2;
    sheet.getRange(rowNum, AF_COL_FLAG).setValue('○');   // N: AFフラグ
    if (replyTo) {
      sheet.getRange(rowNum, AF_COL_TO).setValue(replyTo);                       // O: TO
      sheet.getRange(rowNum, AF_COL_CC).setValue(ccEmails.join(','));            // P: CC
      if (threadId) sheet.getRange(rowNum, AF_COL_THREAD).setValue(threadId);   // Q: スレッドID
    }
    // M列から[AF*]タグを除去（[ID:...]は残す）
    var cleaned = notes.replace(/\s*\[AF[^\]]*\]/g, '').trim();
    sheet.getRange(rowNum, 13).setValue(cleaned);

    if (replyTo) {
      Logger.log('更新: 行' + rowNum + ' ' + siteName + ' → TO:' + replyTo);
    } else {
      Logger.log('フラグのみ設定（メールなし）: 行' + rowNum + ' ' + siteName);
    }
    updated++;
  });
  Logger.log('バックフィル完了: ' + updated + '件更新');
}

// 未マッチ6件の詳細診断（なぜ自動マッチが失敗するか確認用）
function debugMigrationFailures() {
  var targetStores = ['平安薬局', 'ららぽーと名古屋みなとアクスル', 'アピタ岡崎北', 'ドラックスギヤマ豊田', 'ニトリ名古屋みなと', 'mytstic名古屋ゲートモールタワー'];

  // Supabaseの全arsfast件名を表示
  Logger.log('=== Supabase arsfast 件名一覧 ===');
  try {
    var allUrl = SUPABASE_URL + '/rest/v1/work_reports'
      + '?select=id,site_name,reply_to_email'
      + '&client_format=eq.arsfast&order=created_at.desc&limit=500';
    var res = UrlFetchApp.fetch(allUrl, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON },
      muteHttpExceptions: true
    });
    var supaOrders = JSON.parse(res.getContentText());
    supaOrders.forEach(function(r) {
      Logger.log('  ' + r.site_name + ' → ' + (r.reply_to_email || '(メールなし)'));
    });
  } catch(e) { Logger.log('Supabase error: ' + e); }

  // 各店舗の備考内容 + Gmailクエリ試行
  Logger.log('=== スプレッドシート対象行の備考 ===');
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  data.forEach(function(row, idx) {
    var notes    = String(row[12] || '');
    var company  = String(row[0]  || '').trim();
    var siteName = String(row[1]  || '').trim() || company;

    if (notes.indexOf('[AF]') === -1) return;
    if (notes.indexOf('[AF_TO:') !== -1) return;

    var isTarget = targetStores.some(function(t) { return siteName.indexOf(t.substring(0, 4)) !== -1 || t.indexOf(siteName.substring(0, 4)) !== -1; });
    if (!isTarget) return;

    Logger.log('行' + (idx+2) + ': ' + siteName);
    Logger.log('  備考: ' + notes);

    // Gmail検索テスト（最初のクエリだけ試す）
    var testQueries = [
      siteName + ' from:arsfast.com',
      siteName + ' to:arsfast.com',
      siteName.substring(0, 4),
      company + ' from:arsfast.com',
    ];
    testQueries.forEach(function(q) {
      try {
        var threads = GmailApp.search(q, 0, 3);
        Logger.log('  Gmail[' + q + ']: ' + threads.length + '件');
        threads.forEach(function(t) {
          var msgs = t.getMessages();
          if (msgs.length) {
            var first = msgs[0];
            Logger.log('    件名: ' + first.getSubject());
            Logger.log('    FROM: ' + first.getFrom());
          }
        });
      } catch(e) { Logger.log('  Gmail error: ' + e); }
    });
  });
}

// B列（現場名）が住所になってる重複行を削除する（1回実行用）
function deleteAddressDuplicateRows() {
  var ss    = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  var lastRow = sheet.getLastRow();
  var deleted = 0;

  // 下から削除（行番号のずれを防ぐ）
  for (var i = lastRow; i >= 2; i--) {
    var siteName = String(sheet.getRange(i, 2).getValue() || '').trim(); // B列
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

function debugOrders() {
  var ss = SpreadsheetApp.openById(ARSFAST_SS_ID);
  var sheet = getSheetByGid_(ss, ARSFAST_SHEET_GID);
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  data.forEach(function(row, idx) {
    var company      = String(row[0]  || '').trim();
    var status       = String(row[10] || '').trim();
    var notes        = String(row[12] || '');
    var completeDate = row[4];
    if (company.indexOf('眼鏡') !== -1 || company.indexOf('香流') !== -1) {
      Logger.log('行' + (idx+2) + ': 会社名=' + company);
      Logger.log('  ステータス=' + status);
      Logger.log('  完了日=' + completeDate);
      Logger.log('  備考=[' + notes + ']');
      Logger.log('  [AF]あり=' + (notes.indexOf('[AF]') !== -1));
    }
  });
}

function findCell(sheet, text) {
  var maxRow = sheet.getLastRow();
  var maxCol = sheet.getLastColumn();
  for (var i = 1; i <= maxRow; i++) {
    for (var j = 1; j <= maxCol; j++) {
      try {
        var val = sheet.getRange(i, j).getValue();
        if (typeof val === 'string' && val.indexOf(text) !== -1) {
          return { row: i, col: j };
        }
      } catch(e) {}
    }
  }
  return null;
}
