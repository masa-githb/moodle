import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import he from "he";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// ユーザーごとの問題セッションを保持
const userSession = {};

// ★ Render スリープ解除確認用
app.get("/", (req, res) => {
  res.send("RENDER ACTIVE: OK");
});

// デバッグ用ミドルウェア
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// LINE webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));
  const events = req.body.events;

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const text = event.message.text.trim();

      // --- 問題を要求 ---
      if (text === "問題ちょうだい") {
        try {
          const url = `${MOODLE_URL}?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
          console.log("Moodle API URL:", url);
          const response = await axios.get(url);
          const data = response.data;
          console.log("Moodle response:", JSON.stringify(data, null, 2));

          if (!data || !data.choices || data.choices.length === 0) {
            await replyLine(event.replyToken, "問題が見つかりませんでした。");
            continue;
          }

          // 問題文と画像を処理
          let questionText = he.decode(stripHtml(data.questiontext));
          let imageUrl = extractImageUrl(data.questiontext);
          if (!imageUrl) {
            console.log("No valid image found in:", data.questiontext);
          }

          // 選択肢
          let message = `問題: ${questionText}\n`;
          data.choices.forEach((c, i) => {
            message += `${i + 1}. ${c.answer}\n`;
          });

          // セッションに保存
          userSession[userId] = data;

          // LINE返信メッセージ生成
          const messages = [];
          if (imageUrl) {
            messages.push({
              type: "image",
              originalContentUrl: imageUrl,
              previewImageUrl: imageUrl,
            });
          }
          messages.push({ type: "text", text: message });

          await replyLine(event.replyToken, messages);
        } catch (err) {
          console.error(err);
          await replyLine(event.replyToken, "APIエラーが発生しました。");
        }
      }

      // --- 回答を送信した場合（数字） ---
      else if (/^[1-9]\d*$/.test(text)) {
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

        let feedbacks = session.choices
          .map(c => `${c.answer}: ${c.feedback || ""}`)
          .join("\n");

        await replyLine(event.replyToken, `${correct}\n\n解説:\n${feedbacks}`);

        delete userSession[userId]; // セッション削除
      }
    }
  }

  res.sendStatus(200);
});

// HTMLタグ除去
function stripHtml(html) {
  const $ = cheerio.load(html);
  return $.text().trim();
}

// 画像URL抽出（Googleリダイレクトも対応）
function extractImageUrl(html) {
  const $ = cheerio.load(html);
  const imgTag = $("img").attr("src");
  if (!imgTag) return null;

  let decoded = he.decode(imgTag);
  if (decoded.includes("https://www.google.com/url")) {
    const urlMatch = decoded.match(/url\?q=([^&]+)/);
    if (urlMatch && urlMatch[1]) {
      return decodeURIComponent(urlMatch[1]);
    }
  }
  return decoded;
}

// LINE返信関数
async function replyLine(replyToken, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: Array.isArray(messages) ? messages : [{ type: "text", text: messages }],
    },
    {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
