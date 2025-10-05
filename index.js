import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import cheerio from "cheerio";  // ← HTMLパース用 (npm install cheerio)

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// メモリで回答を保持（簡易版）
const userSession = {};

// ★ Render スリープ解除用ルート
app.get("/", (req, res) => {
  res.send("RENDER ACTIVE: OK");
});

// LINE webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));
  const events = req.body.events;

  for (let event of events) {
    console.log("Event type:", event.type, "Message:", event.message?.text);

    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      // ===========================
      // 問題取得
      // ===========================
      if (text === "問題ちょうだい") {
        try {
          const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
          console.log("Moodle API URL:", url);

          const response = await axios.get(url);
          const data = response.data;
          console.log("Moodle response:", JSON.stringify(data, null, 2));

          if (!data || !data.choices || data.choices.length === 0) {
            await replyLine(event.replyToken, [
              { type: "text", text: "問題を取得できませんでした。" }
            ]);
            continue;
          }

          // HTMLをパース
          const $ = cheerio.load(data.questiontext || "");
          const questionText = $.text().trim(); // タグ除去してテキスト抽出
          const imgUrl = $("img").attr("src");  // 最初の画像URL

          // ユーザーセッションに保存
          userSession[userId] = data;

          // 選択肢を番号付きで表示
          let messageText = `問題: ${questionText}\n`;
          data.choices.forEach((c, i) => {
            messageText += `${i + 1}. ${c.answer}\n`;
          });

          // LINE送信用メッセージ配列
          const messages = [{ type: "text", text: messageText }];

          // 画像がある場合は追加
          if (imgUrl) {
            messages.push({
              type: "image",
              originalContentUrl: imgUrl,
              previewImageUrl: imgUrl
            });
          }

          await replyLine(event.replyToken, messages);

        } catch (err) {
          console.error(err);
          await replyLine(event.replyToken, [
            { type: "text", text: "API エラーが発生しました。" }
          ]);
        }
      }

      // ===========================
      // 回答処理
      // ===========================
      else if (/^[1-9]\d*$/.test(text)) {
        const session = userSession[userId];
        if (!session) {
          await replyLine(event.replyToken, [
            { type: "text", text: "先に「問題ちょうだい」と送ってください。" }
          ]);
          continue;
        }

        const choiceIndex = parseInt(text, 10) - 1;
        if (choiceIndex < 0 || choiceIndex >= session.choices.length) {
          await replyLine(event.replyToken, [
            { type: "text", text: "番号が不正です。" }
          ]);
          continue;
        }

        const choice = session.choices[choiceIndex];
        const correct = choice.fraction > 0 ? "正解！" : "不正解…";
        const feedbacks = session.choices
          .map(c => `${c.answer}: ${c.feedback}`)
          .join("\n");

        await replyLine(event.replyToken, [
          { type: "text", text: `${correct}\n\n解説:\n${feedbacks}` }
        ]);

        // セッションをクリア
        delete userSession[userId];
      }
    }
  }

  res.sendStatus(200);
});

// ===========================
// LINE返信関数
// ===========================
async function replyLine(replyToken, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages },
    { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
