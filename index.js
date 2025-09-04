import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// 環境変数から設定（Render の Environment Variables に入れる）
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL; // 例: "https://sandbox.moodledemo.net"
const MOODLE_TOKEN = process.env.MOODLE_TOKEN; // 発行したトークン

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
            wsfunction: "core_question_get_questions",
            moodlewsrestformat: "json",
            // 必要に応じて質問IDやカテゴリIDを指定
            questionids: [1]  // ←テスト用にID 1 を取得
          };

          const response = await axios.get(
            `${MOODLE_URL}/webservice/rest/server.php`,
            { params }
          );

          const data = response.data;
          console.log("Moodle response:", data);

          let replyText = "問題を取得できませんでした";

          if (data.questions && data.questions.length > 0) {
            const q = data.questions[0];
            replyText = `問題: ${q.name}\n\n${q.questiontext}`;
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
