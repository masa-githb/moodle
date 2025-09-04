import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const MOODLE_TOKEN = process.env.MOODLE_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL; // https://tsurunosono2.xo.je/webservice/rest/server.php
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

app.post("/webhook", async (req, res) => {
  const replyToken = req.body?.events?.[0]?.replyToken;

  if (!replyToken) {
    return res.sendStatus(400);
  }

  try {
    // Moodle API へ問題リクエスト
    const moodleResponse = await axios.get(MOODLE_URL, {
      params: {
        wstoken: MOODLE_TOKEN,
        wsfunction: "mod_quiz_get_random_questions",
        quizid: 1,
        moodlewsrestformat: "json"
      }
    });

    const questions = moodleResponse.data?.questions || [];
    let text = "Moodleから問題を取得できませんでした 🙇‍♂️";

    if (questions.length > 0) {
      text = `問題: ${questions[0].questiontext}\n選択肢: ${questions[0].answers.map(a => a.answer).join(", ")}`;
    }

    // LINE へ返信
    await axios.post("https://api.line.me/v2/bot/message/reply", {
      replyToken,
      messages: [{ type: "text", text }]
    }, {
      headers: { Authorization: `Bearer ${LINE_TOKEN}`, "Content-Type": "application/json" }
    });

    res.sendStatus(200);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
