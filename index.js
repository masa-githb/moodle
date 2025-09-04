const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// 環境変数からトークンを取得
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;
const MOODLE_URL = "https://<MoodleサイトURL>/webservice/rest/server.php";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// LINE Webhook
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      const userMessage = event.message?.text;

      if (userMessage === "問題") {
        // Moodle API パラメータ
        const params = new URLSearchParams();
        params.append("wstoken", MOODLE_TOKEN);
        params.append("wsfunction", "mod_quiz_get_random_questions");
        params.append("moodlewsrestformat", "json");

        // Moodle API 呼び出し
        const response = await axios.post(MOODLE_URL, params);
        const questions = response.data.questions || [];

        if (questions.length === 0) {
          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: event.replyToken,
              messages: [
                { type: "text", text: "Moodleから問題を取得できませんでした 🙇‍♂️" },
              ],
            },
            { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
          );
          continue;
        }

        // 1問目を取得
        const q = questions[0];
        const text = `${q.questiontext}\nA) ${q.answers[0]}\nB) ${q.answers[1]}\nC) ${q.answers[2]}\nD) ${q.answers[3]}`;

        // LINEに返信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text }],
          },
          { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
        );
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// ポート設定
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
