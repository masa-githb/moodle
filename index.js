// index.js
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// 環境変数から取得
const MOODLE_URL = process.env.MOODLE_URL; // Moodle サイト URL
const MOODLE_TOKEN = process.env.MOODLE_TOKEN; // Moodle 発行トークン
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN; // LINE BOT トークン

// LINE BOT の Webhook
app.post("/webhook", async (req, res) => {
  try {
    const replyToken = req.body?.events?.[0]?.replyToken;

    if (!replyToken) {
      console.log("replyToken がありません");
      return res.sendStatus(400);
    }

    // Moodle API に問題をリクエスト
    const params = {
      wstoken: MOODLE_TOKEN,
      wsfunction: "core_question_get_questions", // 使用したい関数に置き換え
      moodlewsrestformat: "json",
      // 他に必要なパラメータをここに追加
    };

    console.log("Moodle API リクエストパラメータ:", params);

    const response = await axios.get(MOODLE_URL + "/webservice/rest/server.php", {
      params
    });

    console.log("Moodle API response:", response.data);

    let messageText = "Moodleから問題を取得しました ✅";

    if (!response.data || response.data.exception) {
      console.log("Moodle API エラー:", response.data);
      messageText = "Moodleから問題を取得できませんでした 🙇‍♂️";
    }

    // LINE へ返信
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken: replyToken,
        messages: [{ type: "text", text: messageText }]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        }
      }
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("エラー:", err);
    res.sendStatus(500);
  }
});

// サーバ起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
