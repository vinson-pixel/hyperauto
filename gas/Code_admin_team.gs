// ============================================================
// Code_admin_team.gs — 内部管理チーム型エージェント
// マルケン電工 hyperauto プロジェクト
// エージェント: A-01（業務報告）A-02（Watchdog監視）
//               A-03（成長提案）A-04（スケジュール管理）
// ============================================================
//
// スクリプトプロパティ:
//   JOB_SHEET_ID           案件管理スプシID（"案件一覧"シート）
//   BILLING_SHEET_ID       請求管理スプシID（"請求一覧"シート）
//   KPI_SHEET_ID           KPI記録スプシID（"月次KPI"シート）
//   AGENT_LOG_SHEET_ID     エージェントログスプシID
//   GOOGLE_CALENDAR_ID     Googleカレンダー（案件用）ID
//   CLAUDE_API_KEY         Claude API キー
//   XAI_API_KEY            xAI (Grok) API キー
//   LINE_CHANNEL_ACCESS_TOKEN
//   LINE_USER_IDS          manager:U...
//
// トリガー設定:
//   runDailyReportAgent()     → 毎朝 8:00
//   runWatchdogTeam()         → 毎日 12:00
//   runGrowthAdvisorTeam()    → 毎月 1日 9:00
//   runScheduleManagerTeam()  → 毎週月曜 8:00
// ============================================================

// ステータス定数
const STATUS = {
  ACTIVE:     '商談中',
  CONTRACTED: '受注済み',
  IN_WORK:    '施工中',
  COMPLETED:  '完工',
  BILLING:    '請求済み',
  COLLECTED:  '入金済み',
  LOST:       '失注',
  PENDING:    '保留',
};

// ============================================================
// A-01: DailyReportAgentTeam — 業務報告チーム（毎朝8時）
// ============================================================

/**
 * A-01 メイン: スプシデータを集計してLINEに朝の業務報告を送信
 * トリガー: 毎朝 8:00
 */
function runDailyReportAgent() {
  agentLog('A-01', 'START', '業務報告チーム起動: ' + today());

  // ステップ1: スプシからデータ収集
  const data = a01_dataCollector();

  // ステップ2: KPI算出
  const kpi = a01_kpiCalculator(data);

  // ステップ3: 朝の業務報告文を生成
  const report = a01_reportComposer(kpi, data);
  if (!report) {
    agentLog('A-01', 'ERROR', '報告文生成失敗');
    sendLineToManager('⚠️ A-01 朝の報告: 報告文の生成に失敗しました。スプシを確認してください。');
    return null;
  }

  // ステップ4: LINEに送信
  a01_notifier(report, kpi);

  // KPIスプシに記録
  const kpiSheet = getSheet('KPI_SHEET_ID', '日次KPI');
  if (kpiSheet) {
    appendRow(kpiSheet, [
      today(),
      kpi.activeJobCount,
      kpi.todayScheduleCount,
      kpi.weekSalesEstimate,
      kpi.followUpCount,
      kpi.overdueCount,
      nowStr(),
    ]);
  }

  agentLog('A-01', 'DONE', '朝の業務報告完了');
  return report;
}

/**
 * A-01-1: 案件スプシから今日の予定・昨日の実績を収集
 */
function a01_dataCollector() {
  agentLog('A-01', 'COLLECT', 'スプシデータ収集');

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return { jobs: [], todayJobs: [], overdueJobs: [] };

  try {
    const data      = sheet.getDataRange().getValues();
    const todayStr  = today();
    const yesterStr = Utilities.formatDate(
      new Date(new Date().getTime() - 86400000), 'Asia/Tokyo', 'yyyy/MM/dd'
    );

    const allJobs = data.slice(1).map(row => ({
      jobId:        row[0] || '',
      customerName: row[1] || '',
      location:     row[2] || '',
      workType:     row[3] || '',
      startDate:    String(row[4] || ''),
      endDate:      String(row[5] || ''),
      staffName:    row[6] || '',
      amount:       Number(row[7]) || 0,
      status:       String(row[10] || ''),
      approval:     String(row[11] || ''),
      billing:      String(row[12] || ''),
      followUpDate: String(row[13] || ''),
      notes:        String(row[14] || ''),
    }));

    const todayJobs = allJobs.filter(j =>
      j.startDate === todayStr ||
      (j.startDate <= todayStr && j.endDate >= todayStr && j.status === STATUS.IN_WORK)
    );

    const yesterdayCompleted = allJobs.filter(j => j.endDate === yesterStr);

    const followUpDue = allJobs.filter(j =>
      j.followUpDate && j.followUpDate <= todayStr &&
      ![STATUS.COMPLETED, STATUS.COLLECTED, STATUS.LOST].includes(j.status)
    );

    return {
      allJobs,
      todayJobs,
      yesterdayCompleted,
      followUpDue,
      todayStr,
    };
  } catch(e) {
    Logger.log('A-01 dataCollector error: ' + e);
    return { jobs: [], todayJobs: [], overdueJobs: [] };
  }
}

/**
 * A-01-2: KPIを算出
 */
function a01_kpiCalculator(data) {
  agentLog('A-01', 'KPI', 'KPI算出');

  const allJobs = data.allJobs || [];

  // 進行中案件
  const activeJobs = allJobs.filter(j =>
    [STATUS.CONTRACTED, STATUS.IN_WORK, STATUS.ACTIVE].includes(j.status)
  );

  // 今週の売上見込み（受注済み・施工中の合計）
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // 月曜
  const weekSales = allJobs
    .filter(j => [STATUS.CONTRACTED, STATUS.IN_WORK, STATUS.COMPLETED].includes(j.status))
    .filter(j => {
      const end = new Date(String(j.endDate).replace(/\//g, '-'));
      return end >= weekStart;
    })
    .reduce((sum, j) => sum + j.amount, 0);

  // フォローアップ待ち件数
  const todayStr = today();
  const followUpCount = (data.followUpDue || []).length;

  // 未請求の完工案件
  const unbilledCount = allJobs.filter(j =>
    j.status === STATUS.COMPLETED && j.billing !== '送付済み'
  ).length;

  return {
    activeJobCount:      activeJobs.length,
    todayScheduleCount:  (data.todayJobs || []).length,
    yesterdayCompleted:  (data.yesterdayCompleted || []).length,
    weekSalesEstimate:   weekSales,
    followUpCount:       followUpCount,
    overdueCount:        unbilledCount,
    activeJobs:          activeJobs.slice(0, 5), // 上位5件
    todayJobs:           data.todayJobs || [],
  };
}

/**
 * A-01-3: 朝の業務報告文を生成（Claude）
 */
function a01_reportComposer(kpi, data) {
  agentLog('A-01', 'COMPOSE', '報告文生成');

  const sys = `あなたはマルケン電工のAIアシスタントです。
毎朝の業務報告をLINEで社長・担当者に届けます。
簡潔・実用的・前向きなトーンで書いてください。絵文字は適度に使用。
350字以内でまとめてください。`;

  const user = `本日（${data.todayStr}）の朝の業務報告を作成してください:

【KPI】
・進行中案件: ${kpi.activeJobCount}件
・本日の予定: ${kpi.todayScheduleCount}件
・昨日完工: ${kpi.yesterdayCompleted}件
・今週売上見込: ¥${Number(kpi.weekSalesEstimate).toLocaleString()}
・フォロー待ち: ${kpi.followUpCount}件
・未請求完工: ${kpi.overdueCount}件

【本日施工予定】
${kpi.todayJobs.map(j => `・${j.customerName}（${j.workType}）${j.location}`).join('\n') || '（予定なし）'}

朝の業務報告LINEメッセージを書いてください:`;

  const msg = callClaude(sys, user);
  return (msg && String(msg).indexOf('__CLAUDE_ERR__') !== 0) ? msg : null;
}

/**
 * A-01-4: LINEに送信
 */
function a01_notifier(report, kpi) {
  agentLog('A-01', 'NOTIFY', '朝の報告LINE送信');

  const header = '🌅 おはようございます！マルケン電工 朝の業務報告\n─────────────────\n';

  sendLineToManager(
    header + report,
    [
      lineQR('本日の案件確認', 'a01_today_jobs'),
      lineQR('フォロー一覧', 'a01_followup'),
      lineQR('未請求一覧', 'a01_unbilled'),
    ]
  );
}


// ============================================================
// A-02: WatchdogTeam — Watchdog監視チーム（毎日12時）
// ============================================================

/**
 * A-02 メイン: システム異常・業務停滞を検知して警告
 * トリガー: 毎日 12:00
 */
function runWatchdogTeam() {
  agentLog('A-02', 'START', 'Watchdog監視チーム起動: ' + today());

  const issues = [];

  // ステップ1: APIキー・トリガーの正常性チェック
  const healthIssues = a02_healthChecker();
  issues.push(...healthIssues);

  // ステップ2: 7日以上動きのない案件を検出
  const staleJobs = a02_staleJobDetector();
  if (staleJobs.length > 0) {
    issues.push({ type: 'STALE_JOB', severity: 'medium', count: staleJobs.length, items: staleJobs });
  }

  // ステップ3: 返信未対応・請求未送付の案件を検出
  const overdueItems = a02_overdueDetector();
  if (overdueItems.length > 0) {
    issues.push({ type: 'OVERDUE', severity: 'high', count: overdueItems.length, items: overdueItems });
  }

  // 問題がなければ簡単な報告のみ
  if (issues.length === 0) {
    agentLog('A-02', 'OK', '異常なし');
    sendLineToManager('✅ A-02 Watchdog: 本日12時チェック完了。異常は検出されませんでした。');
    return null;
  }

  // ステップ4: 警告サマリー生成
  const alert = a02_alertComposer(issues);

  // ステップ5: LINEに緊急通知
  a02_escalator(alert, issues);

  // ログ記録
  const logSheet = getSheet('AGENT_LOG_SHEET_ID', 'Watchdogログ');
  if (logSheet) {
    appendRow(logSheet, [
      today(),
      issues.length,
      issues.filter(i => i.severity === 'high').length,
      issues.filter(i => i.severity === 'medium').length,
      alert.substring(0, 300),
      nowStr(),
    ]);
  }

  agentLog('A-02', 'DONE', issues.length + '件の問題を検出・通知');
  return issues;
}

/**
 * A-02-1: APIキー有効性・トリガー正常動作をチェック
 */
function a02_healthChecker() {
  agentLog('A-02', 'HEALTH', 'ヘルスチェック開始');

  const issues = [];

  // APIキーの存在チェック
  const requiredKeys = ['CLAUDE_API_KEY', 'XAI_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN'];
  requiredKeys.forEach(key => {
    if (!getProp(key)) {
      issues.push({
        type:     'MISSING_KEY',
        severity: 'critical',
        detail:   key + ' が未設定です',
      });
    }
  });

  // 必須スプシIDのチェック
  const requiredSheets = ['JOB_SHEET_ID'];
  requiredSheets.forEach(sheetKey => {
    if (!getProp(sheetKey)) {
      issues.push({
        type:     'MISSING_SHEET',
        severity: 'high',
        detail:   sheetKey + ' が未設定です',
      });
    }
  });

  // トリガーのチェック
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const triggerNames = triggers.map(t => t.getHandlerFunction());
    const requiredTriggers = ['processNewEmails', 'runDailyReportAgent', 'runWatchdogTeam'];

    requiredTriggers.forEach(fn => {
      if (!triggerNames.includes(fn)) {
        issues.push({
          type:     'MISSING_TRIGGER',
          severity: 'medium',
          detail:   fn + ' のトリガーが設定されていません',
        });
      }
    });
  } catch(e) {
    Logger.log('A-02 healthChecker trigger check error: ' + e);
  }

  agentLog('A-02', 'HEALTH', 'ヘルスチェック完了: ' + issues.length + '件');
  return issues;
}

/**
 * A-02-2: 7日以上動きのない案件を検出
 */
function a02_staleJobDetector() {
  agentLog('A-02', 'STALE', '停滞案件検出');

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return [];

  try {
    const data     = sheet.getDataRange().getValues();
    const todayStr = today();
    const stale    = [];

    data.slice(1).forEach((row, i) => {
      const status  = String(row[10] || '');
      const lastUpdate = String(row[14] || '');  // 備考/最終更新日を代用

      // 完了・失注・入金済みは除外
      if ([STATUS.COMPLETED, STATUS.COLLECTED, STATUS.LOST].includes(status)) return;

      // 案件開始日から停滞日数を計算
      const startDate = String(row[4] || '');
      if (!startDate) return;

      const daysSinceStart = daysBetween(startDate, todayStr);

      if (daysSinceStart > 7 && [STATUS.ACTIVE, STATUS.CONTRACTED].includes(status)) {
        stale.push({
          jobId:        row[0] || '',
          customerName: row[1] || '',
          workType:     row[3] || '',
          status:       status,
          startDate:    startDate,
          daysSince:    daysSinceStart,
          staffName:    row[6] || '',
        });
      }
    });

    // 停滞日数でソート（長い順）
    stale.sort((a, b) => b.daysSince - a.daysSince);
    agentLog('A-02', 'STALE', stale.length + '件の停滞案件');
    return stale.slice(0, 10); // 最大10件
  } catch(e) {
    Logger.log('A-02 staleJobDetector error: ' + e);
    return [];
  }
}

/**
 * A-02-3: 返信未対応・請求未送付の案件を検出
 */
function a02_overdueDetector() {
  agentLog('A-02', 'OVERDUE', '期限超過検出');

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return [];

  try {
    const data     = sheet.getDataRange().getValues();
    const todayStr = today();
    const overdue  = [];

    data.slice(1).forEach(row => {
      const status  = String(row[10] || '');
      const billing = String(row[12] || '');
      const followUp = String(row[13] || '');

      // 完工済みで未請求の案件
      if (status === STATUS.COMPLETED && billing !== '送付済み' && billing !== '不要') {
        const endDate    = String(row[5] || '');
        const daysSince  = endDate ? daysBetween(endDate, todayStr) : 0;
        if (daysSince > 3) {
          overdue.push({
            type:         'UNBILLED',
            jobId:        row[0] || '',
            customerName: row[1] || '',
            amount:       Number(row[7]) || 0,
            endDate:      endDate,
            daysSince:    daysSince,
            severity:     daysSince > 14 ? 'high' : 'medium',
          });
        }
      }

      // フォローアップ期限を超過した案件
      if (followUp && followUp < todayStr &&
          ![STATUS.COMPLETED, STATUS.COLLECTED, STATUS.LOST].includes(status)) {
        overdue.push({
          type:         'FOLLOWUP_DUE',
          jobId:        row[0] || '',
          customerName: row[1] || '',
          workType:     row[3] || '',
          followUpDate: followUp,
          daysSince:    daysBetween(followUp, todayStr),
          severity:     'medium',
        });
      }
    });

    agentLog('A-02', 'OVERDUE', overdue.length + '件の期限超過');
    return overdue;
  } catch(e) {
    Logger.log('A-02 overdueDetector error: ' + e);
    return [];
  }
}

/**
 * A-02-4: 警告サマリー生成（Claude）
 */
function a02_alertComposer(issues) {
  agentLog('A-02', 'COMPOSE', '警告サマリー生成: ' + issues.length + '件');

  const sys = `あなたはマルケン電工の業務管理AIです。
検出された問題点のサマリーを、担当者がすぐに対処できるよう
優先順位をつけて簡潔に伝えてください。400字以内で書いてください。`;

  const user = `以下の問題が検出されました。警告サマリーを作成してください:

${issues.map(i =>
  `[${i.severity?.toUpperCase() || 'INFO'}] ${i.type}: ${i.detail || ''}` +
  (i.items ? ` (${i.count}件)` : '')
).join('\n')}

緊急度の高いものから順に、対処方法も含めて報告してください:`;

  const alert = callClaude(sys, user);
  if (alert && String(alert).indexOf('__CLAUDE_ERR__') !== 0) return alert;
  return issues.map(i => `・${i.type}: ${i.detail || i.count + '件'}`).join('\n');
}

/**
 * A-02-5: LINEに緊急通知（重大度に応じてクイックリプライ付き）
 */
function a02_escalator(alert, issues) {
  agentLog('A-02', 'ESCALATE', 'Watchdog通知送信');

  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasHigh     = issues.some(i => i.severity === 'high');

  const prefix = hasCritical ? '🚨 緊急警告' : (hasHigh ? '⚠️ 警告' : '📋 注意');
  const header  = prefix + ' A-02 Watchdog検知\n─────────────────\n';

  // 停滞案件の詳細
  const staleItems = issues.filter(i => i.type === 'STALE_JOB');
  const staleDetail = staleItems.length > 0
    ? '\n【停滞案件】\n' + (staleItems[0].items || []).slice(0, 3).map(j =>
        `・${j.customerName}（${j.daysSince}日停滞）`
      ).join('\n')
    : '';

  // 未請求案件の詳細
  const overdueItems = issues.filter(i => i.type === 'OVERDUE').flatMap(i => i.items || []);
  const unbilledItems = overdueItems.filter(i => i.type === 'UNBILLED');
  const unbilledDetail = unbilledItems.length > 0
    ? '\n【未請求案件】\n' + unbilledItems.slice(0, 3).map(j =>
        `・${j.customerName} ¥${Number(j.amount).toLocaleString()}（${j.daysSince}日経過）`
      ).join('\n')
    : '';

  const message = header + alert + staleDetail + unbilledDetail;

  const qrItems = [
    lineQR('停滞案件を確認', 'a02_stale'),
    lineQR('請求処理へ', 'a02_billing'),
    lineQR('後で確認', 'a02_snooze'),
  ];

  if (hasCritical) {
    qrItems.unshift(lineQR('今すぐ対応', 'a02_urgent'));
  }

  sendLineToManager(message, qrItems);
}


// ============================================================
// A-03: GrowthAdvisorTeam — 成長提案チーム（毎月1日）
// ============================================================

/**
 * A-03 メイン: 月次KPIを分析して経営改善アドバイスをLINEに送信
 * トリガー: 毎月1日 9:00
 */
function runGrowthAdvisorTeam() {
  agentLog('A-03', 'START', '成長提案チーム起動');

  const now   = new Date();
  // 前月のデータを対象
  const month = Utilities.formatDate(
    new Date(now.getFullYear(), now.getMonth() - 1, 1), 'Asia/Tokyo', 'yyyy/MM'
  );

  // ステップ1: 月次KPI分析
  const kpi = a03_kpiAnalyzer(month);
  if (!kpi) {
    agentLog('A-03', 'ERROR', 'KPI分析失敗');
    sendLineToManager('⚠️ A-03 成長提案: ' + month + 'のKPI分析に失敗しました。');
    return null;
  }

  // ステップ2: 3ヶ月トレンド検出
  const kpiHistory = a03_loadKpiHistory(3);
  const trends     = a03_trendDetector(kpi, kpiHistory);

  // ステップ3: 次月の営業戦略提案
  const strategy = a03_strategyProposer(trends, kpi);
  if (!strategy) {
    agentLog('A-03', 'ERROR', '戦略提案生成失敗');
    return null;
  }

  // ステップ4: 月次アドバイスレポート生成
  const report = a03_reportComposer(strategy, kpi, month);

  // ステップ5: LINEに送信
  a03_notifier(report, kpi, month);

  // KPIスプシに記録
  const kpiSheet = getSheet('KPI_SHEET_ID', '月次KPI');
  if (kpiSheet) {
    appendRow(kpiSheet, [
      month,
      kpi.salesTotal,
      kpi.jobCount,
      kpi.winRate,
      kpi.avgDealSize,
      kpi.topService,
      nowStr(),
    ]);
  }

  agentLog('A-03', 'DONE', month + ' 月次アドバイス送信完了');
  return { kpi, trends, strategy, report };
}

/**
 * A-03-1: 月次売上・案件数・勝率・平均単価を分析
 */
function a03_kpiAnalyzer(month) {
  agentLog('A-03', 'KPI', '月次KPI分析: ' + month);

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return null;

  try {
    const data     = sheet.getDataRange().getValues();
    const monthJobs = data.slice(1).filter(row => {
      const endDate = String(row[5] || '');
      return endDate.startsWith(month);
    });

    if (monthJobs.length === 0) {
      Logger.log('A-03: ' + month + ' のデータなし');
    }

    const completedJobs = monthJobs.filter(r => [STATUS.COMPLETED, STATUS.COLLECTED, STATUS.BILLING].includes(String(r[10])));
    const wonJobs       = monthJobs.filter(r => String(r[10]) !== STATUS.LOST && String(r[10]) !== STATUS.PENDING);

    const salesTotal = completedJobs.reduce((sum, r) => sum + (Number(r[7]) || 0), 0);
    const jobCount   = monthJobs.length;
    const winRate    = jobCount > 0 ? Math.round(wonJobs.length / jobCount * 100) : 0;
    const avgDeal    = completedJobs.length > 0 ? Math.round(salesTotal / completedJobs.length) : 0;

    // 最多工事種別
    const typeCounts = {};
    completedJobs.forEach(r => {
      const t = String(r[3] || '');
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const topService = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '不明';

    return {
      month,
      salesTotal,
      jobCount,
      completedCount: completedJobs.length,
      winRate,
      avgDealSize:    avgDeal,
      topService,
      rawJobs:        monthJobs,
    };
  } catch(e) {
    Logger.log('A-03 kpiAnalyzer error: ' + e);
    return null;
  }
}

/**
 * A-03 補助: 過去N ヶ月のKPI履歴を読み込み
 */
function a03_loadKpiHistory(months) {
  const sheet = getSheet('KPI_SHEET_ID', '月次KPI');
  if (!sheet) return [];

  try {
    const data = sheet.getDataRange().getValues();
    return data.slice(1).slice(-months).map(row => ({
      month:       row[0] || '',
      salesTotal:  Number(row[1]) || 0,
      jobCount:    Number(row[2]) || 0,
      winRate:     Number(row[3]) || 0,
      avgDealSize: Number(row[4]) || 0,
      topService:  row[5] || '',
    }));
  } catch(e) {
    return [];
  }
}

/**
 * A-03-2: 3ヶ月トレンド・季節性を検出（Claude）
 */
function a03_trendDetector(currentKpi, kpiHistory) {
  agentLog('A-03', 'TREND', 'トレンド検出');

  const sys = `あなたはマルケン電工の経営アナリストです。
月次KPIと過去の推移から、ビジネストレンドと季節性パターンを分析してください。`;

  const user = `当月KPI:
${JSON.stringify(currentKpi, null, 2)}

過去3ヶ月の推移:
${JSON.stringify(kpiHistory, null, 2)}

JSON形式:
{
  "salesTrend": "上昇|横ばい|下降",
  "salesChangeRate": 前月比変化率（%）,
  "seasonalNote": "季節性の特徴（あれば）",
  "strengths": ["強み1", "強み2"],
  "concerns": ["懸念点1", "懸念点2"],
  "opportunities": ["機会1", "機会2"]
}`;

  return callClaudeJSON(sys, user) || { salesTrend: '不明', concerns: [], opportunities: [] };
}

/**
 * A-03-3: 次月の営業戦略・注力サービスを提案（Claude）
 */
function a03_strategyProposer(trends, kpi) {
  agentLog('A-03', 'STRATEGY', '次月戦略提案');

  const sys = `あなたはマルケン電工の営業戦略コンサルタントです。
${MARUKEN_PROFILE}
KPI分析とトレンドをもとに、来月の具体的な営業戦略を提案してください。
実現可能で、小規模電気工事業者でも実行できる提案にしてください。`;

  const user = `トレンド分析:
${JSON.stringify(trends, null, 2)}

当月KPI:
売上: ¥${Number(kpi.salesTotal).toLocaleString()}
案件数: ${kpi.jobCount}件
勝率: ${kpi.winRate}%
平均受注単価: ¥${Number(kpi.avgDealSize).toLocaleString()}
主力サービス: ${kpi.topService}

JSON形式:
{
  "nextMonthTarget": "来月の売上目標（円）",
  "focusServices": ["注力サービス1", "注力サービス2"],
  "actionItems": ["具体的アクション1（誰が・何を・いつ）", "アクション2", "アクション3"],
  "newOpportunities": ["新規開拓ターゲット1", "ターゲット2"],
  "pricingAdvice": "価格戦略アドバイス",
  "oneLineMessage": "来月に向けた一言メッセージ（社長向け）"
}`;

  return callClaudeJSON(sys, user);
}

/**
 * A-03-4: 月次アドバイスレポート生成
 */
function a03_reportComposer(strategy, kpi, month) {
  agentLog('A-03', 'COMPOSE', '月次レポート生成');

  const sys = `あなたはマルケン電工のAIアシスタントです。
月次成長提案レポートをLINEで送る文章を書いてください。
社長が月初の朝に読むもので、前向きで実践的な内容にしてください。
500字以内でまとめてください。`;

  const user = `${month}の月次分析と来月の戦略提案:

【前月実績】
売上: ¥${Number(kpi.salesTotal).toLocaleString()}（案件${kpi.jobCount}件）
勝率: ${kpi.winRate}%  平均単価: ¥${Number(kpi.avgDealSize).toLocaleString()}

【戦略提案】
来月目標: ¥${Number(strategy.nextMonthTarget || 0).toLocaleString()}
注力サービス: ${(strategy.focusServices || []).join('・')}

アクション:
${(strategy.actionItems || []).map(a => '・' + a).join('\n')}

一言メッセージ: ${strategy.oneLineMessage || ''}

月初のLINEレポートメッセージを書いてください:`;

  const rpt = callClaude(sys, user);
  return (rpt && String(rpt).indexOf('__CLAUDE_ERR__') !== 0) ? rpt : '月次レポートの生成に失敗しました。';
}

/**
 * A-03-5: LINEに送信
 */
function a03_notifier(report, kpi, month) {
  agentLog('A-03', 'NOTIFY', '月次レポートLINE送信');

  const header = [
    '📈 ' + month + ' 月次成長レポート',
    '─────────────────',
    '先月実績: ¥' + Number(kpi.salesTotal).toLocaleString() + '（' + kpi.jobCount + '件）',
    '勝率: ' + kpi.winRate + '%',
    '─────────────────',
    '',
  ].join('\n');

  sendLineToManager(
    header + report,
    [
      lineQR('詳細確認', 'a03_detail:' + month),
      lineQR('来月目標設定', 'a03_set_target'),
      lineQR('戦略アドバイス', 'a03_strategy'),
    ]
  );
}


// ============================================================
// A-04: ScheduleManagerTeam — スケジュール管理チーム（毎週月曜8時）
// ============================================================

/**
 * A-04 メイン: 週次スケジュールを確認・整理してLINEに通知
 * トリガー: 毎週月曜 8:00
 */
function runScheduleManagerTeam() {
  agentLog('A-04', 'START', 'スケジュール管理チーム起動: ' + today());

  // ステップ1: 今週・来週のスケジュールを確認
  const schedule = a04_calendarAnalyzer();

  // ステップ2: 日程重複・工数超過を検出
  const conflicts = a04_conflictDetector(schedule);

  // ステップ3: 調整案を生成
  const suggestions = conflicts.length > 0
    ? a04_rescheduleSuggester(conflicts, schedule)
    : null;

  // ステップ4: LINEに週次スケジュール通知
  a04_notifier(schedule, conflicts, suggestions);

  agentLog('A-04', 'DONE', '週次スケジュール通知完了 / 重複: ' + conflicts.length + '件');
  return { schedule, conflicts, suggestions };
}

/**
 * A-04-1: 今週・来週の案件スケジュールを確認
 */
function a04_calendarAnalyzer() {
  agentLog('A-04', 'CALENDAR', '週次スケジュール確認');

  const now      = new Date();
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // 今週月曜
  const nextSunday = new Date(thisMonday);
  nextSunday.setDate(thisMonday.getDate() + 13); // 2週間後の日曜

  const thisWeekStr = Utilities.formatDate(thisMonday, 'Asia/Tokyo', 'yyyy/MM/dd');
  const nextWeekEnd = Utilities.formatDate(nextSunday, 'Asia/Tokyo', 'yyyy/MM/dd');

  const schedule = {
    thisWeek: [],
    nextWeek: [],
    thisWeekStr,
    nextWeekEnd,
  };

  // 案件スプシから対象期間の案件を収集
  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (sheet) {
    try {
      const data = sheet.getDataRange().getValues();
      data.slice(1).forEach(row => {
        const startDate = String(row[4] || '');
        const endDate   = String(row[5] || '');
        const status    = String(row[10] || '');

        if ([STATUS.LOST, STATUS.COLLECTED].includes(status)) return;
        if (!startDate || startDate > nextWeekEnd) return;
        if (endDate && endDate < thisWeekStr) return;

        const job = {
          jobId:        row[0] || '',
          customerName: row[1] || '',
          workType:     row[3] || '',
          startDate:    startDate,
          endDate:      endDate,
          staffName:    row[6] || '',
          status:       status,
        };

        // 今週か来週かで振り分け
        const nextMonday = new Date(thisMonday);
        nextMonday.setDate(thisMonday.getDate() + 7);
        const nextMondayStr = Utilities.formatDate(nextMonday, 'Asia/Tokyo', 'yyyy/MM/dd');

        if (startDate < nextMondayStr) {
          schedule.thisWeek.push(job);
        } else {
          schedule.nextWeek.push(job);
        }
      });
    } catch(e) {
      Logger.log('A-04 calendarAnalyzer error: ' + e);
    }
  }

  // Googleカレンダーからも補完
  const calId = getProp('GOOGLE_CALENDAR_ID');
  if (calId) {
    try {
      const cal    = CalendarApp.getCalendarById(calId);
      const events = cal.getEvents(thisMonday, nextSunday);
      schedule.calendarEvents = events.map(e => ({
        title:    e.getTitle(),
        start:    Utilities.formatDate(e.getStartTime(), 'Asia/Tokyo', 'yyyy/MM/dd'),
        end:      Utilities.formatDate(e.getEndTime(),   'Asia/Tokyo', 'yyyy/MM/dd'),
        allDay:   e.isAllDayEvent(),
      }));
    } catch(e) {
      Logger.log('A-04: カレンダー取得エラー: ' + e);
      schedule.calendarEvents = [];
    }
  }

  agentLog('A-04', 'CALENDAR', '今週: ' + schedule.thisWeek.length + '件 来週: ' + schedule.nextWeek.length + '件');
  return schedule;
}

/**
 * A-04-2: 日程重複・工数超過を検出
 */
function a04_conflictDetector(schedule) {
  agentLog('A-04', 'CONFLICT', '重複検出');

  const conflicts = [];
  const allJobs   = [...(schedule.thisWeek || []), ...(schedule.nextWeek || [])];

  // 同日同スタッフの重複を検出
  const staffDateMap = {};
  allJobs.forEach(job => {
    const key = `${job.staffName}|${job.startDate}`;
    if (!staffDateMap[key]) {
      staffDateMap[key] = [];
    }
    staffDateMap[key].push(job);
  });

  Object.entries(staffDateMap).forEach(([key, jobs]) => {
    if (jobs.length > 1) {
      const [staffName, date] = key.split('|');
      conflicts.push({
        type:      'DOUBLE_BOOKING',
        severity:  'high',
        date:      date,
        staffName: staffName,
        jobs:      jobs,
        message:   `${staffName}が${date}に${jobs.length}件重複しています`,
      });
    }
  });

  // スタッフ一人が1週間に5件以上の工数超過チェック
  const STAFF_WEEKLY_LIMIT = 5;
  const staffWeekCount = {};
  (schedule.thisWeek || []).forEach(job => {
    const staff = job.staffName || '未割当';
    staffWeekCount[staff] = (staffWeekCount[staff] || 0) + 1;
  });

  Object.entries(staffWeekCount).forEach(([staff, count]) => {
    if (count > STAFF_WEEKLY_LIMIT) {
      conflicts.push({
        type:      'OVERLOAD',
        severity:  'medium',
        staffName: staff,
        count:     count,
        limit:     STAFF_WEEKLY_LIMIT,
        message:   `${staff}の今週の案件が${count}件（上限${STAFF_WEEKLY_LIMIT}件）`,
      });
    }
  });

  agentLog('A-04', 'CONFLICT', conflicts.length + '件の重複・超過を検出');
  return conflicts;
}

/**
 * A-04-3: 日程調整案を生成（Claude）
 */
function a04_rescheduleSuggester(conflicts, schedule) {
  agentLog('A-04', 'SUGGEST', '日程調整案生成');

  const sys = `あなたはマルケン電工のスケジュール管理担当です。
スケジュールの重複・工数超過を解消するための調整案を提案してください。
スタッフの能力・移動距離・案件の優先度を考慮してください。`;

  const user = `以下のスケジュール競合を解消する調整案を提案してください:

【競合・超過】
${conflicts.map(c => c.message).join('\n')}

【今週の案件一覧】
${(schedule.thisWeek || []).map(j =>
  `・${j.customerName}（${j.workType}）${j.startDate}〜${j.endDate} 担当: ${j.staffName}`
).join('\n')}

【スタッフ】
${SITE_STAFF.map(s => `・${s.name}（${s.role}）`).join('\n')}

JSON形式:
{
  "suggestions": [
    {
      "jobId": "案件ID",
      "currentDate": "現在の日程",
      "proposedDate": "提案する日程",
      "reason": "変更理由",
      "assignTo": "変更する担当者（任意）"
    }
  ],
  "summary": "調整案の概要（1〜2文）"
}`;

  return callClaudeJSON(sys, user);
}

/**
 * A-04-4: LINEに週次スケジュール通知
 */
function a04_notifier(schedule, conflicts, suggestions) {
  agentLog('A-04', 'NOTIFY', '週次スケジュール通知送信');

  const lines = [
    '📅 週次スケジュール通知',
    '─────────────────',
    '集計日: ' + today(),
    '',
  ];

  // 今週の案件
  lines.push('【今週の案件】');
  if (schedule.thisWeek.length === 0) {
    lines.push('（今週の施工予定なし）');
  } else {
    schedule.thisWeek.slice(0, 5).forEach(j => {
      lines.push(`・${j.startDate} ${j.customerName}（${j.workType}）${j.staffName}`);
    });
    if (schedule.thisWeek.length > 5) {
      lines.push('...他' + (schedule.thisWeek.length - 5) + '件');
    }
  }

  lines.push('');

  // 来週の案件
  lines.push('【来週の案件】');
  if (schedule.nextWeek.length === 0) {
    lines.push('（来週の施工予定なし）');
  } else {
    schedule.nextWeek.slice(0, 3).forEach(j => {
      lines.push(`・${j.startDate} ${j.customerName}（${j.workType}）`);
    });
  }

  // 重複・工数超過アラート
  if (conflicts.length > 0) {
    lines.push('');
    lines.push('⚠️ 【要確認】スケジュール競合');
    conflicts.forEach(c => lines.push('・' + c.message));

    if (suggestions) {
      lines.push('');
      lines.push('💡 AI調整案: ' + (suggestions.summary || ''));
    }
  }

  sendLineToManager(
    lines.join('\n'),
    [
      lineQR('今週の詳細', 'a04_thisweek'),
      lineQR('来週の詳細', 'a04_nextweek'),
      conflicts.length > 0 ? lineQR('重複を解消', 'a04_fix_conflict') : lineQR('工程表確認', 'a04_schedule'),
    ]
  );
}


// ============================================================
// テスト関数
// ============================================================

/** A-01 単体テスト */
function testA01() {
  Logger.log('=== A-01 テスト ===');
  const result = runDailyReportAgent();
  Logger.log('A-01 結果: ' + (result ? '✅ 朝の報告送信完了' : '❌ 失敗またはデータなし'));
}

/** A-02 単体テスト */
function testA02() {
  Logger.log('=== A-02 テスト ===');
  const result = runWatchdogTeam();
  Logger.log('A-02 結果: ' + (result ? '✅ ' + result.length + '件の問題検出' : '✅ 異常なし'));
}

/** A-03 単体テスト */
function testA03() {
  Logger.log('=== A-03 テスト ===');
  const result = runGrowthAdvisorTeam();
  Logger.log('A-03 結果: ' + (result ? '✅ 月次レポート送信完了' : '❌ 失敗'));
}

/** A-04 単体テスト */
function testA04() {
  Logger.log('=== A-04 テスト ===');
  const result = runScheduleManagerTeam();
  Logger.log('A-04 結果: ' + (result ? '✅ 週次スケジュール通知完了 / 重複: ' + result.conflicts.length + '件' : '❌ 失敗'));
}

/** 全チームのヘルスチェック */
function testAllAdminTeams() {
  Logger.log('=== 管理チーム全体テスト ===');
  testA01();
  testA02();
  testA04();
  Logger.log('=== テスト完了 ===');
}
