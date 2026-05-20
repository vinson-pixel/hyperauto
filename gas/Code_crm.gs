// ─── 顧客管理 / 下請け管理 ─────────────────────────────────────────
// スプレッドシート: PROSPECT_SS_ID 内の別シートを使用

// ── 顧客管理 ────────────────────────────────────────────────────────
// 顧客 = 一度でも取引のある元請け先。連絡先管理がメイン用途。
var CUSTOMER_HEADERS = [
  '会社名','受注日','担当者名','電話番号','メールアドレス','最終連絡日','メモ','住所'
];
var CC = {
  COMPANY:      1, // A: 会社名
  WON_DATE:     2, // B: 受注日（取引開始日）
  CONTACT:      3, // C: 担当者名
  PHONE:        4, // D: 電話番号
  EMAIL:        5, // E: メールアドレス
  LAST_CONTACT: 6, // F: 最終連絡日
  MEMO:         7, // G: メモ（複数担当者もここに記入）
  ADDRESS:      8, // H: 住所
};
var CUSTOMER_CYCLE_DAYS = 30; // 全社共通の連絡サイクル（日）— 後で変更可

function getCustomerSheet_() {
  var ss = SpreadsheetApp.openById(PROSPECT_SS_ID);
  var sheet = ss.getSheetByName('顧客管理');
  if (!sheet) {
    sheet = ss.insertSheet('顧客管理');
    var hdr = sheet.getRange(1, 1, 1, CUSTOMER_HEADERS.length);
    hdr.setValues([CUSTOMER_HEADERS]).setFontWeight('bold').setBackground('#e8f4fd');
  } else {
    // 既存シートに住所列がなければ追加（マイグレーション）
    var lastCol = sheet.getLastColumn();
    if (lastCol < CUSTOMER_HEADERS.length) {
      for (var c = lastCol + 1; c <= CUSTOMER_HEADERS.length; c++) {
        var cell = sheet.getRange(1, c);
        cell.setValue(CUSTOMER_HEADERS[c - 1]).setFontWeight('bold').setBackground('#e8f4fd');
      }
    }
  }
  return sheet;
}

function getCustomers() {
  var sheet = getCustomerSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { items: [], cycleDays: CUSTOMER_CYCLE_DAYS };
  var cols = Math.max(sheet.getLastColumn(), 8);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var today = new Date(); today.setHours(0,0,0,0);
  var items = data.map(function(row, idx) {
    if (!String(row[0] || '').trim()) return null;
    var lc = row[CC.LAST_CONTACT - 1];
    var lcStr = lc instanceof Date && !isNaN(lc)
      ? Utilities.formatDate(lc, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(lc || '');
    var daysSince = (lc instanceof Date && !isNaN(lc))
      ? Math.floor((today - lc) / 86400000) : null;
    var wonRaw = row[CC.WON_DATE - 1];
    var wonStr = wonRaw instanceof Date && !isNaN(wonRaw)
      ? Utilities.formatDate(wonRaw, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(wonRaw || '');
    return {
      rowIndex:    idx + 2,
      company:     String(row[CC.COMPANY     - 1] || '').trim(),
      wonDate:     wonStr,
      contact:     String(row[CC.CONTACT     - 1] || ''),
      phone:       String(row[CC.PHONE       - 1] || ''),
      email:       String(row[CC.EMAIL       - 1] || ''),
      lastContact: lcStr,
      daysSince:   daysSince,
      memo:        String(row[CC.MEMO        - 1] || ''),
      address:     String(row[CC.ADDRESS     - 1] || ''),
    };
  }).filter(Boolean);
  return { items: items, cycleDays: CUSTOMER_CYCLE_DAYS };
}

function addCustomer(data) {
  var sheet = getCustomerSheet_();
  // 重複チェック（同会社名がすでにある場合はスキップ）
  var lastRow = sheet.getLastRow();
  if (lastRow > 1 && data.company) {
    var existing = sheet.getRange(2, CC.COMPANY, lastRow - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0] || '').trim() === String(data.company).trim()) {
        return { ok: true, rowIndex: i + 2, skipped: true };
      }
    }
  }
  sheet.appendRow([
    data.company     || '',
    data.wonDate     || '',
    data.contact     || '',
    data.phone       || '',
    data.email       || '',
    data.lastContact || '',
    data.memo        || '',
    data.address     || '',
  ]);
  // 営業リストにも同期（なければ追加、あれば受注ステージ＋連絡先更新）
  try { _syncCustomerToProspectOnAdd_(data); } catch(e) { Logger.log('sync error: ' + e); }
  return { ok: true, rowIndex: sheet.getLastRow() };
}

function updateCustomerCell(rowIndex, col, value) {
  var sheet = getCustomerSheet_();
  sheet.getRange(rowIndex, col).setValue(value);
  // 担当者名・電話・メールの変更は営業リスト側にも反映
  try {
    var syncCols = _getCcToPcMap_();
    if (syncCols[col] !== undefined) {
      var company = String(sheet.getRange(rowIndex, CC.COMPANY).getValue() || '').trim();
      _syncFieldToProspect_(company, syncCols[col], value);
    }
  } catch(e) { Logger.log('sync error: ' + e); }
  return { ok: true };
}

function deleteCustomer(rowIndex) {
  getCustomerSheet_().deleteRow(rowIndex);
  return { ok: true };
}

// ── 下請け管理 ────────────────────────────────────────────────────────
var SUBCON_HEADERS = [
  '会社名','担当者名','電話番号','メールアドレス','得意工種',
  '対応エリア','稼働状況','昼単価(円)','支払サイト','評価','実績・メモ','夜単価(円)','夜勤OK'
];
var SC = {
  COMPANY: 1, CONTACT: 2, PHONE: 3, EMAIL: 4,
  SPECIALTY: 5, AREA: 6, STATUS: 7,
  RATE: 8, PAYMENT: 9, RATING: 10, MEMO: 11,
  RATE_NIGHT: 12, NIGHT_OK: 13,
};

function getSubconSheet_() {
  var ss = SpreadsheetApp.openById(PROSPECT_SS_ID);
  var sheet = ss.getSheetByName('下請け管理');
  if (!sheet) {
    sheet = ss.insertSheet('下請け管理');
    var hdr = sheet.getRange(1, 1, 1, SUBCON_HEADERS.length);
    hdr.setValues([SUBCON_HEADERS]).setFontWeight('bold').setBackground('#fef9e7');
  } else {
    // 既存シートに新列がなければ追加（マイグレーション）
    var lastCol = sheet.getLastColumn();
    // col8のヘッダーを「昼単価(円)」に更新
    if (lastCol >= 8) {
      var h8 = String(sheet.getRange(1, 8).getValue() || '');
      if (h8 !== '昼単価(円)') sheet.getRange(1, 8).setValue('昼単価(円)').setFontWeight('bold').setBackground('#fef9e7');
    }
    for (var c = lastCol + 1; c <= SUBCON_HEADERS.length; c++) {
      sheet.getRange(1, c).setValue(SUBCON_HEADERS[c - 1]).setFontWeight('bold').setBackground('#fef9e7');
    }
  }
  return sheet;
}

function getSubcontractors() {
  var sheet = getSubconSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var cols = Math.max(sheet.getLastColumn(), SUBCON_HEADERS.length);
  var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  return data.map(function(row, idx) {
    var co = String(row[SC.COMPANY - 1] || '').trim();
    var ct = String(row[SC.CONTACT - 1] || '').trim();
    if (!co && !ct) return null; // 会社名も担当者名も空はスキップ
    return {
      rowIndex:   idx + 2,
      company:    co,
      contact:    ct,
      phone:      String(row[SC.PHONE     - 1] || ''),
      email:      String(row[SC.EMAIL     - 1] || ''),
      specialty:  String(row[SC.SPECIALTY - 1] || ''),
      area:       String(row[SC.AREA      - 1] || ''),
      status:     String(row[SC.STATUS    - 1] || '要確認'),
      rate:       row[SC.RATE       - 1] || '',
      payment:    String(row[SC.PAYMENT   - 1] || ''),
      rating:     parseFloat(row[SC.RATING - 1]) || 0,
      memo:       String(row[SC.MEMO      - 1] || ''),
      rateNight:  row[SC.RATE_NIGHT - 1] || '',
      nightOk:    String(row[SC.NIGHT_OK  - 1] || ''),
    };
  }).filter(Boolean);
}

function addSubcontractor(data) {
  var sheet = getSubconSheet_();
  sheet.appendRow([
    data.company || '', data.contact || '', data.phone || '', data.email || '',
    data.specialty || '', data.area || '', data.status || '空き',
    data.rate || '', data.payment || '', parseFloat(data.rating) || 0, data.memo || '',
    data.rateNight || '', data.nightOk || '',
  ]);
  return { ok: true, rowIndex: sheet.getLastRow() };
}

function updateSubcontractorCell(rowIndex, col, value) {
  getSubconSheet_().getRange(rowIndex, col).setValue(value);
  return { ok: true };
}

function deleteSubcontractor(rowIndex) {
  getSubconSheet_().deleteRow(rowIndex);
  return { ok: true };
}

// ── 営業リスト同期ヘルパー ──────────────────────────────────────

function _getCcToPcMap_() {
  var m = {};
  m[CC.CONTACT] = PC.CONTACT;  // 3 → 7
  m[CC.PHONE]   = PC.PHONE;    // 4 → 10
  m[CC.EMAIL]   = PC.EMAIL;    // 5 → 11
  return m;
}

function _findProspectRowByCompany_(companyName) {
  if (!companyName) return null;
  var sheet = getProspectSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var companies = sheet.getRange(2, PC.COMPANY, lastRow - 1, 1).getValues();
  var name = companyName.trim();
  for (var i = 0; i < companies.length; i++) {
    if (String(companies[i][0] || '').trim() === name) return i + 2;
  }
  return null;
}

function _syncFieldToProspect_(companyName, pcCol, value) {
  var rowIndex = _findProspectRowByCompany_(companyName);
  if (!rowIndex) return;
  getProspectSheet_().getRange(rowIndex, pcCol).setValue(value);
}

// 顧客管理の全レコードを営業リストに一括同期（手動実行 or 初回移行用）
function syncAllCustomersToProspects() {
  var res = getCustomers();
  var customers = Array.isArray(res) ? res : (res.items || []);
  var synced = 0, added = 0;
  customers.forEach(function(c) {
    try {
      var rowIndex = _findProspectRowByCompany_(c.company);
      var sheet = getProspectSheet_();
      if (rowIndex) {
        sheet.getRange(rowIndex, PC.STAGE).setValue('受注');
        if (c.contact) sheet.getRange(rowIndex, PC.CONTACT).setValue(c.contact);
        if (c.phone)   sheet.getRange(rowIndex, PC.PHONE).setValue(c.phone);
        if (c.email)   sheet.getRange(rowIndex, PC.EMAIL).setValue(c.email);
        synced++;
      } else {
        var newRow = new Array(20).fill('');
        newRow[PC.COMPANY  - 1] = c.company;
        newRow[PC.STAGE    - 1] = '受注';
        newRow[PC.CONTACT  - 1] = c.contact  || '';
        newRow[PC.PHONE    - 1] = c.phone    || '';
        newRow[PC.EMAIL    - 1] = c.email    || '';
        newRow[PC.SOURCE   - 1] = '顧客管理から追加';
        sheet.appendRow(newRow);
        added++;
      }
    } catch(e) { Logger.log('sync error for ' + c.company + ': ' + e); }
  });
  return { ok: true, synced: synced, added: added };
}

function _syncCustomerToProspectOnAdd_(data) {
  var companyName = String(data.company || '').trim();
  if (!companyName) return;
  var rowIndex = _findProspectRowByCompany_(companyName);
  var sheet = getProspectSheet_();
  if (rowIndex) {
    // 既存の見込み客 → ステージを受注に更新して連絡先を同期
    sheet.getRange(rowIndex, PC.STAGE).setValue('受注');
    if (data.contact) sheet.getRange(rowIndex, PC.CONTACT).setValue(data.contact);
    if (data.phone)   sheet.getRange(rowIndex, PC.PHONE).setValue(data.phone);
    if (data.email)   sheet.getRange(rowIndex, PC.EMAIL).setValue(data.email);
  } else {
    // リストに存在しない → 新規行を追加（ステージ＝受注）
    var newRow = new Array(20).fill('');
    newRow[PC.COMPANY  - 1] = companyName;
    newRow[PC.STAGE    - 1] = '受注';
    newRow[PC.CONTACT  - 1] = data.contact  || '';
    newRow[PC.PHONE    - 1] = data.phone    || '';
    newRow[PC.EMAIL    - 1] = data.email    || '';
    newRow[PC.SOURCE   - 1] = '顧客管理から追加';
    sheet.appendRow(newRow);
  }
}
