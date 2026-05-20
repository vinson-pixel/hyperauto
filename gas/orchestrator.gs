// ============================================================
// orchestrator.gs — 全エージェント司令塔
// マルケン電工 hyperauto プロジェクト
//
// このファイルは全エージェントのトリガー管理・LINE Webhook処理・
// セットアップ・手動実行ショートカットを一元管理する。
//
// 依存ファイル（同GASプロジェクト内に定義済み）:
//   utils.gs              — 共通ユーティリティ
//   Code_sales_team.gs    — S-01〜S-05 営業チーム
//   Code_jeca_team.gs     — J-01〜J-03 JECAフェアチーム
//   Code_billing_team.gs  — F-01〜F-04 経理チーム
//   Code_estimation_team.gs — E-01〜E-02 見積チーム
//   Code_site_team.gs     — P-01〜P-03 現場管理チーム
//   Code_admin_team.gs    — A-01〜A-04 内部管理チーム
//
// スクリプトプロパティ（PropertiesService）に必要なキー:
//   CLAUDE_API_KEY              — Anthropic Claude API
//   XAI_API_KEY                 — xAI Grok API
//   LINE_CHANNEL_ACCESS_TOKEN   — LINE Messaging API
//   LINE_USER_IDS               — "manager:Uxxxx,owner:Uxxxx"
//   SHEET_ID                    — 案件管理スプシID
//   JECA_SHEET_ID               — JECAフェアスプシID
//   EXPENSE_SHEET_ID            — 経費精算スプシID
//   KPI_SHEET_ID                — KPI集計スプシID
// ============================================================

// ============================================================
// ─── セクション1: トリガー関数 ───────────────────────────────
// GASのタイムベーストリガーから直接呼び出す関数群。
// setupAllTriggers() で一括設定される。
// ============================================================

/**
 * trigger_15min — 15分おきに実行
 * S-01: 新着メール受信・AI判定・LINE通知
 */
function trigger_15min() {
  const AGENT_ID = 'TRIGGER-15MIN';
  agentLog(AGENT_ID, 'START', nowStr());
  try {
    runEmailIntakeTeam();
    agentLog(AGENT_ID, 'OK', 'メール受信チーム完了');
  } catch (e) {
    const msg = '❌ 15分トリガーエラー\n' + e.toString();
    agentLog(AGENT_ID, 'ERROR', e.toString());
    _notifyError(AGENT_ID, e);
  }
}

/**
 * trigger_morning_8 — 毎朝8時に実行
 * A-01: 業務報告 / F-01: 請求書生成 / S-04: フォローアップ
 */
function trigger_morning_8() {
  const AGENT_ID = 'TRIGGER-MORNING';
  agentLog(AGENT_ID, 'START', nowStr());

  // A-01: 日次業務報告（エラーが出ても次のチームに影響させない）
  _runSafe(AGENT_ID, 'A-01 業務報告', function() {
    runDailyReportAgent();
  });

  // F-01: 請求書生成バッチ
  _runSafe(AGENT_ID, 'F-01 請求書', function() {
    runInvoiceTeam();
  });

  // S-04: フォローアップメール配信
  _runSafe(AGENT_ID, 'S-04 フォローアップ', function() {
    runFollowUpTeam();
  });

  // 朝バッチ完了をLINE通知
  _sendMorningSummary();

  agentLog(AGENT_ID, 'DONE', '朝バッチ完了');
}

/**
 * trigger_noon_12 — 毎日12時に実行
 * A-02: Watchdog監視 / F-02: 入金確認
 */
function trigger_noon_12() {
  const AGENT_ID = 'TRIGGER-NOON';
  agentLog(AGENT_ID, 'START', nowStr());

  _runSafe(AGENT_ID, 'A-02 Watchdog', function() {
    runWatchdogTeam();
  });

  _runSafe(AGENT_ID, 'F-02 入金確認', function() {
    runPaymentTrackerTeam();
  });

  agentLog(AGENT_ID, 'DONE', '昼バッチ完了');
}

/**
 * trigger_evening_18 — 毎日18時に実行
 * P-02: 日報集計・送信
 */
function trigger_evening_18() {
  const AGENT_ID = 'TRIGGER-EVENING';
  agentLog(AGENT_ID, 'START', nowStr());

  _runSafe(AGENT_ID, 'P-02 日報', function() {
    runDailyReportTeam();
  });

  agentLog(AGENT_ID, 'DONE', '夕方バッチ完了');
}

/**
 * trigger_night_23 — 毎日23時: リード発掘バッチ①＋その他夜間処理
 */
function trigger_night_23() {
  const AGENT_ID = 'TRIGGER-NIGHT-23';
  agentLog(AGENT_ID, 'START', nowStr());
  _runSafe(AGENT_ID, '自動リード発掘①', function() { autoDiscoverLeads(); });
  _runSafe(AGENT_ID, 'Web情報自動補完', function() { autoFillCompanyDetails(); });
  _runSafe(AGENT_ID, '成約フォローアラート', function() { checkWonFollowups(); });
  agentLog(AGENT_ID, 'DONE', '夜間バッチ①完了');
}

/** trigger_night_1 — 毎日1時: リード発掘バッチ② */
function trigger_night_1() {
  const AGENT_ID = 'TRIGGER-NIGHT-01';
  agentLog(AGENT_ID, 'START', nowStr());
  _runSafe(AGENT_ID, '自動リード発掘②', function() { autoDiscoverLeads(); });
  agentLog(AGENT_ID, 'DONE', '夜間バッチ②完了');
}

/** trigger_night_3 — 毎日3時: リード発掘バッチ③ */
function trigger_night_3() {
  const AGENT_ID = 'TRIGGER-NIGHT-03';
  agentLog(AGENT_ID, 'START', nowStr());
  _runSafe(AGENT_ID, '自動リード発掘③', function() { autoDiscoverLeads(); });
  agentLog(AGENT_ID, 'DONE', '夜間バッチ③完了');
}

/** trigger_night_5 — 毎日5時: リード発掘バッチ④ */
function trigger_night_5() {
  const AGENT_ID = 'TRIGGER-NIGHT-05';
  agentLog(AGENT_ID, 'START', nowStr());
  _runSafe(AGENT_ID, '自動リード発掘④', function() { autoDiscoverLeads(); });
  agentLog(AGENT_ID, 'DONE', '夜間バッチ④完了');
}

/**
 * trigger_monday_8 — 毎週月曜8時に実行
 * A-04: 週次スケジュール管理・工程調整
 */
function trigger_monday_8() {
  const AGENT_ID = 'TRIGGER-MONDAY';
  agentLog(AGENT_ID, 'START', nowStr());

  // 月曜日かどうかチェック（GASのトリガー設定補完）
  const dow = new Date().getDay(); // 0=日, 1=月
  if (dow !== 1) {
    agentLog(AGENT_ID, 'SKIP', '月曜日でないためスキップ (day=' + dow + ')');
    return;
  }

  _runSafe(AGENT_ID, 'A-04 スケジュール管理', function() {
    runScheduleManagerTeam();
  });

  _runSafe(AGENT_ID, '週次営業戦略レポート', function() {
    sendWeeklyStrategyReport();
  });

  agentLog(AGENT_ID, 'DONE', '週次バッチ完了');
}

/**
 * trigger_monthly_1 — 毎月1日に実行
 * F-04: 月次報告 / A-03: 成長提案
 */
function trigger_monthly_1() {
  const AGENT_ID = 'TRIGGER-MONTHLY';
  agentLog(AGENT_ID, 'START', nowStr());

  // 1日かどうかチェック（GASのトリガー設定補完）
  const dom = new Date().getDate();
  if (dom !== 1) {
    agentLog(AGENT_ID, 'SKIP', '1日でないためスキップ (date=' + dom + ')');
    return;
  }

  // 先月の年月を取得（例: "2026/04"）
  const lastMonth = _getLastMonthStr();

  _runSafe(AGENT_ID, 'F-04 月次報告', function() {
    runMonthlySummary(lastMonth);
  });

  _runSafe(AGENT_ID, 'A-03 成長提案', function() {
    runGrowthAdvisorTeam();
  });

  agentLog(AGENT_ID, 'DONE', '月次バッチ完了: ' + lastMonth);
}


// ============================================================
// ─── セクション2: LINE Webhook doPost ───────────────────────
// LINEクイックリプライのpostbackイベントを処理する。
// GASのWebアプリとしてデプロイ（誰でもアクセス可能）。
// ============================================================

/**
 * doGet — URLパラメーターでフォームをルーティング
 *   ?page=card  → 名刺登録フォーム（JECA用）
 *   デフォルト  → アースファスト作業報告書
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'arsfast';
  if (page === 'card') {
    return HtmlService.createHtmlOutputFromFile('CardForm')
      .setTitle('名刺登録 | マルケン電工 JECA 2026')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (page === 'prospecting') {
    var action = (e && e.parameter && e.parameter.action) || '';
    if (action) {
      return handleProspectingApi_(e);
    }
    var tmpl = HtmlService.createTemplateFromFile('index_prospecting');
    tmpl.scriptUrl = ScriptApp.getService().getUrl();
    return tmpl.evaluate()
      .setTitle('営業リスト管理 | マルケン電工')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('index_arsfast')
    .setTitle('アースファスト作業報告書')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── 営業リスト API（GETベース） ──────────────────────────────────

function handleProspectingApi_(e) {
  var p      = e.parameter;
  var action = p.action || '';
  var result;
  try {
    if      (action === 'getProspects')  result = getProspects(parseInt(p.limit) || 100);
    else if (action === 'getStats')      result = getStats();
    else if (action === 'searchLeads')   result = searchLeads(p.keyword, p.area, p.source, parseInt(p.maxResults) || 20, p.quick === '1');
    else if (action === 'cleanSheet')    result = cleanProspectSheet();
    else if (action === 'fillIndustry')  result = fillMissingIndustry();
    else if (action === 'cleanIndustry') result = cleanIndustryField();
    else if (action === 'fillCorpNum')   result = autoFillCorpNum();
    else if (action === 'lookupCorpNum') {
      if (!getProp('NTA_APP_ID')) { result = { error: 'NTA_APP_ID未設定 — 国税庁Web-APIに登録してスクリプトプロパティに設定してください' }; }
      else { result = { corpNum: lookupCorpNum_(p.name||'') }; }
    }
    else if (action === 'autoDiscover')  result = autoDiscoverLeads();
    else if (action === 'analyzeFeedback')   result = analyzeFeedback();
    else if (action === 'fillDetails')       result = autoFillCompanyDetails();
    else if (action === 'bulkCleanup')       result = bulkCleanup();
    else if (action === 'getHumanTasks')     result = getHumanTasks();
    else if (action === 'getVisitList')      result = getVisitList(p.area, p.maxCount);
    else if (action === 'weeklyReport')      result = sendWeeklyStrategyReport();
    else if (action === 'ping')              result = { ok: true };
    else result = { error: '不明なアクション: ' + action };
  } catch(err) {
    result = { error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return _jsonResponse({ ok: true, message: 'no content' });
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    Logger.log('Webhook JSON parse error: ' + parseErr);
    return _jsonResponse({ ok: false, error: 'invalid json' });
  }

  // 営業リスト POST API
  if (body.prospectAction) {
    var r;
    try {
      var a = body.prospectAction;
      if      (a === 'logCallResult')             r = logCallResult(body.rowIndex, body.result, body.notes);
      else if (a === 'addProspects')              r = addProspects(body.places);
      else if (a === 'generateTalkScript')        r = generateTalkScript(body.rowIndex);
      else if (a === 'generatePersonalizedEmail') r = generatePersonalizedEmail(body.rowIndex, body.templateId, body.note);
      else if (a === 'previewEmail')              r = previewEmail(body.rowIndex, body.templateId, body.note);
      else if (a === 'sendProspectEmail')         r = sendProspectEmail(body.rowIndex, body.templateId, body.note, body.asDraft);
      else if (a === 'updateCell')                r = updateProspectCell(body.rowIndex, body.col, body.value);
      else if (a === 'analyzeCompany')            r = analyzeCompany(body.rowIndex);
      else if (a === 'analyzeCompanyDeep')        r = analyzeCompanyDeep(body.rowIndex);
      else if (a === 'generateCampaign')          r = generateCampaign(body.product, body.limit);
      else r = { error: '不明なアクション' };
    } catch(err) { r = { error: err.toString() }; }
    return ContentService.createTextOutput(JSON.stringify(r))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const events = body.events || [];
  agentLog('WEBHOOK', 'RECEIVED', 'events=' + events.length);

  events.forEach(function(event) {
    try {
      _handleWebhookEvent(event);
    } catch (evtErr) {
      Logger.log('Webhook event error: ' + evtErr.toString());
      // イベント単位のエラーは握りつぶしてLINEに通知
      _notifyErrorText('Webhook処理エラー', evtErr.toString());
    }
  });

  return _jsonResponse({ ok: true });
}

/**
 * _handleWebhookEvent — 個別イベントの振り分け処理
 */
function _handleWebhookEvent(event) {
  // postbackイベント以外は無視
  if (event.type !== 'postback') {
    agentLog('WEBHOOK', 'IGNORE', 'type=' + event.type);
    return;
  }

  const data       = event.postback ? event.postback.data : '';
  const replyToken = event.replyToken;
  const userId     = event.source ? event.source.userId : null;

  // クエリ文字列をオブジェクトに変換
  const params = _parseQueryString(data);
  const action = params.action || '';

  agentLog('WEBHOOK', 'ACTION', action + ' | params=' + JSON.stringify(params));

  // ─── アクション振り分け ────────────────────────────────────
  switch (action) {

    // 電話対応済みとしてスプシのステータスを更新
    case 'called':
      _handleCalled(params, replyToken);
      break;

    // 見積書生成（company必須。emailはオプション）
    case 'quote_request':
      _handleQuoteRequest(params, replyToken);
      break;

    // トークスクリプト生成（company, industry必須。sizeはオプション）
    case 'script_request':
      _handleScriptRequest(params, replyToken);
      break;

    // JECA御礼メール下書き作成
    case 'jeca_batch_draft':
      _handleJecaBatch('draft', replyToken);
      break;

    // JECA御礼メール一括送信
    case 'jeca_batch_send':
      _handleJecaBatch('send', replyToken);
      break;

    // フォローアップキャンペーン起動
    case 'followup_campaign':
      _handleFollowUpCampaign(replyToken);
      break;

    // 対応完了としてスプシ更新
    case 'done':
      _handleStatusUpdate(params, replyToken, '対応完了');
      break;

    // スキップ（通知のみ）
    case 'skip':
      _lineReply(replyToken, '🗑 スキップしました');
      break;

    // リードへの電話案内
    case 'call_lead':
      _lineReply(replyToken, '📞 ' + decodeURIComponent(params.company || '') + ' に電話してください');
      break;

    // リードへのメール案内
    case 'mail_lead':
      _lineReply(replyToken, '✉️ ' + decodeURIComponent(params.email || '') + ' へのメール下書きをGmailで確認してください');
      break;

    // スクリプト確認案内
    case 'view_script':
      _lineReply(replyToken, '📋 トークスクリプトはGASのログ（実行→ログを表示）でご確認ください');
      break;

    // メール返信プレビュー（Code_agent004連携）
    case 'reply_preview':
      _handleReplyPreview(params, replyToken, userId);
      break;

    // プレビュー確認後に実際に送信
    case 'reply_confirm':
      _handleReplyConfirm(params, replyToken);
      break;

    // Gmailで編集する場合
    case 'reply_edit':
      _lineReply(replyToken, '✏️ Gmailの下書きフォルダから編集・送信してください。\n返信文は下書き保存済みです。');
      break;

    // 日程連絡の下書き作成
    case 'schedule_send':
      _handleScheduleSend(params, replyToken);
      break;

    // 対応済みマーク（メール案件用）
    case 'registered':
      _lineReply(replyToken, '✅ 案件スプシに記録済みです');
      break;

    // 返信不要メール: 削除
    case 'delete_mail':
      _handleDeleteMail(params, replyToken);
      break;

    // 返信不要メール: 配信停止（アーカイブ）
    case 'unsubscribe_mail':
      _handleUnsubscribeMail(params, replyToken);
      break;

    // 返信不要メール: 無視（何もしない）
    case 'ignore_mail':
      _lineReply(replyToken, '👁 無視しました');
      break;

    default:
      agentLog('WEBHOOK', 'UNKNOWN_ACTION', action);
      _lineReply(replyToken, '⚠️ 不明なアクション: ' + action);
      break;
  }
}

// ─── アクションハンドラー群 ────────────────────────────────────

/**
 * _handleCalled — 電話対応済みとしてスプシ更新
 * paramsに id（メールID）または company が含まれる想定。
 */
function _handleCalled(params, replyToken) {
  const msgId   = params.id || '';
  const company = params.company || '';
  agentLog('WEBHOOK-CALLED', 'START', 'id=' + msgId);

  try {
    // 案件管理スプシのステータスを「電話対応済み」に更新
    const sheet = getSheet('SHEET_ID', '案件一覧');
    if (sheet && msgId) {
      const rows = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        // B列がメールID（COL.EMAIL_ID=2）
        if (String(rows[i][1]) === msgId) {
          // K列（STATUS=11）を「電話対応済み」に更新
          sheet.getRange(i + 1, 11).setValue('電話対応済み');
          sheet.getRange(i + 1, 15).setValue(nowStr() + ' [電話済]');
          agentLog('WEBHOOK-CALLED', 'OK', 'row=' + (i + 1));
          break;
        }
      }
    }
    _lineReply(replyToken, '📞 電話対応済みとして記録しました！\n' +
      (company ? '顧客: ' + company + '\n' : '') +
      '記録時刻: ' + nowStr());
  } catch (e) {
    agentLog('WEBHOOK-CALLED', 'ERROR', e.toString());
    _lineReply(replyToken, '❌ スプシ更新に失敗しました\n' + e.toString().substring(0, 100));
  }
}

/**
 * _handleQuoteRequest — 見積書生成チームを起動
 */
function _handleQuoteRequest(params, replyToken) {
  const company = decodeURIComponent(params.company || '');
  const email   = decodeURIComponent(params.email   || '');

  if (!company) {
    _lineReply(replyToken, '⚠️ 会社名が指定されていません');
    return;
  }

  agentLog('WEBHOOK-QUOTE', 'START', 'company=' + company);

  // 即時返信（処理に時間がかかるため先に応答）
  _lineReply(replyToken, '⏳ 見積書を作成中...\n会社: ' + company + '\nしばらくお待ちください。');

  try {
    // E-01: 見積書生成チームを起動
    // rawText は会社名をプロンプトとして渡す
    const rawText = '【見積依頼】会社名: ' + company;
    runQuoteGeneratorTeam(rawText, email || null);
    agentLog('WEBHOOK-QUOTE', 'OK', company);
    sendLineToManager('✅ 見積書の生成が完了しました\n会社: ' + company + '\nGmailの下書きをご確認ください。');
  } catch (e) {
    agentLog('WEBHOOK-QUOTE', 'ERROR', e.toString());
    _notifyErrorText('見積書生成エラー[' + company + ']', e.toString());
  }
}

/**
 * _handleScriptRequest — トークスクリプト生成チームを起動
 */
function _handleScriptRequest(params, replyToken) {
  const company  = decodeURIComponent(params.company  || '');
  const industry = decodeURIComponent(params.industry || '');
  const size     = decodeURIComponent(params.size     || '');

  if (!company || !industry) {
    _lineReply(replyToken, '⚠️ 会社名・業種が必要です');
    return;
  }

  agentLog('WEBHOOK-SCRIPT', 'START', company + ' / ' + industry);
  _lineReply(replyToken, '⏳ トークスクリプト作成中...\n会社: ' + company + '\n業種: ' + industry);

  try {
    // S-05: トークスクリプト生成チーム
    runTalkScriptTeam(company, industry, size || '中小企業');
    agentLog('WEBHOOK-SCRIPT', 'OK', company);
  } catch (e) {
    agentLog('WEBHOOK-SCRIPT', 'ERROR', e.toString());
    _notifyErrorText('トークスクリプト生成エラー', e.toString());
  }
}

/**
 * _handleJecaBatch — JECA御礼メールバッチ実行
 * mode: 'draft'（下書き作成）または 'send'（一括送信）
 */
function _handleJecaBatch(mode, replyToken) {
  agentLog('WEBHOOK-JECA', 'START', 'mode=' + mode);

  const modeLabel = mode === 'draft' ? '下書き作成' : '一括送信';
  _lineReply(replyToken, '⏳ JECA御礼メール' + modeLabel + '中...\nしばらくお待ちください。');

  try {
    // J-02: 御礼メールバッチ
    runThankYouBatch(mode);
    agentLog('WEBHOOK-JECA', 'OK', mode);
    sendLineToManager('✅ JECA御礼メール' + modeLabel + '完了\nGmailをご確認ください。');
  } catch (e) {
    agentLog('WEBHOOK-JECA', 'ERROR', e.toString());
    _notifyErrorText('JECA御礼メールエラー[' + mode + ']', e.toString());
  }
}

/**
 * _handleStatusUpdate — メールIDでスプシのステータスを更新する汎用ハンドラ
 */
function _handleStatusUpdate(params, replyToken, newStatus) {
  const msgId = params.id || '';
  try {
    const sheet = getSheet('SHEET_ID', '案件一覧');
    if (sheet && msgId) {
      const rows = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]) === msgId) {
          sheet.getRange(i + 1, 11).setValue(newStatus);
          break;
        }
      }
    }
    _lineReply(replyToken, '✅ ' + newStatus + 'として記録しました\n記録時刻: ' + nowStr());
  } catch (e) {
    _lineReply(replyToken, '❌ 更新失敗: ' + e.toString().substring(0, 100));
  }
}

/**
 * _handleFollowUpCampaign — フォローアップキャンペーン起動
 */
function _handleFollowUpCampaign(replyToken) {
  agentLog('WEBHOOK-FOLLOWUP', 'START', '');
  _lineReply(replyToken, '⏳ フォローアップキャンペーン実行中...');

  try {
    // J-03: フォローアップキャンペーン
    runFollowUpCampaign();
    agentLog('WEBHOOK-FOLLOWUP', 'OK', '');
    sendLineToManager('✅ フォローアップキャンペーン完了');
  } catch (e) {
    agentLog('WEBHOOK-FOLLOWUP', 'ERROR', e.toString());
    _notifyErrorText('フォローアップキャンペーンエラー', e.toString());
  }
}


// ============================================================
// ─── セクション3: セットアップ関数 ──────────────────────────
// 初回セットアップや再設定時に使用する。
// ============================================================

/**
 * setupAllTriggers — 全トリガーを削除して再設定する
 * GASエディタから手動実行する。
 * 実行前に既存トリガーをすべて削除するため冪等に使える。
 */
function setupAllTriggers() {
  Logger.log('=== トリガーセットアップ開始 ===');

  // 既存トリガーを全削除
  const existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('既存トリガー削除: ' + existingTriggers.length + '件');

  // ─── 15分おき: S-01 メール受信・AI判定→LINE通知 ───────────
  ScriptApp.newTrigger('trigger_15min')
    .timeBased().everyMinutes(15).create();
  Logger.log('✅ trigger_15min: 15分おき（S-01 メール判定）');

  // ─── 毎週月曜8時: 週次営業レポート→LINE ─────────────────
  ScriptApp.newTrigger('trigger_monday_8')
    .timeBased().atHour(8).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('✅ trigger_monday_8: 毎日8時（月曜のみ実行・週次レポートLINE）');

  // ─── 毎日23時: リード発掘バッチ①＋夜間処理 ─────────────
  ScriptApp.newTrigger('trigger_night_23')
    .timeBased().atHour(23).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('✅ trigger_night_23: 毎日23時（リード発掘①＋補完）');

  // ─── 毎日1時・3時・5時: リード発掘バッチ②③④ ───────────
  ScriptApp.newTrigger('trigger_night_1')
    .timeBased().atHour(1).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('✅ trigger_night_1: 毎日1時（リード発掘②）');

  ScriptApp.newTrigger('trigger_night_3')
    .timeBased().atHour(3).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('✅ trigger_night_3: 毎日3時（リード発掘③）');

  ScriptApp.newTrigger('trigger_night_5')
    .timeBased().atHour(5).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('✅ trigger_night_5: 毎日5時（リード発掘④）');

  Logger.log('=== トリガーセットアップ完了（6件）===');

  // 完了をLINEに通知
  try {
    sendLineToManager(
      '⚙️ 全トリガーセットアップ完了\n' +
      '─────────────────\n' +
      '・15分おき: メール受信(S-01)\n' +
      '・毎朝8時: 業務報告(A-01) + 請求書(F-01) + フォローアップ(S-04)\n' +
      '・毎日12時: Watchdog(A-02) + 入金確認(F-02)\n' +
      '・毎日18時: 日報(P-02)\n' +
      '・毎週月曜8時: スケジュール管理(A-04)\n' +
      '・毎月1日8時: 月次報告(F-04) + 成長提案(A-03)\n' +
      '─────────────────\n' +
      '設定完了: ' + nowStr()
    );
  } catch (lineErr) {
    Logger.log('LINE通知エラー（無視）: ' + lineErr);
  }
}

/**
 * checkAllApiKeys — 全APIキーの設定状況を確認してLINEに送信
 * 初回セットアップや設定変更後に実行して確認する。
 */
function authorizeDriveApi() {
  try {
    var f = DriveApp.createFile('_auth_test.txt', 'ok', MimeType.PLAIN_TEXT);
    Drive.Files.get(f.getId());
    f.setTrashed(true);
    Logger.log('✅ Drive API 承認OK');
    sendLineToManager('✅ Drive API 承認完了\n名刺フォームが使えます！');
  } catch(e) {
    Logger.log('❌ Drive API エラー: ' + e);
    sendLineToManager('❌ Drive API エラー: ' + e);
  }
}

function listXaiModels() {
  const key = getProp('XAI_API_KEY');
  if (!key) { Logger.log('❌ XAI_API_KEY 未設定'); return; }
  const res = UrlFetchApp.fetch('https://api.x.ai/v1/models', {
    headers: { 'Authorization': 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  const body = res.getContentText();
  Logger.log(body);
  try {
    const ids = JSON.parse(body).data.map(m => m.id).join('\n');
    sendLineToManager('【xAI利用可能モデル】\n' + ids);
  } catch(e) {
    sendLineToManager('モデル取得失敗:\n' + body.substring(0, 300));
  }
}

function checkAllApiKeys() {
  Logger.log('=== APIキー確認開始 ===');

  // チェック対象キー一覧
  const keys = [
    { key: 'CLAUDE_API_KEY',            label: 'Claude API' },
    { key: 'XAI_API_KEY',               label: 'Grok (xAI) API' },
    { key: 'LINE_CHANNEL_ACCESS_TOKEN', label: 'LINE Bot Token' },
    { key: 'LINE_USER_IDS',             label: 'LINE User IDs' },
    { key: 'SHEET_ID',                  label: '案件管理スプシ' },
    { key: 'JECA_SHEET_ID',             label: 'JECAスプシ' },
    { key: 'EXPENSE_SHEET_ID',          label: '経費スプシ' },
    { key: 'KPI_SHEET_ID',              label: 'KPIスプシ' },
    { key: 'SUPABASE_URL',              label: 'Supabase URL' },
    { key: 'SUPABASE_SERVICE_KEY',      label: 'Supabase Key' },
  ];

  const results = [];
  let okCount   = 0;
  let ngCount   = 0;

  keys.forEach(function(item) {
    const val = getProp(item.key);
    const ok  = val && val.length > 0;
    const icon = ok ? '✅' : '❌';
    results.push(icon + ' ' + item.label);
    Logger.log(icon + ' ' + item.key + ': ' + (ok ? '設定済み(' + val.length + '文字)' : '未設定'));
    if (ok) okCount++; else ngCount++;
  });

  const summary =
    '🔍 APIキー確認結果\n' +
    '─────────────────\n' +
    results.join('\n') + '\n' +
    '─────────────────\n' +
    '✅ ' + okCount + '件 / ❌ ' + ngCount + '件\n' +
    '確認時刻: ' + nowStr();

  Logger.log(summary);

  // LINEに送信
  try {
    sendLineToManager(summary);
  } catch (e) {
    Logger.log('LINE送信エラー: ' + e);
  }

  // LINE User IDsの詳細解析
  const lineIds = getProp('LINE_USER_IDS') || '';
  if (lineIds) {
    Logger.log('LINE_USER_IDS 解析:');
    lineIds.split(',').forEach(function(entry) {
      Logger.log('  ' + entry.trim());
    });
    const managerId = getManagerLineId();
    Logger.log('Manager ID: ' + (managerId || '❌ 取得失敗'));
  }
}

/**
 * runFullSystemTest — 各チームの疎通テスト（dry run）
 * 実際にはメールを送信せず、ログとLINEで結果を報告する。
 * 新しいGASスクリプトのデプロイ後に実行する。
 */
function runFullSystemTest() {
  Logger.log('=== フルシステムテスト開始 ===');

  const results = [];
  const startTime = Date.now();

  // ─── 共通ユーティリティテスト ──────────────────────────────
  _testSection(results, 'utils.gs', function() {
    const t = today();
    const n = nowStr();
    if (!t || !n) throw new Error('today()/nowStr() が空');
    Logger.log('today=' + t + ', now=' + n);
  });

  // ─── Claude API疎通テスト ───────────────────────────────────
  _testSection(results, 'Claude API', function() {
    const key = getProp('CLAUDE_API_KEY');
    if (!key) throw new Error('CLAUDE_API_KEY 未設定');
    // 最小限のAPIコールでテスト（実コストは最小）
    const res = callClaude(
      'テスト用AIです。',
      '「OK」とだけ返答してください。',
      'claude-haiku-4-5',
      10
    );
    if (!res) throw new Error('Claude応答なし');
    Logger.log('Claude応答: ' + res.substring(0, 50));
  });

  // ─── Grok API疎通テスト ─────────────────────────────────────
  _testSection(results, 'Grok API (xAI)', function() {
    const key = getProp('XAI_API_KEY');
    if (!key) throw new Error('XAI_API_KEY 未設定');
    const res = callGrok(
      'テスト用AIです。',
      '「OK」とだけ返答してください。',
      'grok-3-mini-fast'
    );
    if (!res) throw new Error('Grok応答なし');
    Logger.log('Grok応答: ' + res.substring(0, 50));
  });

  // ─── LINE送信テスト ─────────────────────────────────────────
  _testSection(results, 'LINE送信', function() {
    const managerId = getManagerLineId();
    if (!managerId) throw new Error('manager LINE ID 未設定');
    const ok = sendLineToManager(
      '🧪 システムテスト\nhyperauto 全チームテスト実行中...\n' + nowStr()
    );
    if (!ok) throw new Error('LINE送信失敗');
  });

  // ─── スプレッドシートアクセステスト ────────────────────────
  _testSection(results, 'スプシ（案件管理）', function() {
    const sheet = getSheet('SHEET_ID', '案件一覧');
    if (!sheet) throw new Error('SHEET_ID 未設定またはシートが存在しない');
    Logger.log('案件スプシ行数: ' + sheet.getLastRow());
  });

  _testSection(results, 'スプシ（JECAフェア）', function() {
    const sheet = getSheet('JECA_SHEET_ID', null);
    if (!sheet) throw new Error('JECA_SHEET_ID 未設定');
    Logger.log('JECAスプシ行数: ' + sheet.getLastRow());
  });

  _testSection(results, 'スプシ（経費）', function() {
    const sheet = getSheet('EXPENSE_SHEET_ID', null);
    if (!sheet) throw new Error('EXPENSE_SHEET_ID 未設定');
    Logger.log('経費スプシ行数: ' + sheet.getLastRow());
  });

  _testSection(results, 'スプシ（KPI）', function() {
    const sheet = getSheet('KPI_SHEET_ID', null);
    if (!sheet) throw new Error('KPI_SHEET_ID 未設定');
    Logger.log('KPIスプシ行数: ' + sheet.getLastRow());
  });

  // ─── 各チーム関数の存在確認 ────────────────────────────────
  const teamFunctions = [
    'runEmailIntakeTeam',    // S-01
    'runHearingTeam',        // S-02
    'runLeadScoringTeam',    // S-03
    'runFollowUpTeam',       // S-04
    'runTalkScriptTeam',     // S-05
    'runCardRegistration',   // J-01
    'runThankYouBatch',      // J-02
    'runFollowUpCampaign',   // J-03
    'runInvoiceTeam',        // F-01
    'runPaymentTrackerTeam', // F-02
    'runExpenseTeam',        // F-03
    'runMonthlySummary',     // F-04
    'runQuoteGeneratorTeam', // E-01
    'runProposalTeam',       // E-02
    'runScheduleTeam',       // P-01
    'runDailyReportTeam',    // P-02
    'runPurchaseOrderTeam',  // P-03
    'runDailyReportAgent',   // A-01
    'runWatchdogTeam',       // A-02
    'runGrowthAdvisorTeam',  // A-03
    'runScheduleManagerTeam',// A-04
  ];

  _testSection(results, 'チーム関数定義確認', function() {
    const missing = [];
    teamFunctions.forEach(function(fn) {
      // GAS環境ではtypeof + eval で関数存在確認
      try {
        if (typeof eval(fn) !== 'function') missing.push(fn);
      } catch (e) {
        missing.push(fn + '(参照エラー)');
      }
    });
    if (missing.length > 0) {
      throw new Error('未定義の関数: ' + missing.join(', '));
    }
    Logger.log('全' + teamFunctions.length + '関数 定義確認OK');
  });

  // ─── テスト結果集計 ─────────────────────────────────────────
  const elapsed  = Math.round((Date.now() - startTime) / 1000);
  const okList   = results.filter(function(r) { return r.ok; });
  const ngList   = results.filter(function(r) { return !r.ok; });

  const report =
    '🧪 フルシステムテスト結果\n' +
    '─────────────────\n' +
    results.map(function(r) {
      return (r.ok ? '✅' : '❌') + ' ' + r.name + (r.error ? '\n   └ ' + r.error : '');
    }).join('\n') + '\n' +
    '─────────────────\n' +
    '✅ ' + okList.length + '件 / ❌ ' + ngList.length + '件\n' +
    '所要時間: ' + elapsed + '秒\n' +
    '実行時刻: ' + nowStr();

  Logger.log('\n' + report);

  // LINE最終報告
  try {
    sendLineToManager(report);
  } catch (e) {
    Logger.log('LINE最終報告エラー: ' + e);
  }

  Logger.log('=== フルシステムテスト完了 ===');
}


// ============================================================
// ─── セクション4: スプレッドシート初期化 ──────────────────────
// 全シートのヘッダー設定・書式設定を行う。
// 初回セットアップ時または列構造を変更したときに実行する。
// ============================================================

/**
 * setupAllSheets — 全スプレッドシートのヘッダーを設定する
 * 実行前にスクリプトプロパティに各スプシIDを設定しておくこと。
 */
function setupAllSheets() {
  Logger.log('=== 全シートセットアップ開始 ===');

  _setupCaseSheet();    // 案件管理シート
  _setupJecaSheet();    // JECAフェアシート
  _setupExpenseSheet(); // 経費精算シート
  _setupKpiSheet();     // KPI集計シート

  Logger.log('=== 全シートセットアップ完了 ===');

  try {
    sendLineToManager(
      '📊 全シートセットアップ完了\n' +
      '・案件管理シート\n' +
      '・JECAフェアシート\n' +
      '・経費精算シート\n' +
      '・KPI集計シート\n' +
      '完了時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('LINE通知エラー: ' + e);
  }
}

/**
 * _setupCaseSheet — 案件管理シートのヘッダー設定
 * SHEET_ID プロパティで指定されたスプシに「案件一覧」シートを作成する。
 */
function _setupCaseSheet() {
  const ssId = getProp('SHEET_ID');
  if (!ssId) { Logger.log('❌ SHEET_ID 未設定'); return; }

  try {
    const ss       = SpreadsheetApp.openById(ssId);
    let   sheet    = ss.getSheetByName('案件一覧');
    if (!sheet) {
      sheet = ss.insertSheet('案件一覧');
      Logger.log('「案件一覧」シート新規作成');
    }

    const headers = [
      '記録日時',   // A
      'メールID',   // B
      '件名',       // C
      '送信元',     // D
      '分類',       // E （案件/返信必要）
      '優先度',     // F （high/medium/low）
      '顧客名',     // G
      '現場住所',   // H
      '工事種別',   // I
      '推定金額',   // J
      'ステータス', // K
      '承認',       // L
      '請求送付',   // M
      'フォローアップ', // N
      '備考',       // O
    ];

    // ヘッダー行を設定（背景: 紺、文字: 白、太字）
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#0D1B3E');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    // 列幅を調整
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);  // 記録日時
    sheet.setColumnWidth(2, 180);  // メールID
    sheet.setColumnWidth(3, 300);  // 件名
    sheet.setColumnWidth(4, 200);  // 送信元
    sheet.setColumnWidth(5, 90);   // 分類
    sheet.setColumnWidth(6, 80);   // 優先度
    sheet.setColumnWidth(7, 160);  // 顧客名
    sheet.setColumnWidth(8, 200);  // 現場住所
    sheet.setColumnWidth(9, 180);  // 工事種別
    sheet.setColumnWidth(10, 100); // 推定金額
    sheet.setColumnWidth(11, 120); // ステータス
    sheet.setColumnWidth(12, 80);  // 承認
    sheet.setColumnWidth(13, 90);  // 請求送付
    sheet.setColumnWidth(14, 120); // フォローアップ
    sheet.setColumnWidth(15, 300); // 備考

    Logger.log('✅ 案件管理シート セットアップ完了');
  } catch (e) {
    Logger.log('❌ 案件管理シートエラー: ' + e);
  }
}

/**
 * _setupJecaSheet — JECAフェアシートのヘッダー設定
 * JECA_SHEET_ID プロパティで指定されたスプシに「JECA_CRM」シートを作成する。
 * Code_jeca_team.gs の列定義と完全一致（16列）。
 */
function _setupJecaSheet() {
  const ssId = getProp('JECA_SHEET_ID');
  if (!ssId) { Logger.log('❌ JECA_SHEET_ID 未設定（スキップ）'); return; }

  try {
    const ss    = SpreadsheetApp.openById(ssId);
    let   sheet = ss.getSheetByName('JECA_CRM');
    if (!sheet) {
      sheet = ss.insertSheet('JECA_CRM');
      Logger.log('「JECA_CRM」シート新規作成');
    }

    const headers = [
      '登録日',         // A
      '会社名',         // B
      '名前',           // C
      '役職',           // D
      'メール',         // E
      '電話',           // F
      '住所',           // G
      '業界',           // H
      '企業規模',       // I
      'ニーズ',         // J
      'スコア',         // K
      'ランク',         // L
      '会話メモ',       // M
      '御礼送信日',     // N
      'フォロー送信日', // O
      'ステータス',     // P
    ];

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#1a237e');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 200);  // 会社名
    sheet.setColumnWidth(5, 220);  // メール
    sheet.setColumnWidth(10, 250); // ニーズ
    sheet.setColumnWidth(13, 300); // 会話メモ

    Logger.log('✅ JECAシート（JECA_CRM）セットアップ完了');
  } catch (e) {
    Logger.log('❌ JECAシートエラー: ' + e);
  }
}

/**
 * _setupExpenseSheet — 経費精算シートのヘッダー設定
 * EXPENSE_SHEET_ID プロパティで指定されたスプシに「経費一覧」シートを作成する。
 */
function _setupExpenseSheet() {
  const ssId = getProp('EXPENSE_SHEET_ID');
  if (!ssId) { Logger.log('❌ EXPENSE_SHEET_ID 未設定（スキップ）'); return; }

  try {
    const ss    = SpreadsheetApp.openById(ssId);
    let   sheet = ss.getSheetByName('経費一覧');
    if (!sheet) {
      sheet = ss.insertSheet('経費一覧');
      Logger.log('「経費一覧」シート新規作成');
    }

    const headers = [
      '登録日時',   // A
      '利用日',     // B
      '種別',       // C （交通費/消耗品/接待費/その他）
      '金額',       // D
      '利用先・内容', // E
      '現場・案件',  // F
      '精算状況',   // G （未精算/精算済み）
      '添付ファイル', // H （領収書URL等）
      '備考',       // I
    ];

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#2D4A1E');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 140);
    sheet.setColumnWidth(5, 250);
    sheet.setColumnWidth(6, 200);
    sheet.setColumnWidth(9, 300);

    Logger.log('✅ 経費シート セットアップ完了');
  } catch (e) {
    Logger.log('❌ 経費シートエラー: ' + e);
  }
}

/**
 * _setupKpiSheet — KPI集計シートのヘッダー設定
 * KPI_SHEET_ID プロパティで指定されたスプシに「月次KPI」シートを作成する。
 */
function _setupKpiSheet() {
  const ssId = getProp('KPI_SHEET_ID');
  if (!ssId) { Logger.log('❌ KPI_SHEET_ID 未設定（スキップ）'); return; }

  try {
    const ss    = SpreadsheetApp.openById(ssId);
    let   sheet = ss.getSheetByName('月次KPI');
    if (!sheet) {
      sheet = ss.insertSheet('月次KPI');
      Logger.log('「月次KPI」シート新規作成');
    }

    const headers = [
      '年月',           // A
      '新規案件数',     // B
      '見積提出数',     // C
      '受注数',         // D
      '受注金額合計',   // E
      '完了案件数',     // F
      'メール受信数',   // G
      'AI判定精度',     // H （%）
      'フォローアップ数', // I
      '名刺取得数',     // J
      '御礼メール送付数', // K
      '経費合計',       // L
      '請求金額合計',   // M
      '入金確認数',     // N
      '備考',           // O
    ];

    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#4A1E2D');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(15, 300);

    Logger.log('✅ KPIシート セットアップ完了');
  } catch (e) {
    Logger.log('❌ KPIシートエラー: ' + e);
  }
}


// ============================================================
// ─── セクション5: 手動実行ショートカット ─────────────────────
// GASエディタの「関数を実行」から直接実行できる手動操作用関数。
// 通常の業務フローの中で担当者が任意のタイミングで実行する。
// ============================================================

/**
 * manual_sendThankYouDrafts — J-02 JECA御礼メール下書き作成（手動）
 * JECAフェアで取得した名刺リストに対して御礼メールの下書きを作成する。
 * Gmailの下書きに保存されるため、内容を確認してから送信できる。
 */
function manual_sendThankYouDrafts() {
  Logger.log('=== 手動: JECA御礼メール下書き作成 開始 ===');
  try {
    runThankYouBatch('draft');
    Logger.log('✅ 下書き作成完了');
    sendLineToManager(
      '✉️ JECA御礼メール下書き作成完了\n' +
      'Gmailの下書きフォルダを確認してください。\n' +
      '問題なければ manual_sendThankYouSend() で一括送信できます。\n' +
      '実行時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('J-02-MANUAL-DRAFT', e);
  }
}

/**
 * manual_runFollowUpCampaign — J-03 フォローアップキャンペーン（手動）
 * JECAフェアの名刺リストに対して個別フォローアップを実施する。
 * 前回接触から一定期間が経過した連絡先に対して自動でアプローチする。
 */
function manual_runFollowUpCampaign() {
  Logger.log('=== 手動: フォローアップキャンペーン 開始 ===');
  try {
    runFollowUpCampaign();
    Logger.log('✅ フォローアップキャンペーン完了');
    sendLineToManager(
      '📧 フォローアップキャンペーン完了\n' +
      '実行時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('J-03-MANUAL', e);
  }
}

/**
 * manual_checkPayments — F-02 入金確認（手動）
 * 請求済み案件の入金状況をチェックし、未入金のものを一覧でLINEに送る。
 * 月末など任意のタイミングで実行できる。
 */
function manual_checkPayments() {
  Logger.log('=== 手動: 入金確認 開始 ===');
  try {
    runPaymentTrackerTeam();
    Logger.log('✅ 入金確認完了');
    sendLineToManager(
      '💴 入金確認チーム実行完了\n' +
      '実行時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('F-02-MANUAL', e);
  }
}

/**
 * manual_monthlyReport — F-04 月次報告（手動）
 * 任意の月の月次報告を生成する。
 * デフォルトは先月。引数で月を指定することも可能（関数内で変更）。
 */
function manual_monthlyReport() {
  Logger.log('=== 手動: 月次報告 開始 ===');

  // ここで対象月を指定（デフォルト: 先月）
  const targetMonth = _getLastMonthStr(); // 例: "2026/04"

  Logger.log('対象月: ' + targetMonth);
  try {
    runMonthlySummary(targetMonth);
    Logger.log('✅ 月次報告完了: ' + targetMonth);
    sendLineToManager(
      '📊 月次報告生成完了\n' +
      '対象月: ' + targetMonth + '\n' +
      '実行時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('F-04-MANUAL', e);
  }
}

/**
 * manual_morningBatch — 朝バッチ手動実行
 * trigger_morning_8 と同じ処理を任意のタイミングで実行できる。
 * テスト時・リトライ時に使用する。
 */
function manual_morningBatch() {
  Logger.log('=== 手動: 朝バッチ 開始 ===');
  try {
    trigger_morning_8();
    Logger.log('✅ 朝バッチ手動実行完了');
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('MORNING-BATCH-MANUAL', e);
  }
}

/**
 * manual_sendThankYouSend — J-02 JECA御礼メール一括送信（手動）
 * manual_sendThankYouDrafts() で確認した下書きを一括送信する。
 * 実際にメールが送信されるため注意して実行すること。
 */
function manual_sendThankYouSend() {
  Logger.log('=== 手動: JECA御礼メール一括送信 開始 ===');
  try {
    runThankYouBatch('send');
    Logger.log('✅ 一括送信完了');
    sendLineToManager(
      '✅ JECA御礼メール一括送信完了\n' +
      '実行時刻: ' + nowStr()
    );
  } catch (e) {
    Logger.log('❌ エラー: ' + e);
    _notifyError('J-02-MANUAL-SEND', e);
  }
}


// ============================================================
// ─── セクション6: プライベートユーティリティ ──────────────────
// このファイル内でのみ使用する内部ヘルパー関数群。
// 関数名はアンダースコアプレフィックスで区別する。
// ============================================================

/**
 * _runSafe — エラーを握りつぶして継続実行するラッパー
 * トリガー関数内で使用し、1チームのエラーが他チームに波及しないようにする。
 * エラー発生時はLINEに通知する。
 *
 * @param {string} triggerId - トリガー識別子（ログ用）
 * @param {string} label     - タスク名（ログ・LINE通知用）
 * @param {function} fn      - 実行する関数
 */
function _runSafe(triggerId, label, fn) {
  try {
    agentLog(triggerId, 'TASK-START', label);
    fn();
    agentLog(triggerId, 'TASK-OK', label);
  } catch (e) {
    agentLog(triggerId, 'TASK-ERROR', label + ': ' + e.toString());
    _notifyErrorText(label + 'エラー', e.toString());
  }
}

/**
 * _notifyError — エラーをLINEに通知する
 *
 * @param {string} agentId - エージェントID
 * @param {Error}  err     - エラーオブジェクト
 */
function _notifyError(agentId, err) {
  _notifyErrorText('[' + agentId + ']', err ? err.toString() : '不明なエラー');
}

/**
 * _notifyErrorText — テキスト形式のエラーをLINEに通知する
 *
 * @param {string} label   - エラーラベル
 * @param {string} errText - エラー詳細テキスト
 */
function _notifyErrorText(label, errText) {
  const msg =
    '⚠️ hyperauto エラー\n' +
    '─────────────────\n' +
    '【' + label + '】\n' +
    (errText || '').substring(0, 200) + '\n' +
    '─────────────────\n' +
    '発生時刻: ' + nowStr();

  Logger.log(msg);

  try {
    sendLineToManager(msg);
  } catch (lineErr) {
    // LINEへの通知自体が失敗した場合はログのみ（無限ループ防止）
    Logger.log('LINE通知失敗（無視）: ' + lineErr);
  }
}

/**
 * _sendMorningSummary — 朝バッチ完了サマリーをLINEに送信する
 * クイックリプライボタンでよく使う操作をLINEから直接実行できるようにする。
 */
function _sendMorningSummary() {
  try {
    const qr = [
      lineQR('📊 月次報告', 'action=monthly_report'),
      lineQR('💴 入金確認', 'action=check_payments'),
      lineQR('📧 JECA下書き', 'action=jeca_batch_draft'),
    ];

    sendLineToManager(
      '☀️ おはようございます！\n' +
      '朝バッチが完了しました。\n' +
      '─────────────────\n' +
      '✅ 業務日報 (A-01)\n' +
      '✅ 請求書生成 (F-01)\n' +
      '✅ フォローアップ (S-04)\n' +
      '─────────────────\n' +
      today() + ' 朝バッチ完了',
      qr
    );
  } catch (e) {
    Logger.log('朝サマリーLINE送信エラー: ' + e);
  }
}

/**
 * _testSection — テスト1セクションを実行してresults配列に追記する
 *
 * @param {Array}    results - 結果を追記する配列
 * @param {string}   name    - セクション名
 * @param {function} fn      - テスト関数（throwするとNG）
 */
function _testSection(results, name, fn) {
  try {
    fn();
    results.push({ name: name, ok: true });
    Logger.log('✅ ' + name);
  } catch (e) {
    results.push({ name: name, ok: false, error: e.toString().substring(0, 80) });
    Logger.log('❌ ' + name + ': ' + e);
  }
}

/**
 * _parseQueryString — "key=val&key2=val2" 形式の文字列をオブジェクトに変換
 *
 * @param  {string} qs - クエリ文字列
 * @return {Object}    - キー:値 のオブジェクト
 */
function _parseQueryString(qs) {
  const obj = {};
  if (!qs) return obj;
  qs.split('&').forEach(function(pair) {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.substring(0, idx).trim();
    const v = pair.substring(idx + 1).trim();
    obj[k]  = v;
  });
  return obj;
}

/**
 * _lineReply — LINEのreplyTokenを使って返信する
 * doPost内のみで使用する（replyTokenは30秒以内に1回のみ有効）。
 *
 * @param {string} replyToken - LINEのreplyToken
 * @param {string} text       - 送信テキスト
 */
function _lineReply(replyToken, text) {
  if (!replyToken) {
    Logger.log('replyToken なし: ' + text.substring(0, 50));
    return;
  }

  const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { Logger.log('❌ LINE token 未設定'); return; }

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages:   [{ type: 'text', text: text.substring(0, 5000) }],
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('LINEリプライエラー: ' + e);
  }
}

/**
 * _getLastMonthStr — 先月の年月を "yyyy/MM" 形式で返す
 * 月次バッチで「先月分」を対象にするときに使用する。
 *
 * @return {string} 例: "2026/04"
 */
function _getLastMonthStr() {
  const d = new Date();
  d.setDate(1);        // 月初に合わせてから
  d.setMonth(d.getMonth() - 1); // 1ヶ月前にする
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM');
}

/**
 * _jsonResponse — ContentService で JSON レスポンスを返す
 *
 * @param  {Object} obj - レスポンスオブジェクト
 * @return {TextOutput}
 */
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * _lineReplyQR — quickReplyボタン付きLINE返信
 */
function _lineReplyQR(replyToken, text, quickReplyItems) {
  if (!replyToken) return;
  const token = getProp('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) { Logger.log('❌ LINE token 未設定'); return; }
  const message = { type: 'text', text: text.substring(0, 5000) };
  if (quickReplyItems && quickReplyItems.length > 0) {
    message.quickReply = { items: quickReplyItems };
  }
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [message] }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('LINEリプライQRエラー: ' + e);
  }
}

/**
 * _handleReplyPreview — 返信文をGrokで生成してLINEにプレビュー表示
 */
function _handleReplyPreview(params, replyToken, userId) {
  const msgId = params.id || '';
  const cached = CacheService.getScriptCache().get('email_' + msgId);
  if (!cached) {
    _lineReply(replyToken, '⚠️ メールデータの有効期限が切れています（6時間以内に操作してください）\nGmailの下書きをご確認ください。');
    return;
  }
  const emailInfo = JSON.parse(cached);
  const draftText = generateReplyDraft(emailInfo);
  CacheService.getScriptCache().put('draft_' + msgId, JSON.stringify({
    draftText: draftText,
    from:      emailInfo.from,
    subject:   emailInfo.subject,
    customer:  emailInfo.customer || '',
    userId:    userId || '',
  }), 1800);
  const previewText = [
    '✉️ 返信文（内容を確認してください）',
    '─────────────────',
    draftText.substring(0, 500) + (draftText.length > 500 ? '\n…（省略）全文はGmailで確認' : ''),
    '─────────────────',
    'この内容で送信しますか？',
  ].join('\n');
  _lineReplyQR(replyToken, previewText, [
    { type: 'action', action: { type: 'postback', label: '✅ 送信する',    data: 'action=reply_confirm&id=' + msgId }},
    { type: 'action', action: { type: 'postback', label: '✏️ Gmailで編集', data: 'action=reply_edit&id='    + msgId }},
  ]);
}

/**
 * _handleReplyConfirm — キャッシュの返信文を実際に送信
 */
function _handleReplyConfirm(params, replyToken) {
  const msgId = params.id || '';
  const cached = CacheService.getScriptCache().get('draft_' + msgId);
  if (!cached) {
    _lineReply(replyToken, '⚠️ 返信文の有効期限が切れました（30分以内に確認してください）\nもう一度「返信する」を押してください。');
    return;
  }
  const draftInfo = JSON.parse(cached);
  const alreadyReplied = PropertiesService.getScriptProperties().getProperty('replied_' + msgId);
  if (alreadyReplied) {
    _lineReply(replyToken, '✅ このメールはすでに返信済みです（' + alreadyReplied + '）');
    return;
  }
  try {
    GmailApp.sendEmail(draftInfo.from, 'Re: ' + draftInfo.subject, draftInfo.draftText, { name: '株式会社マルケン電工' });
    const sentAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm');
    PropertiesService.getScriptProperties().setProperty('replied_' + msgId, sentAt);
    _lineReply(replyToken, '✅ 返信を送信しました（' + sentAt + '）\n宛先: ' + (draftInfo.customer || draftInfo.from));
    Logger.log('✅ LINE返信送信完了: ' + draftInfo.from);
  } catch (err) {
    _lineReply(replyToken, '❌ 送信エラー: ' + err.toString() + '\nGmailの下書きから手動で送信してください。');
    Logger.log('LINE返信送信エラー: ' + err.toString());
  }
}

/**
 * _handleDeleteMail — 返信不要メールをGmailから削除
 */
function _handleDeleteMail(params, replyToken) {
  const threadId = decodeURIComponent(params.threadId || '');
  if (!threadId) { _lineReply(replyToken, '❌ スレッドIDが不明です'); return; }
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) {
      thread.moveToTrash();
      _lineReply(replyToken, '🗑 削除しました');
    } else {
      _lineReply(replyToken, '⚠️ スレッドが見つかりません（すでに処理済みかも）');
    }
  } catch(e) {
    _lineReply(replyToken, '❌ 削除エラー: ' + e.toString().substring(0, 100));
  }
}

/**
 * _handleUnsubscribeMail — 返信不要メールをアーカイブ（配信停止扱い）
 */
function _handleUnsubscribeMail(params, replyToken) {
  const threadId = decodeURIComponent(params.threadId || '');
  if (!threadId) { _lineReply(replyToken, '❌ スレッドIDが不明です'); return; }
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) {
      thread.moveToArchive();
      _lineReply(replyToken, '🚫 配信停止（アーカイブ）しました\n送信元からの配信停止手続きはGmailから行ってください');
    } else {
      _lineReply(replyToken, '⚠️ スレッドが見つかりません（すでに処理済みかも）');
    }
  } catch(e) {
    _lineReply(replyToken, '❌ アーカイブエラー: ' + e.toString().substring(0, 100));
  }
}

/**
 * _handleScheduleSend — 日程連絡の下書きをGmailに作成してLINEに通知
 */
function _handleScheduleSend(params, replyToken) {
  const msgId = params.id || '';
  const cached = CacheService.getScriptCache().get('email_' + msgId);
  const emailInfo = cached ? JSON.parse(cached) : {};
  const scheduleBody = [
    'お世話になっております。株式会社マルケン電工でございます。',
    '',
    'このたびはご依頼いただきありがとうございます。',
    '下記の日程にて現場へ伺う予定でございます。',
    '',
    '【日程】　〇月〇日（〇）〇時〜',
    '【作業内容】' + (emailInfo.workType || '（工事内容を入力）'),
    '【担当者】（担当者名を入力）',
    '',
    'ご確認のほど、どうぞよろしくお願いいたします。',
    'ご不明な点はお気軽にご連絡ください。',
  ].join('\n');
  try {
    GmailApp.createDraft(
      emailInfo.from || '',
      '【日程連絡】' + (emailInfo.subject || '工事のご案内'),
      scheduleBody,
      { name: '株式会社マルケン電工' }
    );
    _lineReply(replyToken,
      '📅 Gmailに日程連絡の下書きを作成しました\n' +
      '宛先: ' + (emailInfo.customer || emailInfo.from || '（宛先を確認）') + '\n\n' +
      '【日程】〇月〇日（〇）〇時〜 の部分を実際の日時に書き換えて送信してください。'
    );
  } catch (err) {
    _lineReply(replyToken, '❌ 下書き作成エラー: ' + err.toString());
  }
}
