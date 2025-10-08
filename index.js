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
const MOODLE_URL = process.env.MOODLE_URL; // MoodleのトップURL (例: https://moodle-5f96.onrender.com)
const TOKEN = process.env.MOODLE_TOKEN;    // MoodleのWebサービス用トークン

// ====== 画像URL抽出関数 ======
function extractImageUrl(html) {
  try {
    const $ = cheerio.load(html);
    // Moodleの画像は /pluginfile.php や /draftfile.php の場合が多い
    const img = $("img").first();
    if (img.length) {
      let src = img.attr("src");
      if (!src) return null;
      if (src.startsWith("/")) {
        // Moodleの相対パス対応
        return `${MOODLE_URL}${src}`;
      }
      return src;
    }
    return null;
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

    if (!Array.isArray(courses)) {
      throw new Error("Moodleからのデータが不正です");
    }

    // すべてのコースからクイズ情報を取得
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

// ====== LINE Botのメインエンドポイント ======
app.post("/webhook", async (req, res) => {
  try {
    console.log("LINE Webhook received:", JSON.stringify(req.body, null, 2));

    const event = req.body.events?.[0];
    if (!event || !event.message?.text) {
      return res.sendStatus(200);
    }

    const userMessage = event.message.text.toLowerCase();
    if (userMessage.includes("quiz")) {
      const quizzes = await fetchMoodleQuizzes();

      if (quizzes.length === 0) {
        return res.json({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: "クイズが見つかりませんでした。" }],
        });
      }

      // 最初のクイズを取得
      const firstQuiz = quizzes[0];

      // クイズページをHTMLとして取得
      const page = await axios.get(firstQuiz.quizUrl);
      const imgUrl = extractImageUrl(page.data);

      const messageText = `コース名: ${firstQuiz.course}\nクイズ: ${firstQuiz.quizName}\nURL: ${firstQuiz.quizUrl}`;
      const messages = [{ type: "text", text: messageText }];

      if (imgUrl) {
        messages.push({ type: "image", originalContentUrl: imgUrl, previewImageUrl: imgUrl });
      }

      return res.json({
        replyToken: event.replyToken,
        messages,
      });
    }

    // デフォルト返信
    res.json({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "「quiz」と送信するとMoodleのクイズを取得します。" }],
    });
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
