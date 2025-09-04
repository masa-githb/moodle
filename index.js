const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const app = express();
const response = await axios.post(moodleApiUrl, params);
console.log("Moodle API response:", response.data);

app.use(bodyParser.json());

// LINE Webhook
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;
    for (const event of events) {
      const userMessage = event.message?.text;
      if (userMessage === "問題") {
        // Moodle APIから問題を取得
        const moodleUrl = "https://tsurunosono2.xo.je//webservice/rest/server.php";
        const token = "f8f8efb53fcb7d27ee59dec66ea929e2";
        const response = await axios.get(moodleUrl, {
          params: {
            wstoken: token,
            wsfunction: "mod_quiz_get_random_questions",
            moodlewsrestformat: "json"
          }
        });

        const question = response.data[0]; // 1件取得
        const text = `${question.questiontext}\nA) ${question.answers[0]}\nB) ${question.answers[1]}\nC) ${question.answers[2]}\nD) ${question.answers[3]}`;

        // LINEに返信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text }]
          },
          { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
        );
      }
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// ポート
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
