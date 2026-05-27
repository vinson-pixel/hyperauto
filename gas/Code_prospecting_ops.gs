// ─── 架電記録 ────────────────────────────────────────────────────

function logCallResult(rowIndex, result, notes, uuid, company, caller) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(e) { return { error: '同時書き込み競合 — 少し待って再試行してください' }; }

  try {
    var sheet = getProspectSheet_();
    if (!sheet) return { error: 'シートエラー' };

    // rowIndexの整合性を確認（削除・移動があっても正しい行を特定）
    var safeRow = findVerifiedRow_(rowIndex, uuid, company);

    return _logCallResultInner_(sheet, safeRow, result, notes, caller);
  } finally {
    lock.releaseLock();
  }
}

function _logCallResultInner_(sheet, rowIndex, result, notes, caller) {
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
  if (result === '折り返し依頼') sheet.getRange(rowIndex, PC.STAGE).setValue('再架電待ち');
  if (result === '要再架電')   sheet.getRange(rowIndex, PC.STAGE).setValue('再架電待ち');
  if (result === '廃業')       sheet.getRange(rowIndex, PC.STAGE).setValue('廃業');
  if (result === '担当者変更') sheet.getRange(rowIndex, PC.STAGE).setValue('再架電待ち');
  if (result === '留守電')     sheet.getRange(rowIndex, PC.STAGE).setValue('再架電待ち');

  // 受注確定 → 顧客管理シートに自動転記
  if (result === '受注') {
    try {
      var cols_ = Math.max(sheet.getLastColumn(), 22);
      var rowData_ = sheet.getRange(rowIndex, 1, 1, cols_).getValues()[0];
      var today_ = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
      addCustomer({
        company:     String(rowData_[PC.COMPANY - 1] || '').trim(),
        wonDate:     today_,
        contact:     String(rowData_[PC.CONTACT - 1] || ''),
        phone:       String(rowData_[PC.PHONE - 1] || rowData_[PC.DIRECT_PHONE - 1] || ''),
        email:       String(rowData_[PC.EMAIL - 1] || ''),
        lastContact: today_,
        address:     String(rowData_[PC.PREF - 1] || ''),
        memo:        '【受注自動転記】' + (notes ? '\n' + notes : ''),
      });
    } catch(ePromote) { Logger.log('受注自動転記失敗: ' + ePromote); }
  }

  // メモに追記
  var cur_memo = String(sheet.getRange(rowIndex, PC.MEMO).getValue() || '');
  var entry    = today + '【' + result + '】' + (notes ? ' ' + notes : '');
  sheet.getRange(rowIndex, PC.MEMO).setValue(cur_memo ? cur_memo + '\n' + entry : entry);

  // call_logs シートにも記録（構造化データ）
  var company = String(sheet.getRange(rowIndex, PC.COMPANY).getValue() || '');
  var personMatch = notes ? notes.match(/^\[([^\]]+)\]/) : null;
  var person = personMatch ? personMatch[1] : '';
  appendCallLog_(rowIndex, company, result, person, notes, cur + 1, caller || '');

  return { success: true, callCount: cur + 1 };
} // end _logCallResultInner_

// ─── シート整理 ─────────────────────────────────────────────────

function cleanProspectSheet() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { deleted: 0, message: '対象なし' };

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var seen = {};
  var toDelete = [];

  for (var i = data.length - 1; i >= 0; i--) {
    var company = String(data[i][PC.COMPANY - 1] || '').trim();
    if (!company) {
      toDelete.push(i + 2);
    } else {
      var norm = normalizeCompanyName_(company);
      if (seen[norm]) {
        toDelete.push(i + 2);
      } else {
        seen[norm] = true;
      }
    }
  }
  toDelete.sort(function(a,b){return b-a;});
  toDelete.forEach(function(r){ sheet.deleteRow(r); });

  // 架電回数列のフォーマットを数値に修正
  var newLast = sheet.getLastRow();
  if (newLast > 1) sheet.getRange(2, PC.CALL_COUNT, newLast - 1, 1).setNumberFormat('0');

  return { deleted: toDelete.length, message: toDelete.length + '行削除しました' };
}

function deleteProspect(rowIndex) {
  var sheet = getProspectSheet_();
  if (!sheet || !rowIndex || rowIndex < 2) return { error: '無効な行番号' };
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function deleteUntouchedProspects() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { deleted: 0 };

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var toDelete = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var stage = String(data[i][PC.STAGE - 1] || '').trim();
    var callCount = parseInt(data[i][PC.CALL_COUNT - 1] || 0);
    if (stage === '未架電' && callCount === 0) {
      toDelete.push(i + 2);
    }
  }
  toDelete.sort(function(a, b) { return b - a; });
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  return { deleted: toDelete.length };
}

// 90日以上音沙汰なしの会社のステージを「再アプローチ可」に自動リセット
function resetStalledProspects(daysThreshold) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { reset: 0 };

  var days = parseInt(daysThreshold) || 90;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 22)).getValues();
  var reset = 0;
  var STALE_STAGES = ['未架電','架電済','再架電待ち','保留'];

  data.forEach(function(row, idx) {
    var stage     = String(row[PC.STAGE    - 1] || '').trim();
    var callDate  = row[PC.CALL_DATE - 1];
    var company   = String(row[PC.COMPANY  - 1] || '').trim();
    if (!company) return;
    if (STALE_STAGES.indexOf(stage) < 0) return;

    var lastCall = callDate ? new Date(String(callDate).replace(/\//g,'-')) : null;
    if (!lastCall || isNaN(lastCall) || lastCall > cutoff) return;

    sheet.getRange(idx + 2, PC.STAGE).setValue('再アプローチ可');
    reset++;
  });

  return { reset: reset, message: reset + '社を「再アプローチ可」にリセットしました（'+days+'日以上未接触）' };
}

// 90日以上前に失注した会社をシートから削除（アーカイブ）
function autoArchiveOldNg(daysThreshold) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { archived: 0 };

  var days = parseInt(daysThreshold) || 90;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 22)).getValues();
  var toDelete = [];

  for (var i = data.length - 1; i >= 0; i--) {
    var stage    = String(data[i][PC.STAGE    - 1] || '').trim();
    var callDate = data[i][PC.CALL_DATE - 1];
    if (stage !== '失注') continue;
    var lastCall = callDate ? new Date(String(callDate).replace(/\//g,'-')) : null;
    if (!lastCall || isNaN(lastCall) || lastCall > cutoff) continue;
    toDelete.push(i + 2);
  }

  toDelete.sort(function(a,b){ return b - a; });
  toDelete.forEach(function(r){ sheet.deleteRow(r); });
  return { archived: toDelete.length, message: toDelete.length + '社の古い失注データを削除しました' };
}

function deleteNgProspects() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { deleted: 0 };

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var toDelete = [];
  for (var i = data.length - 1; i >= 0; i--) {
    var stage = String(data[i][PC.STAGE - 1] || '').trim();
    if (stage === '失注') {
      toDelete.push(i + 2);
    }
  }
  toDelete.sort(function(a, b) { return b - a; });
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  return { deleted: toDelete.length };
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

// startRow=シート行番号（2始まり）, chunkSize=処理件数 (省略時は全件)
function fillMissingIndustry(startRow, chunkSize) {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートが見つかりません' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { filled: 0, done: true, message: 'データなし' };

  var start = parseInt(startRow) || 2;
  var chunk = parseInt(chunkSize) || (lastRow - start + 1); // 省略時は全件
  var end   = Math.min(start + chunk - 1, lastRow);
  if (start > lastRow) return { filled: 0, done: true, message: '処理完了' };

  var cols = Math.max(sheet.getLastColumn(), 21);
  var data = sheet.getRange(start, 1, end - start + 1, cols).getValues();
  var filled = 0;
  var badChk = /申し訳|判断|以下の|\*\*|URL|提供いただ|ありません|できません|わかりません/;

  data.forEach(function(row, idx) {
    var company  = String(row[PC.COMPANY  - 1] || '').trim();
    var industry = String(row[PC.INDUSTRY - 1] || '').trim();
    var url      = String(row[PC.URL      - 1] || '').trim();
    if (!company || industry) return;

    var guess = callClaude(
      '会社名・URLから業種を推定します。',
      '以下の会社の業種を10文字以内で答えてください。（例：設計事務所、内装施工会社、IT企業）\n会社名: ' + company + '\nURL: ' + url + '\n\n業種のみ出力:',
      'claude-haiku-4-5-20251001', 50
    );
    var guessClean = guess ? guess.trim().slice(0, 20) : '';
    if (guessClean && !badChk.test(guessClean)) {
      sheet.getRange(start + idx, PC.INDUSTRY).setValue(guessClean);
      filled++;
      Utilities.sleep(300);
    }
  });

  var nextStart = end + 1;
  var done      = nextStart > lastRow;
  return { filled: filled, done: done, nextStartRow: nextStart, remaining: done ? 0 : lastRow - nextStart + 1, message: filled + '社の業種を補完しました' };
}

// 業種フィールドの長文汚染を修正（>20文字 or AI説明文パターン）
function cleanIndustryField() {
  var sheet = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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
        'claude-haiku-4-5-20251001', 50
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

// ─── アポキャンセル ───────────────────────────────────────────────
function cancelApo(rowIndex, uuid, company) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch(e) { return { error: '競合 — 少し待って再試行してください' }; }
  try {
    var sheet = getProspectSheet_();
    if (!sheet) return { error: 'シートエラー' };
    var safeRow = findVerifiedRow_(rowIndex, uuid, company);
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
    sheet.getRange(safeRow, PC.STAGE).setValue('追い中');
    sheet.getRange(safeRow, PC.APO).setValue('');
    var cur_memo = String(sheet.getRange(safeRow, PC.MEMO).getValue() || '');
    var entry = today + '【アポキャンセル】';
    sheet.getRange(safeRow, PC.MEMO).setValue(cur_memo ? cur_memo + '\n' + entry : entry);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

