import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// 環境変数から設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;      // 例: "https://your-moodle-site"
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;  // Moodle で発行したトークン

// LINE Webhook
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      if (event.message.text === "問題ちょうだい") {
        try {
          // Moodle API を呼び出し
          const params = {
            wstoken: MOODLE_TOKEN,
            wsfunction: "local_questionapi_get_random_question",
            moodlewsrestformat: "json"
          };

          const response = await axios.get(
            `${MOODLE_URL}/webservice/rest/server.php`,
            { params }
          );

          const data = response.data;
          console.log("Moodle response:", data);

          let replyText = "問題を取得できませんでした";

          if (data && data.id) {
            replyText = `問題: ${data.name}\n\n${data.questiontext}`;
          }

          // LINE に返信
          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: event.replyToken,
              messages: [{ type: "text", text: replyText }],
            },
            {
              headers: {
                Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
              },
            }
          );
        } catch (error) {
          console.error("Moodle API Error:", error.response?.data || error.message);
        }
      }
    }
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
