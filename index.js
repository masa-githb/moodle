// index.js (完全版)
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import he from "he";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const MOODLE_URL = process.env.MOODLE_URL.replace(/\/$/, ""); // 末尾スラッシュ除去
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const userSessions = new Map();

// HTML 文字列から画像 URL を抽出し、正規化して返す（なければ null）
// data 引数は Moodle が返した JSON（id, contextid 等が入っていれば利用）
function extractAndNormalizeImageUrl(rawHtml, data = {}) {
  if (!rawHtml) return null;
  // デコード（&lt; 等を復元）してからパースする
  const decoded = he.decode(rawHtml);
  const $ = cheerio.load(decoded);
  const img = $("img").first();
  if (!img || !img.attr("src")) return null;
  let src = img.attr("src").trim();

  // すでに完全 URL (http/https) ならそれを使う
  if (/^https?:\/\//i.test(src)) return src;

  // @@PLUGINFILE@@ の場合 -> webservice/pluginfile.php 経由の URL に変換（token 付与）
  if (src.startsWith("@@PLUGINFILE@@")) {
    // ファイル名部分だけ取り出す（@@PLUGINFILE@@/foo.png の形を期待）
    const filename = src.replace(/^@@PLUGINFILE@@\//, "");
    // 最も確実なのは、Moodle 側の外部関数で contextid などを返すことです（後述）
    if (data && data.contextid) {
      return `${MOODLE_URL}/webservice/pluginfile.php/${data.contextid}/question/questiontext/${data.id}/${encodeURIComponent(filename)}?token=${MOODLE_TOKEN}`;
    }
    // フォールバック（contextid が無い場合。場合によっては動かない）
    return `${MOODLE_URL}/webservice/pluginfile.php/1/question/questiontext/${data.id}/${encodeURIComponent(filename)}?token=${MOODLE_TOKEN}`;
  }

  // /pluginfile.php/... のような相対パスなら MOODLE_URL を付け token を付与
  if (src.startsWith("/pluginfile.php") || src.startsWith("/webservice/pluginfile.php")) {
    const prefix = src.startsWith("/webservice/pluginfile.php") ? "" : "";
    // 既にクエリがあるか確認
    const sep = src.includes("?") ? "&" : "?";
    return `${MOODLE_URL}${src}${sep}token=${MOODLE_TOKEN}`;
  }

  // 相対パス (/...) の一般的なケース
  if (src.startsWith("/")) {
    const sep = src.includes("?") ? "&" : "?";
    return `${MOODLE_URL}${src}${sep}token=${MOODLE_TOKEN}`;
  }

  // それ以外は null
  return null;
}

async function replyLine(replyToken, messages) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      { replyToken, messages: Array.isArray(messages) ? messages : [ { type: "text", text: messages } ] },
      {
        headers: {
          Authorization: `Bearer ${LINE_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("LINE reply error:", err.response?.data || err.message);
  }
}

async function fetchRandomQuestionFromMoodle() {
  const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
  try {
    const r = await axios.get(url, { timeout: 8000 });
    return r.data;
  } catch (err) {
    console.error("fetchRandomQuestionFromMoodle error:", err.response?.data || err.message);
    return null;
  }
}

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const userId = event.source.userId;
    const text = event.message.text.trim();

    if (text === "問題" || text === "問題ちょうだい") {
      const q = await fetchRandomQuestionFromMoodle();
      if (!q) {
        await replyLine(event.replyToken, { type: "text", text: "問題を取得できませんでした。" });
        continue;
      }

      // 画像 URL を抽出（外部関数が contextid 等を返していれば data に含める）
      const imageUrl = extractAndNormalizeImageUrl(q.questiontext, q);

      // 表示用の問題文（HTML タグ除去）
      const plain = he.decode(q.questiontext).replace(/<[^>]+>/g, "").trim();

      // 選択肢テキスト作成
      const choicesText = (q.choices || []).map((c, i) => `${i+1}. ${c.answer}`).join("\n");

      // セッションに保存（採点時に参照）
      userSessions.set(userId, q);

      const messages = [];
      if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        // LINE に送る画像は public な完全 URL であること
        messages.push({
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        });
      } else if (imageUrl) {
        console.log("No valid image URL for LINE (skipping image):", imageUrl);
      }

      messages.push({
        type: "text",
        text: `問題: ${plain}\n\n${choicesText}`
      });

      await replyLine(event.replyToken, messages);
      continue;
    }

    // 回答番号（1,2,...）
    if (/^\d+$/.test(text)) {
      const session = userSessions.get(event.source.userId);
      if (!session) {
        await replyLine(event.replyToken, { type: "text", text: "先に「問題ちょうだい」と送ってください。" });
        continue;
      }
      const idx = parseInt(text, 10) - 1;
      const choice = session.choices?.[idx];
      if (!choice) {
        await replyLine(event.replyToken, { type: "text", text: "その番号の選択肢はありません。" });
        continue;
      }
      const correct = (choice.fraction && Number(choice.fraction) > 0) ? true : false;
      const feedback = choice.feedback || "";
      await replyLine(event.replyToken, { type: "text", text: (correct ? "⭕ 正解！\n" : "❌ 不正解。\n") + (feedback ? `\n解説: ${feedback}` : "") });
      userSessions.delete(event.source.userId);
      continue;
    }

    // それ以外
    await replyLine(event.replyToken, { type: "text", text: '「問題ちょうだい」と送ると問題を出します。回答は「1」「2」などの番号で送ってください。' });
  }
  res.sendStatus(200);
});

// Renderでスリープ監視用
app.get("/", (req, res) => res.send("RENDER ACTIVE: OK"));

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
