// index.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import he from "he";
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
const MOODLE_URL = process.env.MOODLE_URL; // 例: https://ik1-449-56991.vs.sakura.ne.jp/webservice/rest/server.php
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// ユーザーごとの問題管理
const userQuestions = new Map();

// -----------------------------
// HTMLから画像URL抽出
// -----------------------------
function extractImageUrl(html) {
  try {
    const $ = cheerio.load(html);
    const img = $("img").first();
    if (img && img.attr("src")) {
      let src = img.attr("src");
      // @@PLUGINFILE@@対応 or 相対パス対応
      if (src.startsWith("@@PLUGINFILE@@")) {
        src = src.replace(
          "@@PLUGINFILE@@",
          "https://ik1-449-56991.vs.sakura.ne.jp/pluginfile.php"
        );
      } else if (src.startsWith("/")) {
        src = `https://ik1-449-56991.vs.sakura.ne.jp${src}`;
      }
      console.log("🖼️ 画像URL抽出:", src);
      return src;
    }
  } catch (e) {
    console.error("⚠️ extractImageUrlエラー:", e.message);
  }
  return null;
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
    const imageUrl = extractImageUrl(question.questiontext);

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

    messages.push({
      type: "text",
      text: messageText,
    });

    await client.replyMessage(replyToken, messages);
    console.log("✅ 問題送信成功");
  } catch (error) {
    console.error(
      "❌ sendQuestion エラー:",
      error.response?.data || error.message
    );
  }
}

// -----------------------------
// ユーザーの回答処理
// -----------------------------
async function handleAnswer(replyToken, userId, messageText) {
  const q = userQuestions.get(userId);
  if (!q) {
    await client.replyMessage(replyToken, [
      { type: "text", text: "まず「問題」と送信してください。" },
    ]);
    return;
  }

  const choiceNum = parseInt(messageText.trim());
  const selected = q.choices[choiceNum - 1];

  if (!selected) {
    await client.replyMessage(replyToken, [
      { type: "text", text: "1〜4の数字で答えてください。" },
    ]);
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
      await client.replyMessage(replyToken, [
        { type: "text", text: "問題を取得できませんでした。" },
      ]);
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
// ⚠️ middleware(config) は express.json() より前に！
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

// ⚠️ express.json() は最後に（他のルート用）
app.use(express.json());

// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
