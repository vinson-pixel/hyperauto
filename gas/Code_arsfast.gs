var SUPABASE_URL  = 'https://yqqhnldrbzmkrpcnpqmt.supabase.co';
var SUPABASE_ANON = 'sb_publishable_u62lqaFf_3Njb2BF2pT9iA_1Q0MqzDd';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index_arsfast')
    .setTitle('アースファスト作業報告書')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 未対応案件をSupabaseから取得
function getOrders() {
  var url = SUPABASE_URL + '/rest/v1/work_reports'
    + '?select=id,site_no,site_name,site_address,site_tel,requester,work_type,reply_to_email,reply_cc_emails,in_reply_to'
    + '&status=eq.pending&client_format=eq.arsfast&order=created_at.desc&limit=20';
  try {
    var res = UrlFetchApp.fetch(url, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON }
    });
    return JSON.parse(res.getContentText());
  } catch(e) {
    Logger.log('getOrders error: ' + e);
    return [];
  }
}

// 案件ステータスをsubmittedに更新
function updateOrderStatus(orderId) {
  if (!orderId) return;
  var url = SUPABASE_URL + '/rest/v1/work_reports?id=eq.' + orderId;
  try {
    UrlFetchApp.fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': 'Bearer ' + SUPABASE_ANON,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify({ status: 'submitted' })
    });
  } catch(e) {
    Logger.log('updateOrderStatus error: ' + e);
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

  var mailOptions = { attachments: attachments, name: '作業報告 自動送信' };
  if (data.ccEmail) mailOptions.cc = data.ccEmail;

  GmailApp.sendEmail(data.toEmail||'', subject, mailBody, mailOptions);

  // 案件ステータスをsubmittedに更新
  if (data.pendingOrderId) {
    updateOrderStatus(data.pendingOrderId);
  }

  return folderUrl;
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