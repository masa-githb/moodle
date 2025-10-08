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
const MOODLE_URL = process.env.MOODLE_URL; // 例: https://moodle-5f96.onrender.com
const TOKEN = process.env.MOODLE_TOKEN;    // Moodle Webサービスのトークン
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN; // LINE Messaging APIトークン

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

// ====== Moodleからクイズを取得 ======
async function fetchMoodleQuizzes() {
  try {
    const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${TOKEN}&wsfunction=core_course_get_courses&moodlewsrestformat=json`;
    const response = await axios.get(url);
    const courses = response.data;

    if (!Array.isArray(courses)) throw new Error("Moodleデータが不正です");

    const quizzes = [];
    for (const course of courses) {
      const modUrl = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${TOKEN}&wsfunction=core_course_get_contents&moodlewsrestformat=json&courseid=${course.id}`;
      const modRes = await axios.get(modUrl);

      for (const section of modRes.data) {
        for (const mod of section.modules || []) {
          if (mod.modname === "quiz") {
            quizzes.push({
              course: course.fullname,
              quizName: mod.name,
              quizUrl: mod.url,
            });
          }
        }
      }
    }
    return quizzes;
  } catch (err) {
    console.error("fetchMoodleQuizzes error:", err);
    return [];
  }
}

// ====== LINEへ返信 ======
async function replyMessage(replyToken, messages) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages,
      },
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

    // 「問題」「quiz」などでMoodleから取得
    if (text.includes("quiz") || text.includes("問題")) {
      const quizzes = await fetchMoodleQuizzes();
      if (quizzes.length === 0) {
        await replyMessage(event.replyToken, [
          { type: "text", text: "クイズが見つかりませんでした。" },
        ]);
        return res.sendStatus(200);
      }

      const quiz = quizzes[0];
      const page = await axios.get(quiz.quizUrl);
      const imgUrl = extractImageUrl(page.data);

      const messages = [
        {
          type: "text",
          text: `コース: ${quiz.course}\nクイズ: ${quiz.quizName}\nURL: ${quiz.quizUrl}`,
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

    // デフォルト返信
    await replyMessage(event.replyToken, [
      { type: "text", text: "「問題」または「quiz」と送るとMoodleのクイズを表示します。" },
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
