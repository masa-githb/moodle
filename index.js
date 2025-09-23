import express from "express";
import axios from "axios";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// メモリで回答を保持（簡易版）
const userSession = {};

app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));  // ★ログ追加
  const events = req.body.events;

  for (let event of events) {
    console.log("Event type:", event.type, "Message:", event.message?.text);  // ★ログ追加
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      if (text === "問題ちょうだい") {
        try {
          const response = await axios.get(`${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`);
          const data = response.data;

          if (!data || !data.choices || data.choices.length === 0) {
            await replyLine(event.replyToken, "問題を取得できませんでした。");
            continue;
          }

          // ユーザーセッションに保存
          userSession[userId] = data;

          // 選択肢を番号付きで表示
          let message = `問題: ${data.questiontext}\n`;
          data.choices.forEach((c, i) => {
            message += `${i+1}. ${c.answer}\n`;
          });

          await replyLine(event.replyToken, message);

        } catch (err) {
          console.error(err);
          await replyLine(event.replyToken, "API エラーが発生しました。");
        }
      }
      else if (/^[1-9]\d*$/.test(text)) {
        // 回答番号
        const session = userSession[userId];
        if (!session) {
          await replyLine(event.replyToken, "先に「問題ちょうだい」と送ってください。");
          continue;
        }

        const choiceIndex = parseInt(text, 10) - 1;
        if (choiceIndex < 0 || choiceIndex >= session.choices.length) {
          await replyLine(event.replyToken, "番号が不正です。");
          continue;
        }

        const choice = session.choices[choiceIndex];
        const correct = choice.fraction > 0 ? "正解！" : "不正解…";
        const feedbacks = session.choices.map(c => `${c.answer}: ${c.feedback}`).join("\n");

        await replyLine(event.replyToken, `${correct}\n\n解説:\n${feedbacks}`);

        // セッションをクリア
        delete userSession[userId];
      }
    }
  }

  res.sendStatus(200);
});

async function replyLine(replyToken, message) {
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: message }]
  }, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
