// index.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import he from "he";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client, middleware } from "@line/bot-sdk";

dotenv.config();

const app = express();

// -----------------------------
// LINE設定
// -----------------------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// -----------------------------
// Moodle設定
// -----------------------------
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// -----------------------------
// パス設定
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public", "images");

// public/imagesディレクトリを作成（存在しない場合）
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

// Expressで静的ファイルを公開
app.use("/images", express.static(PUBLIC_DIR));

// ユーザーごとの問題管理
const userQuestions = new Map();

// -----------------------------
// HTMLから画像URL抽出 ＆ ローカルコピー
// -----------------------------
async function extractAndSaveImage(html, questionId) {
  try {
    const $ = cheerio.load(html);
    const img = $("img").first();
    if (!img || !img.attr("src")) return null;

    let src = img.attr("src");
    const base = "https://ik1-449-56991.vs.sakura.ne.jp";

    if (src.includes("@@PLUGINFILE@@")) {
      const filename = src.split("/").pop();
      const match = html.match(/questiontext\/(\d+)\//);
      let contextId = match ? parseInt(match[1], 10) : 12;
      const fixedContextId = contextId + 3;

      const srcUrl = `${base}/pluginfile.php/2/question/questiontext/${fixedContextId}/1/${questionId}/${filename}`;
      console.log("🖼️ 画像URL抽出:", srcUrl);

      // 画像をダウンロードして保存
      const localPath = path.join(PUBLIC_DIR, filename);
      try {
        const res = await axios.get(srcUrl, {
          responseType: "arraybuffer",
          headers: { Authorization: `Bearer ${MOODLE_TOKEN}` }, // Moodleがトークン認証対応なら
        });
        fs.writeFileSync(localPath, res.data);
        console.log("📁 画像保存:", localPath);
      } catch (err) {
        console.error("⚠️ 画像ダウンロード失敗:", err.message);
        return null;
      }

      // 公開URLを返す（例: https://yourdomain.com/images/Irukaansatsuzu.jpg）
      return `${process.env.PUBLIC_BASE_URL}/images/${filename}`;
    }

    return null;
  } catch (e) {
    console.error("⚠️ extractAndSaveImageエラー:", e.message);
    return null;
  }
}

// -----------------------------
// Moodleから問題取得
// -----------------------------
async function fetchRandomQuestion() {
  const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
  console.log("🌐 Moodle URL:", url);
  const res = await axios.get(url);
  return res.data;
}

// -----------------------------
// LINEへ問題を送信
// -----------------------------
async function sendQuestion(replyToken, question) {
  try {
    const text = he.decode(question.questiontext.replace(/<[^>]+>/g, ""));
    const imageUrl = await extractAndSaveImage(question.questiontext, question.id);

    let messageText = `📖 問題:\n${text}\n\n`;
    question.choices.forEach((c, i) => {
      messageText += `${i + 1}. ${c.answer}\n`;
    });
    messageText += "\n数字で答えてください。";

    const messages = [];

    if (imageUrl) {
      messages.push({
        type: "image",
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      });
    }

    messages.push({ type: "text", text: messageText });

    await client.replyMessage(replyToken, messages);
    console.log("✅ 問題送信成功");
  } catch (error) {
    console.error("❌ sendQuestion エラー:", error.response?.data || error.message);
  }
}

// -----------------------------
// ユーザーの回答処理
// -----------------------------
async function handleAnswer(replyToken, userId, messageText) {
  const q = userQuestions.get(userId);
  if (!q) {
    await client.replyMessage(replyToken, [{ type: "text", text: "まず「問題」と送信してください。" }]);
    return;
  }

  const choiceNum = parseInt(messageText.trim());
  const selected = q.choices[choiceNum - 1];

  if (!selected) {
    await client.replyMessage(replyToken, [{ type: "text", text: "1〜4の数字で答えてください。" }]);
    return;
  }

  const correct = selected.fraction === 1;
  const replyText = correct
    ? `⭕ 正解です！ ${selected.feedback || ""}`
    : `❌ 不正解です。\n${selected.feedback || ""}`;

  await client.replyMessage(replyToken, [{ type: "text", text: replyText }]);
}

// -----------------------------
// LINEイベントハンドラ
// -----------------------------
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  console.log(`💬 受信: ${text}`);

  if (text === "問題") {
    const question = await fetchRandomQuestion();
    console.log("📥 Moodleから取得:", question);

    if (!question || !question.choices) {
      await client.replyMessage(replyToken, [{ type: "text", text: "問題を取得できませんでした。" }]);
      return;
    }

    userQuestions.set(userId, question);
    await sendQuestion(replyToken, question);
  } else {
    await handleAnswer(replyToken, userId, text);
  }
}

// -----------------------------
// Webhookエンドポイント
// -----------------------------
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("❌ Webhookエラー:", e);
    res.status(500).end();
  }
});

app.use(express.json());

// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
