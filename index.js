import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;      // e.g. https://ik1-449-56991.vs.sakura.ne.jp
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;
const PORT = process.env.PORT || 3000;

const pendingQuestions = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

const cleanText = (str = "") => {
  return String(str)
    .replace(/<[^>]+>/g, "")   // remove HTML tags
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
};

const sendLineReply = async (replyToken, messages) => {
  try {
    const res = await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      { replyToken, messages },
      { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    return res.data;
  } catch (err) {
    console.error("LINE API error:", err.response?.status, err.response?.data || err.message);
    throw err;
  }
};

const getRandomQuestionFromMoodle = async () => {
  const params = {
    wstoken: MOODLE_TOKEN,
    wsfunction: "local_questionapi_get_random_question",
    moodlewsrestformat: "json"
  };
  const res = await axios.get(`${MOODLE_URL}/webservice/rest/server.php`, { params, timeout: 10000 });
  return res.data;
};

app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events || [];
    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userId = (event.source && (event.source.userId || event.source.userId)) || event.source.userId || (event.source.userId ?? event.source.userId);
      const text = (event.message.text || "").trim();

      // request a question
      if (/^問題ちょうだい$|^問題ください$|^問題ちょうだい！$/i.test(text)) {
        try {
          const q = await getRandomQuestionFromMoodle();
          console.log("Moodle response:", q);

          if (!q || !q.id) {
            await sendLineReply(event.replyToken, [{ type: "text", text: "問題を取得できませんでした。" }]);
            continue;
          }

          const options = Array.isArray(q.options) ? q.options.map(o => ({ text: cleanText(o.text) })) : [];
          const correctIndex = Number.isInteger(q.correctindex) ? q.correctindex : null;
          const feedback = cleanText(q.feedback || "");

          // store session
          if (pendingQuestions.has(userId)) {
            clearTimeout(pendingQuestions.get(userId).timer);
            pendingQuestions.delete(userId);
          }
          const timer = setTimeout(() => pendingQuestions.delete(userId), PENDING_TTL_MS);
          pendingQuestions.set(userId, {
            questionId: q.id,
            options: options.map(o => o.text),
            correctIndex,
            feedback,
            timer
          });

          // reply text build
          let replyText = `【問題】\n${cleanText(q.questiontext)}\n\n【選択肢】\n`;
          const displayOptions = options.length ? options : [{ text: "選択肢がありません" }];
          displayOptions.slice(0, 10).forEach((opt, idx) => {
            replyText += `${idx + 1}. ${opt.text}\n`;
          });
          replyText += `\n番号で回答してください（例: 1）\n※有効時間: ${Math.floor(PENDING_TTL_MS/60000)}分`;

          await sendLineReply(event.replyToken, [{ type: "text", text: replyText }]);
          continue;
        } catch (err) {
          console.error("Failed to fetch question from Moodle:", err.response?.data || err.message);
          await sendLineReply(event.replyToken, [{ type: "text", text: "問題の取得でエラーが発生しました（管理者へ連絡）。" }]);
          continue;
        }
      }

      // answer by number
      const m = text.match(/^\s*([1-9])\s*$/);
      if (m) {
        const chosen = parseInt(m[1], 10);
        const session = pendingQuestions.get(userId);
        if (!session) {
          await sendLineReply(event.replyToken, [{ type: "text", text: "回答待ちの問題がありません。まず「問題ちょうだい」と送ってください。" }]);
          continue;
        }

        const userIndex = chosen - 1;
        const correctIndex = session.correctIndex;
        let resultText = "";

        if (correctIndex === null) {
          resultText = "この問題は正解情報がありません。";
        } else if (userIndex === correctIndex) {
          resultText = "✅ 正解です！\n";
        } else {
          const correctLabel = (correctIndex + 1) + ". " + (session.options[correctIndex] || "（表示不可）");
          resultText = `❌ 不正解です。\n正解：${correctLabel}\n`;
        }

        if (session.feedback) resultText += `\n【解説】\n${session.feedback}`;

        // clear session
        clearTimeout(session.timer);
        pendingQuestions.delete(userId);

        await sendLineReply(event.replyToken, [{ type: "text", text: resultText }]);
        continue;
      }

      // help / default
      await sendLineReply(event.replyToken, [{ type: "text", text: "「問題ちょうだい」と送ると問題を出します。回答は番号で送ってください（例: 1）。" }]);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("webhook handling error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
