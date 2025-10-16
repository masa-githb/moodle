import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import * as cheerio from "cheerio";   // ← これだけ
import he from "he";
import dotenv from "dotenv";
import line from "@line/bot-sdk";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

// ✅ Render or local fallback for BASE_URL
const BASE_URL =
  process.env.BASE_URL ||
  (process.env.RENDER_EXTERNAL_URL
    ? `https://${process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, "")}`
    : "http://localhost:3000");

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const userQuestions = new Map();

// ✅ Moodle API設定
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// ✅ HTMLから画像URLを抽出して正規化
function extractImageUrl(questionHtml, questionId) {
  const $ = cheerio.load(questionHtml);
  const imgSrc = $("img").attr("src");
  if (!imgSrc) return null;

  if (imgSrc.startsWith("@@PLUGINFILE@@")) {
    return `${MOODLE_URL.replace(
      /\/webservice\/rest\/server\.php$/,
      ""
    )}/webservice/pluginfile.php/1/question/questiontext/${questionId}/${imgSrc
      .split("/")
      .pop()}?token=${MOODLE_TOKEN}`;
  }
  return imgSrc.startsWith("http") ? imgSrc : null;
}

// ✅ Moodleからランダム問題取得
async function getRandomQuestion() {
  const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
  console.log("🌐 Moodle API URL:", url);
  const response = await axios.get(url);
  return response.data;
}

// ✅ LINEへ問題送信
async function sendQuestion(replyToken, question, userId) {
  const text = he
    .decode(
      question.questiontext.replace(/<[^>]*>?/gm, "").trim()
    )
    .replace(/\r?\n|\r/g, "");

  const imageUrl = extractImageUrl(question.questiontext, question.id);
  console.log("🔍 extractImageUrl:", imageUrl);

  userQuestions.set(userId, question.id);
  console.log("💾 Stored question for", userId, ":", question.id);

  const questionText =
    `問題: ${text}\n\n` +
    question.choices
      .map((c, i) => `${i + 1}. ${c.answer}`)
      .join("\n") +
    "\n\n数字で答えてください。";

  const messages = [];

  // ✅ 画像があれば先に送信（proxyで安全転送）
  if (imageUrl) {
    const proxyUrl = `${BASE_URL}/proxy?url=${encodeURIComponent(imageUrl)}`;
    console.log("🖼️ Sending image via proxy:", proxyUrl);
    messages.push({
      type: "image",
      originalContentUrl: proxyUrl,
      previewImageUrl: proxyUrl,
    });
  }

  // ✅ 問題文送信
  messages.push({
    type: "text",
    text: questionText,
  });

  await client.replyMessage(replyToken, messages);
}

// ✅ 画像プロキシ（RenderでLINE画像転送対応）
app.get("/proxy", async (req, res) => {
  try {
    const targetUrl = req.query.url;
    const response = await axios.get(targetUrl, {
      responseType: "arraybuffer",
    });
    res.set("Content-Type", response.headers["content-type"]);
    res.send(response.data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Image proxy error");
  }
});

// ✅ LINE Webhook
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;
    if (!events?.length) return res.sendStatus(200);

    await Promise.all(events.map((event) => handleEvent(event)));
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ✅ イベント処理
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const userMessage = event.message.text.trim();
  console.log(`💬 Received from ${userId}: ${userMessage}`);

  if (userMessage === "問題") {
    try {
      const question = await getRandomQuestion();
      await sendQuestion(event.replyToken, question, userId);
    } catch (err) {
      console.error("❌ Error sending question:", err);
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "問題の取得に失敗しました。",
      });
    }
  } else if (/^[1-4]$/.test(userMessage)) {
    const questionId = userQuestions.get(userId);
    if (!questionId) {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "まず「問題」と送ってください。",
      });
      return;
    }

    const question = await getRandomQuestion();
    const choice = question.choices[Number(userMessage) - 1];
    const feedback = choice?.feedback || "不正解です。";

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: `あなたの答え: ${choice.answer}\n結果: ${feedback}`,
    });
  }
}

// ✅ サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
