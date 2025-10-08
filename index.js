// index.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MOODLE_URL = process.env.MOODLE_URL;
const TOKEN = process.env.MOODLE_TOKEN;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// --- ユーザーごとに最後に出した問題を保持する ---
const userSessions = new Map();

// ====== HTML内の画像URLを抽出 ======
function extractImageUrl(html) {
  try {
    const $ = cheerio.load(html);
    const img = $("img").first();
    if (!img.length) return null;

    let src = img.attr("src");
    if (!src) return null;

    if (src.startsWith("/")) {
      return `${MOODLE_URL}${src}`;
    }
    return src;
  } catch (err) {
    console.error("extractImageUrl error:", err);
    return null;
  }
}

// ====== Moodleからランダム問題を取得 ======
async function fetchRandomQuestion() {
  try {
    const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
    console.log("Moodle API URL:", url);

    const response = await axios.get(url);
    console.log("Moodle response:", response.data);

    return response.data;
  } catch (err) {
    console.error("fetchRandomQuestion error:", err.response?.data || err.message);
    return null;
  }
}

// ====== LINEへ返信 ======
async function replyMessage(replyToken, messages) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      { replyToken, messages },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
      }
    );
  } catch (err) {
    console.error("LINE reply error:", err.response?.data || err.message);
  }
}

// ====== Webhook受信 ======
app.post("/webhook", async (req, res) => {
  try {
    console.log("LINE Webhook received:", JSON.stringify(req.body, null, 2));

    const event = req.body.events?.[0];
    if (!event || !event.message?.text) return res.sendStatus(200);

    const userId = event.source.userId;
    const text = event.message.text.trim();

    // === 「問題」で出題 ===
    if (text.includes("問題")) {
      const question = await fetchRandomQuestion();
      if (!question || !question.questiontext) {
        await replyMessage(event.replyToken, [
          { type: "text", text: "問題が見つかりませんでした。" },
        ]);
        return res.sendStatus(200);
      }

      const imgUrl = extractImageUrl(question.questiontext);
      const cleanQuestion = question.questiontext.replace(/<[^>]+>/g, "");
      const choiceText = question.choices
        .map((c, i) => `${i + 1}. ${c.answer}`)
        .join("\n");

      // ユーザーに出題を記録
      userSessions.set(userId, question);
      console.log(`Stored question for ${userId}: ${question.id}`);

      const messages = [
        { type: "text", text: `【問題】\n${cleanQuestion}\n\n${choiceText}` },
      ];

      if (imgUrl) {
        messages.unshift({
          type: "image",
          originalContentUrl: imgUrl,
          previewImageUrl: imgUrl,
        });
      }

      await replyMessage(event.replyToken, messages);
      return res.sendStatus(200);
    }

    // === 回答チェック（1〜4など数字） ===
    if (/^\d+$/.test(text)) {
      const session = userSessions.get(userId);
      if (!session) {
        await replyMessage(event.replyToken, [
          { type: "text", text: "先に「問題」と送ってください。" },
        ]);
        return res.sendStatus(200);
      }

      const choiceIndex = parseInt(text) - 1;
      const choice = session.choices[choiceIndex];

      if (!choice) {
        await replyMessage(event.replyToken, [
          { type: "text", text: "その番号の選択肢はありません。" },
        ]);
        return res.sendStatus(200);
      }

      const isCorrect = choice.fraction === 1;
      const feedback = choice.feedback || "";

      const replyText = isCorrect
        ? `⭕ 正解！ ${feedback}`
        : `❌ 不正解。${feedback}`;

      await replyMessage(event.replyToken, [
        { type: "text", text: replyText },
      ]);

      // 回答後、セッション削除
      userSessions.delete(userId);
      return res.sendStatus(200);
    }

    // === その他 ===
    await replyMessage(event.replyToken, [
      { type: "text", text: "「問題」と送るとMoodleからランダムに問題を出します。" },
    ]);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ====== Render動作確認用 ======
app.get("/", (req, res) => {
  res.send("✅ LINE Moodle Bot is running and ready!");
});

// ====== 起動 ======
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
