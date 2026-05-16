require("dotenv").config();
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const MODEL = "claude-sonnet-4-6";

function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です");
  return new Anthropic({ apiKey: key });
}

// ── 着工前ヒアリング生成 ─────────────────────────────────
app.post("/api/generate-hearing", async (req, res) => {
  const { projectName, client, address, workType, startDate, notes } = req.body;
  const prompt = `あなたは株式会社マルケン電工の着工前ヒアリング担当AIです。
以下の案件情報を元に、電気工事の着工前ヒアリングシートをJSONで作成してください。

案件情報:
- 案件名: ${projectName}
- 発注先・施主: ${client}
- 現場住所: ${address}
- 工事内容: ${workType}
- 着工予定日: ${startDate}
- 備考: ${notes || "なし"}

以下のJSON形式のみで返答してください（説明文不要）:
{
  "projectSummary": "案件概要（2〜3文）",
  "categories": [
    {
      "name": "カテゴリ名",
      "items": [
        { "question": "確認項目", "answer": "確認内容・留意点", "important": true }
      ]
    }
  ],
  "riskPoints": ["リスクポイント1", "リスクポイント2"],
  "nextActions": [
    { "action": "アクション内容", "deadline": "期限", "responsible": "担当" }
  ]
}

カテゴリは必ず: 設計・図面確認 / 電気容量・系統確認 / 機器・器具位置確認 / 他業者との調整 / 工程・搬入計画 / 安全・法令確認 の6つを含めてください。`;

  try {
    const client_ = getClient();
    const msg = await client_.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0].text.trim();
    const json = JSON.parse(text.replace(/^```json\n?|```$/g, "").trim());
    res.json({ ok: true, data: json });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 日報自動生成 ─────────────────────────────────────────
app.post("/api/generate-report", async (req, res) => {
  const { worker, site, date, message } = req.body;
  const prompt = `あなたは電気工事の作業日報を自動生成するAIです。
現場担当者からのLINEメッセージを、正式な作業日報に変換してください。

担当者: ${worker}
現場名: ${site}
日付: ${date}
LINEメッセージ:
${message}

以下のJSON形式のみで返答してください（説明文不要）:
{
  "header": {
    "date": "日付",
    "site": "現場名",
    "worker": "作業者名",
    "reportNo": "報告書番号（日付＋連番）"
  },
  "workItems": [
    { "area": "作業エリア", "content": "作業内容", "quantity": "施工数量", "result": "作業結果" }
  ],
  "progress": { "percentage": 進捗率（数値0-100）, "comment": "進捗コメント" },
  "issues": [
    { "content": "課題内容", "action": "対応策" }
  ],
  "tomorrow": ["明日の作業1", "明日の作業2"],
  "safety": { "incidents": "なし", "checks": ["安全確認項目1", "安全確認項目2"] },
  "memo": "特記事項（なければ空文字）"
}`;

  try {
    const client_ = getClient();
    const msg = await client_.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content[0].text.trim();
    const json = JSON.parse(text.replace(/^```json\n?|```$/g, "").trim());
    res.json({ ok: true, data: json });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = 3002;
app.listen(PORT, () => {
  console.log(`\n✅ マルケン電工 デモサーバー起動`);
  console.log(`   http://localhost:${PORT}\n`);
});
