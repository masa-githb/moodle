// index.js
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// 環境変数からトークンを取得
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// Moodle API URL
const MOODLE_URL = "https://tsurunosono2.xo.je/webservice/rest/server.php";

// LINE メッセージ送信関数
async function replyToLine(replyToken, message) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken: replyToken,
        messages: [{ type: "text", text: message }],
      },
      {
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error("LINE API error:", err.response?.data || err.message);
  }
}

// LINE webhook
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // LINE に200を返す

  const events = req.body.events;
  if (!events) return;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      if (userMessage.toLowerCase() === "問題") {
        try {
          // Moodle API リクエストパラメータ
          const params = new URLSearchParams();
          params.append("wstoken", MOODLE_TOKEN);
          params.append("wsfunction", "mod_quiz_get_random_questions"); // Moodleで有効な関数名に変更
          params.append("moodlewsrestformat", "json");

          // Moodle API へリクエスト
          const response = await axios.post(MOODLE_URL, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });

          console.log("Moodle API response:", response.data);

          const questions = response.data.questions;
          if (!questions || questions.length === 0) {
            await replyToLine(replyToken, "Moodleから問題を取得できませんでした 🙇‍♂️");
            continue;
          }

          const question = questions[0]; // とりあえず最初の問題を取得
          const questionText = question.questiontext || "問題文がありません";
          await replyToLine(replyToken, `問題: ${questionText}`);

          // 選択肢がある場合
          if (question.answers) {
            const choices = question.answers.map((a, i) => `${i + 1}. ${a.answertext}`).join("\n");
            await replyToLine(replyToken, `選択肢:\n${choices}`);
          }

        } catch (err) {
          console.error("Moodle API error:", err.response?.data || err.message);
          await replyToLine(replyToken, "Moodleから問題を取得できませんでした 🙇‍♂️");
        }
      } else {
        await replyToLine(replyToken, "「問題」と送るとクイズが返ってきます");
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
