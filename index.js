import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import * as cheerio from "cheerio"; // ← 修正ポイント
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// 環境変数
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// 簡易メモリセッション
const userSession = {};

// LINE 署名検証は省略（Renderなど無料サーバー用に軽量化）
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      // メッセージイベントのみ処理
      if (event.type === "message" && event.message.type === "text") {
        const userMessage = event.message.text.trim();
        const userId = event.source.userId;

        // ユーザーセッションの初期化
        if (!userSession[userId]) {
          userSession[userId] = {};
        }

        if (userMessage === "問題") {
          // Moodle から問題を取得
          const question = await getRandomQuestionFromMoodle();

          // LINEで表示しやすい形式に整形
          const cleanQuestion = formatQuestionText(question);

          // ユーザーセッションに保存
          userSession[userId].question = question;

          await replyMessage(event.replyToken, cleanQuestion);
        } else if (userSession[userId].question) {
          // 回答チェック
          const isCorrect = checkAnswer(userSession[userId].question, userMessage);
          const reply = isCorrect ? "⭕正解です！" : "❌不正解です。";
          await replyMessage(event.replyToken, reply);

          // セッションをリセット
          delete userSession[userId].question;
        } else {
          await replyMessage(event.replyToken, "「問題」と送るとクイズが始まります！");
        }
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).send("Error");
  }
});

// Moodleからランダム問題を取得
async function getRandomQuestionFromMoodle() {
  const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${MOODLE_TOKEN}&wsfunction=mod_quiz_get_quizzes_by_courses&moodlewsrestformat=json`;
  const res = await axios.get(url);
  const quizzes = res.data.quizzes;

  if (!quizzes || quizzes.length === 0) {
    return { questiontext: "問題が見つかりませんでした。" };
  }

  // とりあえず最初のクイズの問題を取得（API制限のため簡略）
  const quiz = quizzes[0];

  const quizUrl = `${MOODLE_URL}/mod/quiz/view.php?id=${quiz.id}`;
  const html = (await axios.get(quizUrl)).data;
  const $ = cheerio.load(html);

  // Moodleの問題本文を抽出
  const question = $("div.qtext").first().html() || "問題が見つかりません。";

  return { questiontext: question, answer: "海（例）" }; // テスト用
}

// HTMLをLINE表示用テキストに変換
function formatQuestionText(question) {
  const $ = cheerio.load(question.questiontext);
  $("img").each((i, el) => {
    const src = $(el).attr("src");
    if (src && !src.startsWith("http")) {
      $(el).attr("src", `${MOODLE_URL}/${src}`);
    }
  });

  // HTMLタグを除去し、LINEで文字化けしないようデコード
  const text = $.text().replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

  return `問題：${text}`;
}

// 回答チェック（仮）
function checkAnswer(question, userAnswer) {
  return userAnswer.includes(question.answer);
}

// LINE返信関数
async function replyMessage(replyToken, text) {
  const url = "https://api.line.me/v2/bot/message/reply";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
  };

  const body = {
    replyToken,
    messages: [{ type: "text", text }],
  };

  await axios.post(url, body, { headers });
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
