function buildPartnerEmailBody_(company, job) {
  return '突然のご連絡失礼いたします。\n'
    + '株式会社マルケン電工（愛知県名古屋市）と申します。\n\n'
    + 'このたび、東京の元請け会社様からのご依頼を受け、\n'
    + job.location + 'における定期案件の協力業者様を探しております。\n\n'
    + '【案件概要】\n'
    + '・内容：貨物船（車両運搬船）船内照明交換工事\n'
    + '・場所：' + job.location + '\n'
    + '・頻度：' + job.freq + '\n'
    + '・工期：' + job.duration + '\n'
    + '・規模：' + job.scale + '\n'
    + '・条件：' + job.note + '\n\n'
    + '長期・定期の案件ですので、継続的にご協力いただける\n'
    + '会社様と関係を築きたいと考えております。\n\n'
    + 'ご興味をお持ちの場合は、詳細をご説明いたします。\n'
    + 'まずはお気軽にご返信ください。\n\n'
    + '何卒よろしくお願いいたします。';
}

// 対象: リスト種別=協力会社 かつ メールアドレスあり かつ ステージ=未架電
// asDraft=true で下書き保存、false で実際に送信（デフォルトは下書き）
function sendPartnerSearchBatch(asDraft) {
  if (asDraft === undefined) asDraft = true;

  var sheet   = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { error: 'データなし' };

  var cols = Math.max(sheet.getLastColumn(), 18);
  var data  = sheet.getRange(2, 1, lastRow - 1, cols).getValues();

  var drafted = 0, skipped = 0, errors = [];

  data.forEach(function(row, idx) {
    var company  = String(row[PC.COMPANY   - 1] || '').trim();
    var email    = String(row[PC.EMAIL     - 1] || '').trim();
    var stage    = String(row[PC.STAGE     - 1] || '').trim();
    var listType = String(row[PC.LIST_TYPE - 1] || '').trim();

    if (!company || !email || listType !== '協力会社' || stage !== '未架電') {
      skipped++;
      return;
    }

    try {
      var subject = '【協力業者募集】広島・飯野島 定期案件のご案内';
      var body    = buildPartnerEmailBody_(company, PARTNER_JOB_IINOSHIMA);

      if (asDraft) {
        GmailApp.createDraft(email, subject, body + MARUKEN_SIGNATURE, { name: '株式会社マルケン電工' });
      } else {
        GmailApp.sendEmail(email, subject, body + MARUKEN_SIGNATURE, { name: '株式会社マルケン電工' });
      }

      // ステージをアプローチ中に更新
      sheet.getRange(idx + 2, PC.STAGE).setValue('アプローチ中');
      var memo = String(row[PC.MEMO - 1] || '');
      var now  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
      sheet.getRange(idx + 2, PC.MEMO).setValue(
        (memo ? memo + '\n' : '') + now + ' 協力会社メール' + (asDraft ? '下書き' : '送信')
      );

      drafted++;
      Utilities.sleep(300);
    } catch(e) {
      errors.push(company + ': ' + e.toString().substring(0, 60));
    }
  });

  return {
    drafted:  drafted,
    skipped:  skipped,
    errors:   errors,
    mode:     asDraft ? '下書き' : '送信',
    message:  (asDraft ? 'Gmail下書きを' : 'メールを') + drafted + '件作成しました（スキップ: ' + skipped + '件）',
  };
}

// 対象件数だけ返す（送信前確認用）
function getPartnerSearchCount() {
  var sheet   = getProspectSheet_();
  if (!sheet) return { count: 0 };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { count: 0, withEmail: 0 };

  var cols = Math.max(sheet.getLastColumn(), 18);
  var data  = sheet.getRange(2, 1, lastRow - 1, cols).getValues();

  var total = 0, withEmail = 0;
  data.forEach(function(row) {
    var listType = String(row[PC.LIST_TYPE - 1] || '').trim();
    var stage    = String(row[PC.STAGE     - 1] || '').trim();
    if (listType !== '協力会社' || stage !== '未架電') return;
    total++;
    if (String(row[PC.EMAIL - 1] || '').trim()) withEmail++;
  });

  return { total: total, withEmail: withEmail, message: '協力会社リスト: ' + total + '社（メールあり: ' + withEmail + '社）' };
}


// ─── S-03: 名刺→prospecting汎用登録 ─────────────────────────────────
// J-01のAIパイプラインを流用し、JECA以外のイベント・商談でも使える
// 書き込み先: prospectingシート（PROSPECT_SS_ID）
// CardForm.html から ?event=イベント名 で呼び出す

var RANK_TO_STAGE = { 'A': 'アポ確定', 'B': 'アプローチ中', 'C': '未架電' };

// カテゴリ → listType マッピング
var CATEGORY_TO_LIST_TYPE = {
  '元請け候補': '営業',
  '下請け候補': '協力会社',
  'その他':     '営業',
};

function registerCardToProspecting(rawCardText, meetingMemo, source, category, base64Data, mimeType) {
  try {
    // Step 1: 名刺情報取得（J-01パイプライン流用）
    var cardInfo;
    if (base64Data && base64Data !== '__IMAGE__') {
      cardInfo = j01_cardImageParser(base64Data, mimeType || 'image/jpeg');
    } else {
      cardInfo = j01_cardParser(rawCardText || '');
    }

    // Step 2: 業界・決裁権分類
    var industryInfo = j01_industryClassifier(cardInfo.company, cardInfo.title);

    // Step 3: ニーズ推定
    var needs = j01_needsEstimator({
      company:        cardInfo.company,
      title:          cardInfo.title,
      industry:       industryInfo.industry,
      industryDetail: industryInfo.industryDetail,
      companySize:    industryInfo.companySize,
    });

    // Step 4: スコアリング
    var scoring = j01_leadScorer(cardInfo, industryInfo, needs);
    var stage    = RANK_TO_STAGE[scoring.rank] || '未架電';
    var listType = CATEGORY_TO_LIST_TYPE[category] || '営業';

    // Step 5: prospectingシートに書き込み（重複チェック付き）
    var sheet   = getProspectSheet_();
    if (!sheet) return { success: false, error: 'シートエラー' };

    var lastRow = sheet.getLastRow();
    var existingNorm = {};
    if (lastRow > 1) {
      var existingData = sheet.getRange(2, PC.COMPANY, lastRow - 1, 1).getValues();
      existingData.forEach(function(r) {
        existingNorm[normalizeCompanyName_(String(r[0] || ''))] = true;
      });
    }

    var nm = normalizeCompanyName_(cardInfo.company || '');
    if (nm && existingNorm[nm]) {
      return { success: false, duplicate: true, company: cardInfo.company, message: '既にリストに存在します' };
    }

    var needsText = [needs.primaryNeed].concat(needs.secondaryNeeds || []).filter(Boolean).join(' / ');
    var memo = [meetingMemo, needsText, cardInfo.address].filter(function(s){ return s && s.trim(); }).join('\n');

    var row = new Array(18).fill('');
    row[PC.COMPANY    - 1] = cardInfo.company || '';
    row[PC.CONTACT    - 1] = cardInfo.name    || '';
    row[PC.PHONE      - 1] = cardInfo.phone   || '';
    row[PC.EMAIL      - 1] = cardInfo.email   || '';
    row[PC.PREF       - 1] = extractPref_(cardInfo.address || '');
    row[PC.SOURCE     - 1] = source   || '名刺';
    row[PC.STAGE      - 1] = stage;
    row[PC.CALL_COUNT - 1] = 0;
    row[PC.MEMO       - 1] = memo;
    row[PC.LIST_TYPE  - 1] = listType;

    sheet.appendRow(row);

    return {
      success:     true,
      company:     cardInfo.company,
      name:        cardInfo.name,
      rank:        scoring.rank,
      score:       scoring.score,
      stage:       stage,
      listType:    listType,
      primaryNeed: needs.primaryNeed,
    };
  } catch(e) {
    agentLog('S-03', 'ERROR', e.toString());
    return { success: false, error: e.toString() };
  }
}


// ─── S-04: フォローアップメール自動送信 ──────────────────────────────
// 毎朝8時のタイマートリガーで自動実行
// デフォルト: Gmail下書き作成（asDraft=true）
// 1回30社上限でGAS実行時間制限対策

var FOLLOWUP_TRIGGER_KEY  = 'FOLLOWUP_TRIGGER_ID';
var FOLLOWUP_BATCH_LIMIT  = 30;

// ステージ別フォローアップルール
var FOLLOWUP_RULES = [
  // 未架電 + メールあり + 架電0回 → 初回メール
  { stage: '未架電',      minDays: 0, maxCalls: 0, templateId: 'first',      label: '初回' },
  // アプローチ中 + 7日以上放置 → フォロー
  { stage: 'アプローチ中', minDays: 7, maxCalls: 99, templateId: 'followup',   label: 'フォロー' },
  // アポ確定 + 未送信 → 日程確認
  { stage: 'アポ確定',    minDays: 0, maxCalls: 99, templateId: 'appointment', label: 'アポ確認' },
];

// メイン: 毎朝8時のトリガーから呼ばれる（またはUI手動実行）
function autoFollowUpBatch(asDraft) {
  if (asDraft === undefined) asDraft = true;

  var sheet   = getProspectSheet_();
  if (!sheet) return { error: 'シートエラー' };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { processed: 0, message: 'データなし' };

  var cols = Math.max(sheet.getLastColumn(), 18);
  var data  = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var targets = [];

  data.forEach(function(row, idx) {
    var company  = String(row[PC.COMPANY   - 1] || '').trim();
    var email    = String(row[PC.EMAIL     - 1] || '').trim();
    var stage    = String(row[PC.STAGE     - 1] || '').trim();
    var callDate = row[PC.CALL_DATE - 1];
    var callCount= parseInt(row[PC.CALL_COUNT - 1] || 0);
    var memo     = String(row[PC.MEMO      - 1] || '');
    var listType = String(row[PC.LIST_TYPE - 1] || '営業').trim();

    // メールなし・協力会社（別フローで管理）はスキップ
    if (!company || !email || listType === '協力会社') return;

    // 直近7日以内にメール送信済みならスキップ（連投防止）
    if (memo.indexOf('メール送信') !== -1 || memo.indexOf('下書き作成') !== -1) {
      var lastEmailMatch = memo.match(/(\d{4}\/\d{2}\/\d{2}).*?(?:メール送信|下書き作成)/g);
      if (lastEmailMatch) {
        var lastDateStr = lastEmailMatch[lastEmailMatch.length - 1].match(/\d{4}\/\d{2}\/\d{2}/)[0];
        var lastDate    = new Date(lastDateStr.replace(/\//g, '-'));
        if ((today - lastDate) / 86400000 < 7) return;
      }
    }

    // 最終連絡日からの経過日数
    var daysSince = 0;
    if (callDate instanceof Date && !isNaN(callDate)) {
      daysSince = Math.floor((today - callDate) / 86400000);
    }

    // ルール照合
    for (var i = 0; i < FOLLOWUP_RULES.length; i++) {
      var rule = FOLLOWUP_RULES[i];
      if (stage === rule.stage && callCount <= rule.maxCalls && daysSince >= rule.minDays) {
        targets.push({ rowIndex: idx + 2, company: company, email: email, stage: stage, templateId: rule.templateId, label: rule.label });
        break;
      }
    }
  });

  if (targets.length === 0) return { processed: 0, drafted: 0, message: '送信対象なし' };

  // 上限30社
  var batch   = targets.slice(0, FOLLOWUP_BATCH_LIMIT);
  var drafted = 0, errors = [];

  batch.forEach(function(t) {
    try {
      var result = generatePersonalizedEmail(t.rowIndex, t.templateId, '');
      if (result.error || !result.to) { errors.push(t.company + ': ' + (result.error || 'メールアドレスなし')); return; }

      if (asDraft) {
        GmailApp.createDraft(result.to, result.subject, result.body, { name: '株式会社マルケン電工', replyTo: 'info@marukendenkou.com' });
      } else {
        GmailApp.sendEmail(result.to, result.subject, result.body, { name: '株式会社マルケン電工', replyTo: 'info@marukendenkou.com' });
      }

      // メモに記録・最終連絡日更新
      var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
      var label = asDraft ? '下書き作成' : 'メール送信';
      var cur = String(sheet.getRange(t.rowIndex, PC.MEMO).getValue() || '');
      sheet.getRange(t.rowIndex, PC.MEMO).setValue((cur ? cur + '\n' : '') + now + ' ' + t.label + label);
      sheet.getRange(t.rowIndex, PC.CALL_DATE).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd'));

      drafted++;
      Utilities.sleep(300);
    } catch(e) {
      errors.push(t.company + ': ' + e.toString().substring(0, 60));
    }
  });

  var mode = asDraft ? 'Gmail下書き' : 'メール送信';
  var msg  = mode + ' ' + drafted + '件完了（対象' + targets.length + '社 / 上限' + FOLLOWUP_BATCH_LIMIT + '社）';
  if (errors.length) msg += ' / エラー' + errors.length + '件';

  // LINE通知（トリガー自動実行時のみ）
  if (drafted > 0) {
    sendLineToManager('📧 フォローアップ' + mode + '\n' + drafted + '件作成しました\n\n' + batch.slice(0, 5).map(function(t){ return '・' + t.company; }).join('\n') + (batch.length > 5 ? '\n…他' + (batch.length - 5) + '社' : ''));
  }

  return { processed: batch.length, drafted: drafted, errors: errors, remaining: Math.max(0, targets.length - batch.length), message: msg };
}

// 対象件数プレビュー（送信前確認用）
function getFollowUpTargetCount() {
  var sheet   = getProspectSheet_();
  if (!sheet) return { counts: {} };
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { counts: {}, total: 0 };

  var cols = Math.max(sheet.getLastColumn(), 18);
  var data  = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var counts = { '初回': 0, 'フォロー': 0, 'アポ確認': 0 };

  data.forEach(function(row) {
    var email    = String(row[PC.EMAIL     - 1] || '').trim();
    var stage    = String(row[PC.STAGE     - 1] || '').trim();
    var callCount= parseInt(row[PC.CALL_COUNT - 1] || 0);
    var callDate = row[PC.CALL_DATE - 1];
    var listType = String(row[PC.LIST_TYPE - 1] || '営業').trim();
    if (!email || listType === '協力会社') return;

    var daysSince = 0;
    if (callDate instanceof Date && !isNaN(callDate)) {
      daysSince = Math.floor((today - callDate) / 86400000);
    }

    for (var i = 0; i < FOLLOWUP_RULES.length; i++) {
      var rule = FOLLOWUP_RULES[i];
      if (stage === rule.stage && callCount <= rule.maxCalls && daysSince >= rule.minDays) {
        counts[rule.label]++;
        break;
      }
    }
  });

  var total = counts['初回'] + counts['フォロー'] + counts['アポ確認'];
  return { counts: counts, total: total, message: '送信対象: 計' + total + '社（初回' + counts['初回'] + '・フォロー' + counts['フォロー'] + '・アポ確認' + counts['アポ確認'] + '）' };
}

// ── トリガー管理 ──────────────────────────────────────────────────────

function setupFollowUpTrigger() {
  // 既存トリガーを削除してから再作成
  deleteFollowUpTrigger();
  var trigger = ScriptApp.newTrigger('autoFollowUpBatch')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  PropertiesService.getScriptProperties().setProperty(FOLLOWUP_TRIGGER_KEY, trigger.getUniqueId());
  return { success: true, message: '毎朝8時の自動フォローアップを設定しました（下書きモード）' };
}

function deleteFollowUpTrigger() {
  var triggerId = getProp(FOLLOWUP_TRIGGER_KEY);
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'autoFollowUpBatch' || t.getUniqueId() === triggerId) {
      ScriptApp.deleteTrigger(t);
    }
  });
  PropertiesService.getScriptProperties().deleteProperty(FOLLOWUP_TRIGGER_KEY);
  return { success: true, message: '自動フォローアップトリガーを削除しました' };
}

function getFollowUpTriggerStatus() {
  var active = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === 'autoFollowUpBatch';
  });
  return { active: active, message: active ? '✅ 毎朝8時 自動実行中' : '⏸ 停止中' };
}
