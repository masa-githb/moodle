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

// ====== 画像URL抽出関数 ======
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

    const text = event.message.text.toLowerCase();

    // === 「問題」または「quiz」で出題 ===
    if (text.includes("問題") || text.includes("quiz")) {
      const question = await fetchRandomQuestion();
      if (!question || !question.questiontext) {
        await replyMessage(event.replyToken, [
          { type: "text", text: "問題が見つかりませんでした。" },
        ]);
        return res.sendStatus(200);
      }

      const imgUrl = extractImageUrl(question.questiontext);
      const choiceText = question.choices
        .map((c, i) => `${i + 1}. ${c.answer}`)
        .join("\n");

      const messages = [
        {
          type: "text",
          text: `${question.questiontext.replace(/<[^>]+>/g, "")}\n\n${choiceText}`,
        },
      ];

      if (imgUrl) {
        messages.push({
          type: "image",
          originalContentUrl: imgUrl,
          previewImageUrl: imgUrl,
        });
      }

      await replyMessage(event.replyToken, messages);
      return res.sendStatus(200);
    }

    // === 回答メッセージ ===
    if (/^\d+$/.test(text)) {
      await replyMessage(event.replyToken, [
        { type: "text", text: "回答を受け取りました。採点機能は開発中です。" },
      ]);
      return res.sendStatus(200);
    }

    // === デフォルト返信 ===
    await replyMessage(event.replyToken, [
      { type: "text", text: "「問題」と送るとMoodleからランダムで問題を出します。" },
    ]);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ====== 動作確認用 ======
app.get("/", (req, res) => {
  res.send("✅ LINE Moodle Bot is running.");
});

// ====== サーバー起動 ======
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
