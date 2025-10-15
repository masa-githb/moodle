import express from "express";
import axios from "axios";
import line from "@line/bot-sdk";
import dotenv from "dotenv";
import cors from "cors";
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ LINE設定
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(lineConfig);

// ✅ サーバーのベースURL（.envに設定してください）
const SERVER_BASE_URL = process.env.SERVER_BASE_URL; // 例: https://ik1-449-56991.vs.sakura.ne.jp

// ✅ Moodle設定
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// ✅ 質問キャッシュ（ユーザーごと）
const userQuestions = new Map();

// ✅ LINE Webhook
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).end();
  }
});

// ✅ イベント処理
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userMessage = event.message.text.trim();
  const userId = event.source.userId;

  if (userMessage === "問題") {
    await sendQuestion(event.replyToken, userId);
  } else if (/^[1-4]$/.test(userMessage)) {
    await checkAnswer(event.replyToken, userId, userMessage);
  } else {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "「問題」と入力するとクイズを出します！",
    });
  }
}

// ✅ 問題を送信
async function sendQuestion(replyToken, userId) {
  try {
    const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
    console.log("🌐 Moodle API URL:", url);

    const response = await axios.get(url);
    const q = response.data;

    console.log("📥 Moodle question fetched:", q);

    // ✅ 画像URL抽出
    const rawSrc = extractImageSrc(q.questiontext);
    console.log("🔍 extractImageUrl: raw src =", rawSrc);

    const normalized = normalizeImageUrl(q.id, rawSrc);
    console.log("✅ extractImageUrl: normalized =", normalized);

    // ✅ 問題文を整形
    const questionText = q.questiontext.replace(/<[^>]*>/g, "").trim();
    const choicesText = q.choices.map(
      (c, i) => `${i + 1}. ${c.answer}`
    ).join("\n");

    const messageText = `問題: ${questionText}\n\n${choicesText}\n\n数字で答えてください。`;

    // ✅ ユーザーに紐づけて記憶
    userQuestions.set(userId, q.id);
    console.log(`💾 Stored question for ${userId}: ${q.id}`);

    // ✅ LINEに送信（画像＋テキスト）
    const messages = [];

    if (normalized) {
      const proxyUrl = `${SERVER_BASE_URL}/proxy?url=${encodeURIComponent(normalized)}`;
      console.log("🖼️ Sending image via proxy:", proxyUrl);

      messages.push({
        type: "image",
        originalContentUrl: proxyUrl,
        previewImageUrl: proxyUrl,
      });
    }

    messages.push({
      type: "text",
      text: messageText,
    });

    await client.replyMessage(replyToken, messages);
    console.log("📤 Sent to LINE:", messages);

  } catch (err) {
    console.error("❌ Error sending question:", err);
  }
}

// ✅ 答えをチェック
async function checkAnswer(replyToken, userId, userAnswer) {
  const questionId = userQuestions.get(userId);
  if (!questionId) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "まず「問題」と入力してください。",
    });
    return;
  }

  try {
    const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_check_answer&moodlewsrestformat=json&questionid=${questionId}&answerindex=${userAnswer}`;
    const response = await axios.get(url);
    const result = response.data;

    const replyText = result.correct
      ? `⭕ 正解！ ${result.feedback}`
      : `❌ 不正解… ${result.feedback}`;

    await client.replyMessage(replyToken, {
      type: "text",
      text: replyText,
    });

    console.log(`📤 Answer checked: ${replyText}`);
  } catch (err) {
    console.error("❌ Error checking answer:", err);
  }
}

// ✅ HTML内の画像src抽出
function extractImageSrc(html) {
  const match = html.match(/src="([^"]+)"/);
  return match ? match[1] : null;
}

// ✅ Moodle画像URLの正規化
function normalizeImageUrl(questionId, src) {
  if (!src) return null;
  if (src.startsWith("http")) return src;

  return `https://ik1-449-56991.vs.sakura.ne.jp/webservice/pluginfile.php/1/question/questiontext/${questionId}/${src.replace(
    "@@PLUGINFILE@@/",
    ""
  )}?token=${MOODLE_TOKEN}`;
}

// ✅ Moodle画像をプロキシ経由で配信
app.get("/proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url");

    const response = await axios.get(url, { responseType: "arraybuffer" });

    const contentType = response.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.send(response.data);
  } catch (err) {
    console.error("Proxy Error:", err.message);
    res.status(500).send("Image fetch error");
  }
});

// ✅ サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
