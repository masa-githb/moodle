import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// 環境変数から設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;       // 例: https://ik1-449-56991.vs.sakura.ne.jp
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;   // 発行した Moodle トークン

// LINE 受信エンドポイント
app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      if (event.message.text === "問題ちょうだい") {
        try {
          // Moodle API 呼び出し
          const params = {
            wstoken: MOODLE_TOKEN,
            wsfunction: "local_questionapi_get_random_question",
            moodlewsrestformat: "json"
          };

          const response = await axios.get(`${MOODLE_URL}/webservice/rest/server.php`, { params });
          const data = response.data;
          console.log("Moodle response:", data);

          let replyText = "問題を取得できませんでした";

          if (data && data.id) {
            // HTMLタグを除去
            const cleanText = (str) => str.replace(/<[^>]+>/g, '').replace(/\n+/g, '\n').trim();

            replyText = `【問題】\n${cleanText(data.questiontext)}\n\n`;

            if (data.options && data.options.length > 0) {
              replyText += "【選択肢】\n";
              data.options.forEach((opt, idx) => {
                replyText += `${String.fromCharCode(65 + idx)}. ${cleanText(opt.text)}\n`;
              });
              replyText += "\n";
            }

            if (data.feedback) {
              replyText += `【解説】\n${cleanText(data.feedback)}\n`;
            }
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
          console.error("Moodle API Error:", error.message);
        }
      }
    }
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
