import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const MOODLE_URL = process.env.MOODLE_URL;
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;

// ★ Render スリープ解除確認用
app.get("/", (req, res) => {
  res.send("RENDER ACTIVE: OK");
});

// デバッグ用ミドルウェア（アクセスログ）
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

          let questionText = stripHtml(data.questiontext);
          let imageUrl = extractImageUrl(data.questiontext);

          let message = `問題: ${questionText}\n`;
          data.choices.forEach((c, i) => {
            message += `${i + 1}. ${c.answer}\n`;
          });

          const messages = [{ type: "text", text: message }];
          if (imageUrl) {
            messages.unshift({
              type: "image",
              originalContentUrl: imageUrl,
              previewImageUrl: imageUrl,
            });
          }

          await replyLine(event.replyToken, messages);
        } catch (err) {
          console.error(err);
          await replyLine(event.replyToken, "APIエラーが発生しました。");
        }
      }
    }
  }

  res.sendStatus(200);
});

function stripHtml(html) {
  const $ = cheerio.load(html);
  return $.text().trim();
}

function extractImageUrl(html) {
  const $ = cheerio.load(html);
  const img = $("img").attr("src");
  return img || null;
}

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
