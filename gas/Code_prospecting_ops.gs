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

  var data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
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

function deleteProspect(rowIndex) {
  var sheet = getProspectSheet_();
  if (!sheet || !rowIndex || rowIndex < 2) return { error: '無効な行番号' };
  sheet.deleteRow(rowIndex);
  return { ok: true };
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

  var data   = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 21)).getValues();
  var filled = 0;

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

