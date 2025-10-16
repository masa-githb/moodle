// ================================
// 📘 index.js（最新版・安定版）
// ================================

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import he from "he";
import dotenv from "dotenv";
import pkg from "@line/bot-sdk";

dotenv.config();
const { Client } = pkg;

// ================================
// 🌐 LINE Bot 設定
// ================================
const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

const app = express();
app.use(bodyParser.json());

// ================================
// 🧠 各ユーザーの出題記録
// ================================
const userQuestions = new Map();

// ================================
// ⚙️ 環境設定
// ================================
const PORT = process.env.PORT || 3000;
const MOODLE_API_BASE =
  "https://ik1-449-56991.vs.sakura.ne.jp/webservice/rest/server.php";
const TOKEN = "2b4be172e8e665819eb349f6e693f89f";

// ================================
// 🧩 Moodle APIからランダム問題取得
// ================================
async function getRandomQuestion() {
  const apiUrl = `${MOODLE_API_BASE}?wstoken=${TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
  console.log("🌐 Moodle API URL:", apiUrl);

  const res = await axios.get(apiUrl);
  const question = res.data;
  console.log("📥 Moodle question fetched:", question);

  return question;
}

// ================================
// 🧩 問題文から画像URLを抽出
// ================================
function extractImageUrl(questionText, questionId) {
  const $ = cheerio.load(questionText);
  const img = $("img").attr("src");
  console.log("🔍 extractImageUrl: raw src =", img);

  if (!img) return null;

  // @@PLUGINFILE@@ を Moodle の画像URLに変換
  if (img.includes("@@PLUGINFILE@@")) {
    const normalized = `https://ik1-449-56991.vs.sakura.ne.jp/webservice/pluginfile.php/1/question/questiontext/${questionId}/${img.replace(
      "@@PLUGINFILE@@/",
      ""
    )}?token=${TOKEN}`;
    console.log("✅ extractImageUrl: normalized =", normalized);
    return normalized;
  }

  return img.startsWith("http") ? img : null;
}

// ================================
// 📤 問題をLINEに送信
// ================================
async function sendQuestion(userId, question, replyToken) {
  const questionText = he.decode(
    question.questiontext.replace(/<[^>]+>/g, "")
  );

  const choicesText = question.choices
    .map((c, i) => `${i + 1}. ${c.answer}`)
    .join("\n");

  const imageUrl = extractImageUrl(question.questiontext, question.id);
  console.log(`💾 Stored question for ${userId} : ${question.id}`);

  const messages = [];

  // 画像がある場合、まず画像を送る
  if (imageUrl) {
    const proxyBase = process.env.RENDER_EXTERNAL_URL || "https://moodle-5f96.onrender.com";
    const proxyUrl = `${proxyBase}/proxy?url=${encodeURIComponent(imageUrl)}`;
    console.log("🖼️ Sending image via proxy:", proxyUrl);

    messages.push({
      type: "image",
      originalContentUrl: proxyUrl,
      previewImageUrl: proxyUrl,
    });
  }

  // 問題文と選択肢
  messages.push({
    type: "text",
    text: `問題: ${questionText}\n\n${choicesText}\n\n数字で答えてください。`,
  });

  await client.replyMessage(replyToken, { messages });
}

// ================================
// 🧮 解答チェック
// ================================
async function checkAnswer(userId, userAnswer, question, replyToken) {
  const answerIndex = parseInt(userAnswer) - 1;
  const selected = question.choices[answerIndex];

  if (!selected) {
    await client.replyMessage(replyToken, {
      type: "text",
      text: "1〜4の数字で答えてください。",
    });
    return;
  }

  const resultText =
    selected.fraction === 1
      ? `⭕ 正解！\n${selected.feedback}`
      : `❌ 不正解。\n${selected.feedback}`;

  await client.replyMessage(replyToken, {
    type: "text",
    text: resultText,
  });
}

// ================================
// 🧰 イベント処理
// ================================
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const message = event.message.text.trim();

  if (message === "問題") {
    // 新しい問題を取得
    const question = await getRandomQuestion();
    userQuestions.set(userId, question);
    await sendQuestion(userId, question, event.replyToken);
  } else if (/^[1-4]$/.test(message)) {
    // 既存の問題で答え合わせ
    const question = userQuestions.get(userId);
    if (!question) {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "まず「問題」と送ってください。",
      });
      return;
    }
    await checkAnswer(userId, message, question, event.replyToken);
  } else {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "「問題」と送るとクイズが始まります！",
    });
  }
}

// ================================
// 🖥️ Webhookエンドポイント
// ================================
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      console.error("❌ Error handling event:", error);
    }
  }
  res.status(200).end();
});

// ================================
// 🖼️ 画像プロキシ
// ================================
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing url");
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    res.set("Content-Type", response.headers["content-type"]);
    res.send(response.data);
  } catch (error) {
    console.error("❌ Proxy error:", error);
    res.status(500).send("Failed to fetch image");
  }
});

// ================================
// 🚀 サーバー起動
// ================================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
