// ============================================================
// Code_site_team.gs — 現場管理チーム型エージェント
// マルケン電工 hyperauto プロジェクト
// エージェント: P-01（工程表自動作成）P-02（日報集計）
//               P-03（発注メール作成）P-04（写真管理）
// ============================================================
//
// スクリプトプロパティ:
//   JOB_SHEET_ID           案件管理スプシID（"案件一覧"シート）
//   DAILY_REPORT_SHEET_ID  日報スプシID（"日報"シート）
//   VENDOR_SHEET_ID        業者・資材業者マスタスプシID
//   SCHEDULE_SHEET_ID      工程表スプシID
//   PHOTO_LOG_SHEET_ID     写真管理スプシID
//   GOOGLE_CALENDAR_ID     Googleカレンダー（案件用）ID
//   CLAUDE_API_KEY         Claude API キー
//   XAI_API_KEY            xAI (Grok) API キー
//   LINE_CHANNEL_ACCESS_TOKEN
//   LINE_USER_IDS          manager:U...
// ============================================================

// 現場スタッフ一覧（スプシに移行する場合はgetSheet経由で取得）
const SITE_STAFF = [
  { name: 'vinson',  email: 'vinson@marukendenkou.com',  role: '現場責任者' },
  { name: 'asai',    email: 'asai@marukendenkou.com',    role: '施工スタッフ' },
  { name: 'shigeno', email: 'shigeno@marukendenkou.com', role: '施工スタッフ' },
];

// ============================================================
// P-01: ScheduleTeam — 工程表自動作成チーム
// ============================================================

/**
 * P-01 メイン: 案件情報から工程表を生成しカレンダーに登録
 * @param {object|string} jobInfo - 案件情報
 */
function runScheduleTeam(jobInfo) {
  agentLog('P-01', 'START', '工程表自動作成チーム起動');

  const infoStr = typeof jobInfo === 'string' ? jobInfo : JSON.stringify(jobInfo);

  // ステップ1: 案件情報の解析
  const parsed = p01_projectParser(infoStr);
  if (!parsed) {
    agentLog('P-01', 'ERROR', '案件情報の解析失敗');
    sendLineToManager('⚠️ P-01 工程表作成: 案件情報の解析に失敗しました。');
    return null;
  }

  // ステップ2: 作業ステップ分解
  const tasks = p01_taskBreakdown(parsed.workType, parsed.scale);
  if (!tasks || tasks.length === 0) {
    agentLog('P-01', 'ERROR', '作業ステップの分解失敗');
    return null;
  }

  // ステップ3: 担当者・日程を割り当て
  const allocation = p01_resourceAllocator(tasks, SITE_STAFF);

  // ステップ4: 工程表を生成（スプシ形式）
  const schedule = p01_scheduleBuilder(tasks, allocation, parsed);

  // ステップ5: Googleカレンダーに登録
  const calendarResult = p01_calendarSync(schedule, parsed);

  // 工程表スプシに記録
  const sheet = getSheet('SCHEDULE_SHEET_ID', '工程表');
  if (sheet) {
    schedule.tasks.forEach(task => {
      appendRow(sheet, [
        parsed.jobId || '',
        parsed.jobName || '',
        task.taskName,
        task.assignee,
        task.startDate,
        task.endDate,
        task.duration + '日',
        task.status || '予定',
        nowStr(),
      ]);
    });
  }

  // LINE通知
  const lineMsg = [
    '📅 P-01 工程表作成完了',
    '─────────────────',
    '案件: ' + (parsed.jobName || parsed.workType || '不明'),
    '期間: ' + parsed.startDate + ' 〜 ' + parsed.endDate,
    'タスク数: ' + tasks.length + '件',
    'カレンダー登録: ' + (calendarResult ? '✅' : '❌'),
    '',
    '【工程サマリー】',
    schedule.tasks.slice(0, 5).map(t =>
      `・${t.taskName}（${t.assignee}）${t.startDate}`
    ).join('\n'),
    tasks.length > 5 ? '...他' + (tasks.length - 5) + '件' : '',
  ].join('\n');

  sendLineToManager(lineMsg, [
    lineQR('工程確認', 'p01_view:' + (parsed.jobId || '')),
    lineQR('修正依頼', 'p01_edit'),
  ]);

  agentLog('P-01', 'DONE', 'タスク ' + tasks.length + '件生成');
  return schedule;
}

/**
 * P-01-1: 案件情報から工事内容・期間・制約を抽出（Grok）
 */
function p01_projectParser(jobInfo) {
  agentLog('P-01', 'PARSE', '案件情報解析');

  const sys = `あなたはマルケン電工の工程管理担当です。
案件情報から工程表作成に必要な情報を抽出してください。
規模は「小（1〜3日）」「中（4〜10日）」「大（10日〜）」で判定してください。`;

  const user = `以下の案件情報を解析してください:\n\n${jobInfo}\n\n
JSON形式:
{
  "jobId": "案件ID（あれば）",
  "jobName": "案件名・工事名",
  "workType": "工事種別",
  "scale": "小|中|大",
  "location": "現場住所",
  "startDate": "開始日（yyyy/MM/dd形式）",
  "endDate": "終了日（yyyy/MM/dd形式）",
  "constraints": ["制約条件1（例: 日祝は作業不可）", "制約2"],
  "specialNotes": "特記事項"
}`;

  return callGrokJSON(sys, user);
}

/**
 * P-01-2: 工事種別から作業ステップを分解（Claude）
 */
function p01_taskBreakdown(workType, scale) {
  agentLog('P-01', 'TASKS', '作業ステップ分解: ' + workType + ' /' + scale);

  const sys = `あなたはマルケン電工の工程管理の専門家です。
電気工事の工事種別と規模から、必要な作業ステップを分解してください。
現実的な順序・依存関係で設定し、安全・検査工程も含めてください。`;

  const user = `工事種別: ${workType}\n規模: ${scale}\n\n
作業ステップをJSON形式で返してください:
{
  "tasks": [
    {
      "seq": 1,
      "taskName": "作業名",
      "duration": 所要日数,
      "category": "準備|施工|検査|完了",
      "dependsOn": [依存する前工程のseq番号],
      "notes": "注意事項"
    }
  ]
}`;

  const result = callClaudeJSON(sys, user);
  return result ? result.tasks : null;
}

/**
 * P-01-3: 担当者・作業日程を割り当て
 */
function p01_resourceAllocator(tasks, staff) {
  agentLog('P-01', 'ALLOC', '担当者割り当て ' + tasks.length + '件');

  // 稼働可能スタッフをローテーション
  const allocation = {};
  tasks.forEach((task, i) => {
    const assignee = staff[i % staff.length];
    allocation[task.seq] = {
      seq:      task.seq,
      taskName: task.taskName,
      assignee: assignee.name,
      email:    assignee.email,
      role:     assignee.role,
    };
  });

  return allocation;
}

/**
 * P-01-4: 工程表を生成（スプシ形式）
 */
function p01_scheduleBuilder(tasks, allocation, parsed) {
  agentLog('P-01', 'BUILD', '工程表生成');

  const startDate = parsed.startDate
    ? new Date(parsed.startDate.replace(/\//g, '-'))
    : new Date();

  let currentDate = new Date(startDate);
  const scheduledTasks = [];

  tasks.forEach(task => {
    const alloc = allocation[task.seq] || {};

    // 土日スキップ
    while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const taskStart = new Date(currentDate);
    let workDays    = 0;
    const taskEnd   = new Date(currentDate);

    while (workDays < (task.duration || 1)) {
      if (taskEnd.getDay() !== 0 && taskEnd.getDay() !== 6) workDays++;
      if (workDays < task.duration) taskEnd.setDate(taskEnd.getDate() + 1);
    }

    scheduledTasks.push({
      seq:       task.seq,
      taskName:  task.taskName,
      duration:  task.duration || 1,
      category:  task.category || '施工',
      assignee:  alloc.assignee || 'vinson',
      email:     alloc.email || 'vinson@marukendenkou.com',
      startDate: Utilities.formatDate(taskStart, 'Asia/Tokyo', 'yyyy/MM/dd'),
      endDate:   Utilities.formatDate(taskEnd,   'Asia/Tokyo', 'yyyy/MM/dd'),
      notes:     task.notes || '',
      status:    '予定',
    });

    // 次タスクの開始日を翌営業日に
    currentDate = new Date(taskEnd);
    currentDate.setDate(currentDate.getDate() + 1);
  });

  return {
    jobId:    parsed.jobId || '',
    jobName:  parsed.jobName || parsed.workType || '',
    tasks:    scheduledTasks,
    created:  nowStr(),
  };
}

/**
 * P-01-5: Googleカレンダーに工程を登録
 */
function p01_calendarSync(schedule, parsed) {
  agentLog('P-01', 'CAL', 'カレンダー同期: ' + schedule.tasks.length + '件');

  const calId = getProp('GOOGLE_CALENDAR_ID');
  if (!calId) {
    Logger.log('P-01: GOOGLE_CALENDAR_ID 未設定 → スキップ');
    return false;
  }

  try {
    const cal = CalendarApp.getCalendarById(calId);
    if (!cal) { Logger.log('P-01: カレンダー取得失敗'); return false; }

    schedule.tasks.forEach(task => {
      const startParts = task.startDate.split('/').map(Number);
      const endParts   = task.endDate.split('/').map(Number);
      const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
      const end   = new Date(endParts[0],   endParts[1]   - 1, endParts[2] + 1); // 終日イベントなので+1日

      cal.createAllDayEvent(
        '【' + (parsed.jobName || '工事') + '】' + task.taskName + '（' + task.assignee + '）',
        start,
        end,
        {
          description: [
            '案件: ' + (parsed.jobName || ''),
            '担当: ' + task.assignee,
            'カテゴリ: ' + task.category,
            '備考: ' + task.notes,
          ].join('\n'),
          guests: task.email,
        }
      );
    });

    Logger.log('P-01: カレンダー登録完了 ' + schedule.tasks.length + '件');
    return true;
  } catch(e) {
    Logger.log('P-01 calendarSync error: ' + e);
    return false;
  }
}


// ============================================================
// P-02: DailyReportTeam — 日報集計チーム（毎日18時）
// ============================================================

/**
 * P-02 メイン: 本日の工事案件を集計してLINEに日報送信
 * トリガー: 毎日18:00
 */
function runDailyReportTeam() {
  agentLog('P-02', 'START', '日報集計チーム起動: ' + today());

  // ステップ1: 本日の報告データ収集
  const reports = p02_reportCollector();

  // ステップ2: データの標準化
  const normalized = p02_dataNormalizer(reports);

  // ステップ3: 日報サマリー生成
  const summary = p02_summaryGenerator(normalized);
  if (!summary) {
    agentLog('P-02', 'ERROR', '日報サマリー生成失敗');
    sendLineToManager('⚠️ P-02 日報: サマリー生成に失敗しました。手動確認をお願いします。');
    return null;
  }

  // ステップ4: LINEに送信
  p02_lineSender(summary, normalized);

  // 日報スプシに記録
  const sheet = getSheet('DAILY_REPORT_SHEET_ID', '日報');
  if (sheet) {
    appendRow(sheet, [
      today(),
      normalized.activeJobs,
      normalized.completedToday,
      normalized.totalWorkers,
      summary.substring(0, 200),
      nowStr(),
    ]);
  }

  agentLog('P-02', 'DONE', '日報送信完了');
  return summary;
}

/**
 * P-02-1: 本日の工事案件を収集
 */
function p02_reportCollector() {
  agentLog('P-02', 'COLLECT', '本日案件収集');

  const sheet = getSheet('JOB_SHEET_ID', '案件一覧');
  if (!sheet) return { jobs: [], todayStr: today() };

  try {
    const data    = sheet.getDataRange().getValues();
    const todayStr = today();
    const jobs    = [];

    data.slice(1).forEach(row => {
      const status   = String(row[10] || '');
      const startDate = String(row[4]  || '');
      const endDate   = String(row[5]  || '');

      // 今日が施工期間内、またはステータスが「施工中」の案件を対象
      if (
        status.includes('施工中') ||
        (startDate <= todayStr && endDate >= todayStr)
      ) {
        jobs.push({
          jobId:        row[0] || '',
          customerName: row[1] || '',
          location:     row[2] || '',
          workType:     row[3] || '',
          startDate:    startDate,
          endDate:      endDate,
          staffName:    row[6] || '',
          status:       status,
          progress:     row[11] || '',
        });
      }
    });

    return { jobs, todayStr };
  } catch(e) {
    Logger.log('P-02 reportCollector error: ' + e);
    return { jobs: [], todayStr: today() };
  }
}

/**
 * P-02-2: 報告データを標準化・集計
 */
function p02_dataNormalizer(reports) {
  agentLog('P-02', 'NORMALIZE', '日報データ標準化');

  const jobs     = reports.jobs || [];
  const todayStr = reports.todayStr || today();

  const activeJobs      = jobs.filter(j => j.status.includes('施工中')).length;
  const completedToday  = jobs.filter(j => j.endDate === todayStr).length;
  const staffSet        = new Set(jobs.map(j => j.staffName).filter(Boolean));

  return {
    date:            todayStr,
    jobs:            jobs,
    activeJobs:      activeJobs,
    completedToday:  completedToday,
    totalWorkers:    staffSet.size,
    staffList:       Array.from(staffSet),
    jobCount:        jobs.length,
  };
}

/**
 * P-02-3: 日報サマリー文章生成（Claude）
 */
function p02_summaryGenerator(data) {
  agentLog('P-02', 'SUMMARY', '日報サマリー生成');

  const sys = `あなたはマルケン電工の工事管理担当です。
本日の工事状況をまとめた、簡潔で実用的な日報サマリーを生成してください。
社長・担当者が夕方に確認するLINEメッセージとして書いてください。
400字以内で、要点を箇条書きで伝えてください。`;

  const user = `本日（${data.date}）の工事状況:
- 稼働案件数: ${data.activeJobs}件
- 本日完工: ${data.completedToday}件
- 稼働スタッフ: ${data.staffList.join(', ') || 'なし'}

【案件詳細】
${data.jobs.map(j =>
  `・${j.customerName}（${j.location}）: ${j.workType} [${j.status}]`
).join('\n') || '（案件なし）'}

上記をもとに、夕方の日報LINEメッセージを書いてください。`;

  return callClaude(sys, user);
}

/**
 * P-02-4: LINEに日報送信
 */
function p02_lineSender(summary, data) {
  agentLog('P-02', 'LINE', '日報はスプレッドシートのみ記録（LINEグループ送信スキップ）');
  // グループには案件通知のみ送るため、日報サマリーのLINE送信は行わない
}


// ============================================================
// P-03: PurchaseOrderTeam — 発注メール作成チーム
// ============================================================

/**
 * P-03 メイン: 案件情報から協力業者・資材業者への発注メール下書きを作成
 * @param {object|string} jobInfo - 案件情報
 */
function runPurchaseOrderTeam(jobInfo) {
  agentLog('P-03', 'START', '発注メール作成チーム起動');

  const infoStr = typeof jobInfo === 'string' ? jobInfo : JSON.stringify(jobInfo);

  // ステップ1: 必要な資材・作業を抽出
  const orderItems = p03_workOrderParser(infoStr);
  if (!orderItems || orderItems.length === 0) {
    agentLog('P-03', 'ERROR', '発注項目の抽出失敗');
    sendLineToManager('⚠️ P-03 発注: 必要資材・作業の抽出に失敗しました。');
    return null;
  }

  // ステップ2: 適切な業者をマッチング
  const vendorMatches = p03_vendorMatcher(orderItems);

  // ステップ3〜4: 業者ごとに発注メール作成
  const results = [];
  vendorMatches.forEach(match => {
    const emailBody = p03_orderComposer(match.items, match.vendor, infoStr);
    if (emailBody) {
      const drafted = p03_draftCreator(match.vendor, emailBody);
      results.push({
        vendor:   match.vendor.name || '不明業者',
        email:    match.vendor.email || '',
        drafted:  drafted,
        itemCount: match.items.length,
      });
    }
  });

  // LINE通知
  const lineMsg = [
    '📦 P-03 発注メール作成完了',
    '─────────────────',
    '発注先数: ' + results.length + '社',
    '',
    results.map(r =>
      `・${r.vendor}（${r.itemCount}項目）: ${r.drafted ? '✅ 下書き作成' : '❌ 失敗'}`
    ).join('\n'),
  ].join('\n');

  sendLineToManager(lineMsg, [
    lineQR('下書き確認', 'p03_review'),
    lineQR('再作成', 'p03_retry'),
  ]);

  agentLog('P-03', 'DONE', results.length + '社への発注下書き作成完了');
  return results;
}

/**
 * P-03-1: 必要な資材・作業を抽出（Grok）
 */
function p03_workOrderParser(jobInfo) {
  agentLog('P-03', 'PARSE', '発注項目抽出');

  const sys = `あなたはマルケン電工の調達担当です。
工事案件の情報から、協力業者への外注や資材業者への発注が必要な項目を抽出してください。
自社で対応できない専門工事や、調達が必要な資材を特定してください。`;

  const user = `以下の案件情報から発注が必要な項目を抽出してください:\n\n${jobInfo}\n\n
JSON形式:
{
  "orderItems": [
    {
      "item": "品名・作業名",
      "type": "資材|外注作業|レンタル",
      "quantity": 数量,
      "unit": "単位",
      "spec": "仕様・規格",
      "requiredBy": "必要日",
      "priority": "高|中|低"
    }
  ]
}`;

  const result = callGrokJSON(sys, user);
  return result ? result.orderItems : null;
}

/**
 * P-03-2: 適切な業者・資材業者をスプシからマッチング
 */
function p03_vendorMatcher(items) {
  agentLog('P-03', 'VENDOR', '業者マッチング: ' + items.length + '項目');

  const sheet = getSheet('VENDOR_SHEET_ID', '業者マスタ');

  // スプシが使えない場合はデフォルト業者を使用
  const defaultVendors = [
    {
      name:     '〇〇電材センター（デフォルト）',
      email:    'order@vendor-example.com',
      category: '電材全般',
      notes:    '※VENDORシートを設定してください',
    },
  ];

  let vendors = defaultVendors;

  if (sheet) {
    try {
      const data = sheet.getDataRange().getValues();
      vendors = data.slice(1).map(row => ({
        name:     row[0] || '',
        email:    row[1] || '',
        phone:    row[2] || '',
        category: row[3] || '',
        leadTime: row[4] || '',
        notes:    row[5] || '',
      })).filter(v => v.name && v.email);
    } catch(e) {
      Logger.log('P-03 vendorMatcher: スプシ読み込みエラー、デフォルト業者使用');
    }
  }

  // 品目タイプごとに業者を割り当て
  const materialItems = items.filter(it => it.type === '資材');
  const subcontractItems = items.filter(it => it.type === '外注作業');
  const rentalItems = items.filter(it => it.type === 'レンタル');

  const matches = [];

  // 資材業者にまとめて発注
  if (materialItems.length > 0) {
    const vendor = vendors.find(v => v.category && v.category.includes('電材')) || vendors[0];
    if (vendor) matches.push({ vendor, items: materialItems });
  }

  // 外注作業は別業者（外注マスタから探す）
  if (subcontractItems.length > 0) {
    const vendor = vendors.find(v => v.category && v.category.includes('外注')) || vendors[0];
    if (vendor) matches.push({ vendor, items: subcontractItems });
  }

  // レンタル
  if (rentalItems.length > 0) {
    const vendor = vendors.find(v => v.category && v.category.includes('レンタル')) || vendors[vendors.length - 1];
    if (vendor) matches.push({ vendor, items: rentalItems });
  }

  // 何も分類されなかった場合は全て最初の業者に
  if (matches.length === 0 && vendors.length > 0) {
    matches.push({ vendor: vendors[0], items: items });
  }

  return matches;
}

/**
 * P-03-3: 発注メール文案生成（Claude）
 */
function p03_orderComposer(items, vendor, jobInfo) {
  agentLog('P-03', 'COMPOSE', '発注メール文案生成: ' + (vendor.name || ''));

  const sys = `あなたはマルケン電工の調達担当です。
協力業者・資材業者への発注メールを、礼儀正しく・明確に作成してください。
電気工事業者らしい実務的な文体で書いてください。`;

  const user = `以下の発注内容でメール文案を作成してください:

発注先: ${vendor.name || ''} 様
発注項目:
${items.map(it =>
  `・${it.item}（${it.spec || '標準仕様'}）× ${it.quantity}${it.unit} ／ 必要日: ${it.requiredBy || '至急'}`
).join('\n')}

案件情報（参考）: ${jobInfo.substring ? jobInfo.substring(0, 200) : JSON.stringify(jobInfo).substring(0, 200)}

テキストのみで発注メール本文を返してください（件名は含めず、本文のみ）:`;

  return callClaude(sys, user);
}

/**
 * P-03-4: Gmail下書き作成
 */
function p03_draftCreator(vendor, emailBody) {
  agentLog('P-03', 'DRAFT', '発注メール下書き作成: ' + (vendor.email || ''));

  if (!vendor.email) {
    Logger.log('P-03: 発注先メールアドレス未設定 → スキップ');
    return false;
  }

  const subject = '【発注依頼】マルケン電工 / ' + today();
  return createDraft(vendor.email, subject, emailBody || '');
}


// ============================================================
// P-04: PhotoManagerTeam — 写真管理チーム
// ============================================================

/**
 * P-04 メイン: 案件IDと写真フォルダURLから写真を整理・記録
 * @param {string} jobId     - 案件ID
 * @param {string} folderUrl - 写真が入っているGoogleドライブフォルダURL
 */
function runPhotoManagerTeam(jobId, folderUrl) {
  agentLog('P-04', 'START', '写真管理チーム起動: jobId=' + jobId);

  // フォルダIDを抽出
  const folderId = p04_extractFolderId(folderUrl);
  if (!folderId) {
    agentLog('P-04', 'ERROR', 'フォルダIDの抽出失敗: ' + folderUrl);
    sendLineToManager('⚠️ P-04 写真管理: フォルダURLが無効です。\n' + (folderUrl || '（URLなし）'));
    return null;
  }

  // ステップ1: 写真ファイルリスト取得・分類
  let fileList;
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files   = folder.getFiles();
    fileList = [];
    while (files.hasNext()) {
      const f = files.next();
      if (f.getMimeType().startsWith('image/')) {
        fileList.push({ name: f.getName(), id: f.getId(), url: f.getUrl() });
      }
    }
  } catch(e) {
    Logger.log('P-04: フォルダアクセスエラー: ' + e);
    sendLineToManager('⚠️ P-04 写真管理: フォルダへのアクセスに失敗しました。権限を確認してください。');
    return null;
  }

  if (fileList.length === 0) {
    agentLog('P-04', 'INFO', '写真ファイルなし');
    sendLineToManager('📷 P-04 写真管理: フォルダに画像ファイルが見つかりませんでした。\n案件ID: ' + jobId);
    return null;
  }

  // ステップ2: 施工前/中/後に分類
  const classified = p04_photoClassifier(fileList);

  // ステップ3: キャプション生成
  const withCaptions = p04_captionGenerator(classified);

  // ステップ4: 案件別フォルダに整理
  const organized = p04_folderOrganizer(withCaptions, jobId);

  // ステップ5: 写真URLを案件スプシに記録
  p04_recordLinker(organized, jobId);

  // LINE通知
  const lineMsg = [
    '📷 P-04 写真管理完了',
    '─────────────────',
    '案件ID: ' + jobId,
    '写真総数: ' + fileList.length + '枚',
    '  施工前: ' + classified.filter(p => p.phase === '施工前').length + '枚',
    '  施工中: ' + classified.filter(p => p.phase === '施工中').length + '枚',
    '  施工後: ' + classified.filter(p => p.phase === '施工後').length + '枚',
    'スプシ記録: ✅',
  ].join('\n');

  sendLineToManager(lineMsg);

  agentLog('P-04', 'DONE', 'jobId=' + jobId + ' / ' + fileList.length + '枚処理');
  return organized;
}

/**
 * P-04 補助: フォルダURLからIDを抽出
 */
function p04_extractFolderId(folderUrl) {
  if (!folderUrl) return null;
  const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * P-04-1: 工事写真を施工前/中/後に分類（ファイル名・連番から推定）
 */
function p04_photoClassifier(fileList) {
  agentLog('P-04', 'CLASSIFY', fileList.length + '枚を分類');

  return fileList.map((file, index) => {
    const name  = file.name.toLowerCase();
    let phase   = '施工中';  // デフォルト

    // ファイル名のキーワードで判定
    if (name.match(/(before|施工前|前|01_|001_|_b)/)) phase = '施工前';
    else if (name.match(/(after|施工後|完了|完成|後|_a|final)/)) phase = '施工後';
    else if (name.match(/(中|during|progress|wip)/)) phase = '施工中';
    else {
      // 連番による推定（全体の最初20%を施工前、最後20%を施工後と推定）
      const ratio = index / fileList.length;
      if (ratio < 0.2) phase = '施工前';
      else if (ratio > 0.8) phase = '施工後';
    }

    return { ...file, phase };
  });
}

/**
 * P-04-2: 写真のキャプション生成（Claude）
 */
function p04_captionGenerator(photos) {
  agentLog('P-04', 'CAPTION', photos.length + '枚のキャプション生成');

  const sys = `あなたはマルケン電工の施工記録担当です。
電気工事の施工写真ファイル名とフェーズから、報告書用の簡潔なキャプションを生成してください。
キャプションは20〜40字で、工事内容と状態が伝わるように書いてください。`;

  return photos.map(photo => {
    // API呼び出し回数を抑えるため、フェーズからシンプルなキャプションを生成
    const fallbackCaption = {
      '施工前': '施工前の状態を確認',
      '施工中': '施工作業の様子',
      '施工後': '施工完了・仕上がりの確認',
    }[photo.phase] || '施工の様子';

    // ファイル名に意味のある文字列がある場合のみClaude使用（節約）
    const meaningfulName = photo.name.replace(/\.(jpg|jpeg|png|gif)$/i, '')
                                     .replace(/[0-9_\-]+/g, ' ').trim();
    if (meaningfulName.length < 3) {
      return { ...photo, caption: fallbackCaption };
    }

    const user = `ファイル名: ${photo.name}\nフェーズ: ${photo.phase}\n\nキャプション（テキストのみ）:`;
    const caption = callClaude(sys, user) || fallbackCaption;
    return { ...photo, caption: caption.trim() };
  });
}

/**
 * P-04-3: Googleドライブで案件別フォルダに整理
 */
function p04_folderOrganizer(photos, jobId) {
  agentLog('P-04', 'FOLDER', 'フォルダ整理: ' + jobId);

  try {
    // 案件フォルダを作成または取得
    const parentFolderName = '現場写真_マルケン電工';
    let parentFolder;
    const parents = DriveApp.getFoldersByName(parentFolderName);
    parentFolder = parents.hasNext() ? parents.next() : DriveApp.createFolder(parentFolderName);

    // 案件別サブフォルダ
    const jobFolderName = jobId + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    let jobFolder;
    const jobFolders = parentFolder.getFoldersByName(jobFolderName);
    jobFolder = jobFolders.hasNext() ? jobFolders.next() : parentFolder.createFolder(jobFolderName);

    // フェーズ別サブフォルダ
    const phaseNames = ['施工前', '施工中', '施工後'];
    const phaseFolders = {};
    phaseNames.forEach(phase => {
      const phaseFoldersFound = jobFolder.getFoldersByName(phase);
      phaseFolders[phase] = phaseFoldersFound.hasNext()
        ? phaseFoldersFound.next()
        : jobFolder.createFolder(phase);
    });

    // ファイルをフェーズフォルダにコピー（移動はできないためコピーで代替）
    const organized = photos.map(photo => {
      const targetFolder = phaseFolders[photo.phase] || phaseFolders['施工中'];
      try {
        const file      = DriveApp.getFileById(photo.id);
        const copiedFile = file.makeCopy(photo.name, targetFolder);
        return { ...photo, organizedUrl: copiedFile.getUrl(), folderId: targetFolder.getId() };
      } catch(e) {
        Logger.log('P-04: ファイルコピーエラー (' + photo.name + '): ' + e);
        return { ...photo, organizedUrl: photo.url };
      }
    });

    return organized;
  } catch(e) {
    Logger.log('P-04 folderOrganizer error: ' + e);
    return photos;
  }
}

/**
 * P-04-4: 写真URLを案件スプシに記録
 */
function p04_recordLinker(photos, jobId) {
  agentLog('P-04', 'RECORD', '写真URL記録: ' + jobId);

  const sheet = getSheet('PHOTO_LOG_SHEET_ID', '写真ログ');
  if (!sheet) {
    Logger.log('P-04: PHOTO_LOG_SHEET_ID 未設定 → スキップ');
    return false;
  }

  photos.forEach(photo => {
    appendRow(sheet, [
      jobId,
      today(),
      photo.name,
      photo.phase,
      photo.caption || '',
      photo.organizedUrl || photo.url || '',
      nowStr(),
    ]);
  });

  return true;
}


// ============================================================
// テスト関数
// ============================================================

/** P-01 単体テスト */
function testP01() {
  Logger.log('=== P-01 テスト ===');
  const sampleJob = {
    jobId:      'JOB-2026-001',
    jobName:    '○○工場 LED照明改修工事',
    workType:   'LED照明改修・省エネ工事',
    scale:      '中',
    location:   '愛知県豊田市',
    startDate:  '2026/06/01',
    endDate:    '2026/06/10',
    constraints: ['休日は作業不可', '午前9時〜午後5時のみ'],
  };
  const result = runScheduleTeam(sampleJob);
  Logger.log('P-01 結果: ' + (result ? '✅ タスク' + result.tasks.length + '件' : '❌ 失敗'));
}

/** P-02 単体テスト */
function testP02() {
  Logger.log('=== P-02 テスト ===');
  const result = runDailyReportTeam();
  Logger.log('P-02 結果: ' + (result ? '✅ 日報送信完了' : '❌ 失敗またはデータなし'));
}

/** P-03 単体テスト */
function testP03() {
  Logger.log('=== P-03 テスト ===');
  const sampleJob = '愛知県一宮市の工場にて太陽光パネル設置工事。200kW規模。来月着工予定。ケーブル・PCS・架台を調達要。';
  const result = runPurchaseOrderTeam(sampleJob);
  Logger.log('P-03 結果: ' + (result ? '✅ ' + result.length + '社に発注下書き' : '❌ 失敗'));
}

/** P-04 単体テスト */
function testP04() {
  Logger.log('=== P-04 テスト ===');
  // 実際のフォルダURLを指定してテスト
  const testUrl = 'https://drive.google.com/drive/folders/XXXXXXXXXXXXXX';
  const result = runPhotoManagerTeam('JOB-TEST-001', testUrl);
  Logger.log('P-04 結果: ' + (result ? '✅ ' + result.length + '枚処理' : '❌ 失敗（URLを確認）'));
}
