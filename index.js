// index.js (ログ強化版)
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
const MOODLE_URL = process.env.MOODLE_URL.replace(/\/$/, "");
const MOODLE_TOKEN = process.env.MOODLE_TOKEN;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const userSessions = new Map();

/**
 * HTML文字列から画像URLを抽出してMoodle用に正規化する
 */
function extractAndNormalizeImageUrl(rawHtml, data = {}) {
  if (!rawHtml) {
    console.log("🔸 extractImageUrl: rawHtml is empty");
    return null;
  }

  const decoded = he.decode(rawHtml);
  const $ = cheerio.load(decoded);
  const img = $("img").first();
  if (!img || !img.attr("src")) {
    console.log("🔸 extractImageUrl: no <img> tag found");
    return null;
  }

  let src = img.attr("src").trim();
  console.log(`🔍 extractImageUrl: raw src = ${src}`);

  let finalUrl = null;

  if (/^https?:\/\//i.test(src)) {
    finalUrl = src;
  } else if (src.startsWith("@@PLUGINFILE@@")) {
    const filename = src.replace(/^@@PLUGINFILE@@\//, "");
    const contextid = data.contextid || 1;
    const id = data.id || 0;
    finalUrl = `${MOODLE_URL}/webservice/pluginfile.php/${contextid}/question/questiontext/${id}/${encodeURIComponent(
      filename
    )}?token=${MOODLE_TOKEN}`;
  } else if (src.startsWith("/pluginfile.php") || src.startsWith("/webservice/pluginfile.php")) {
    const sep = src.includes("?") ? "&" : "?";
    finalUrl = `${MOODLE_URL}${src}${sep}token=${MOODLE_TOKEN}`;
  } else if (src.startsWith("/")) {
    const sep = src.includes("?") ? "&" : "?";
    finalUrl = `${MOODLE_URL}${src}${sep}token=${MOODLE_TOKEN}`;
  }

  console.log(`✅ extractImageUrl: normalized = ${finalUrl || "null"}`);
  return finalUrl;
}

/**
 * LINEに返信（安全処理付き）
 */
async function replyLine(replyToken, messages) {
  try {
    const payload = {
      replyToken,
      messages: Array.isArray(messages)
        ? messages
        : [{ type: "text", text: messages.text || String(messages) }],
    };

    // 空文字対策
    payload.messages = payload.messages.map((m) => ({
      type: m.type || "text",
      text: m.text?.trim() || "（空のメッセージ）",
      ...(m.type === "image" ? m : {}),
    }));

    console.log("📤 Sending to LINE:", JSON.stringify(payload, null, 2));

    await axios.post("https://api.line.me/v2/bot/message/reply", payload, {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("❌ LINE reply error:", err.response?.data || err.message);
  }
}

/**
 * Moodleからランダム問題を取得
 */
async function fetchRandomQuestionFromMoodle() {
  const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${MOODLE_TOKEN}&wsfunction=local_questionapi_get_random_question&moodlewsrestformat=json`;
  try {
    const r = await axios.get(url, { timeout: 8000 });
    console.log("📥 Moodle question fetched:", JSON.stringify(r.data, null, 2).slice(0, 500) + "...");
    return r.data;
  } catch (err) {
    console.error("❌ fetchRandomQuestionFromMoodle error:", err.response?.data || err.message);
    return null;
  }
}

/**
 * LINE Webhook メイン
 */
app.post("/webhook", async (req, res) => {
  const events = req.body.events || [];
  res.sendStatus(200);

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const userId = event.source.userId;
    const text = event.message.text.trim();

    console.log(`💬 Received from ${userId}: ${text}`);

    // === 「問題ちょうだい」 ===
    if (text === "問題" || text === "問題ちょうだい") {
      const q = await fetchRandomQuestionFromMoodle();
      if (!q) {
        await replyLine(event.replyToken, { text: "問題を取得できませんでした。" });
        continue;
      }

      // 画像URL抽出
      const imageUrl = extractAndNormalizeImageUrl(q.questiontext, q);

      // 問題文テキスト整形
      const plain = he
        .decode(q.questiontext)
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // 選択肢整形
      const choices = (q.choices || []).map((c) => ({
        ...c,
        answer: he.decode(c.answer || "").replace(/<[^>]+>/g, "").trim(),
      }));

      const choicesText =
        choices.length > 0
          ? choices.map((c, i) => `${i + 1}. ${c.answer}`).join("\n")
          : "選択肢がありません。";

      // ユーザーごとのセッションに保存
      userSessions.set(userId, q);

      const messages = [];

      // 画像付き
      if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
        console.log(`🖼️ Sending image: ${imageUrl}`);
        messages.push({
          type: "image",
          originalContentUrl: imageUrl,
          previewImageUrl: imageUrl,
        });
      } else {
        console.log("⚠️ No valid image URL found.");
      }

      messages.push({
        type: "text",
        text: `問題: ${plain}\n\n${choicesText}\n\n数字で答えてください。`,
      });

      await replyLine(event.replyToken, messages);
      continue;
    }

    // === 数字で回答 ===
    if (/^\d+$/.test(text)) {
      const session = userSessions.get(userId);
      if (!session) {
        await replyLine(event.replyToken, { text: "先に「問題ちょうだい」と送ってください。" });
        continue;
      }

      const idx = parseInt(text, 10) - 1;
      const choice = session.choices?.[idx];
      if (!choice) {
        await replyLine(event.replyToken, { text: "その番号の選択肢はありません。" });
        continue;
      }

      const correct = Number(choice.fraction) > 0;
      const feedback = he.decode(choice.feedback || "").replace(/<[^>]+>/g, "").trim();
      const result = correct ? "⭕ 正解！" : "❌ 不正解。";
      const feedbackText = feedback ? `\n\n解説: ${feedback}` : "";

      console.log(`🧩 Answer: ${text}, Correct = ${correct}`);

      await replyLine(event.replyToken, { text: `${result}${feedbackText}` });
      userSessions.delete(userId);
      continue;
    }

    // === その他 ===
    await replyLine(event.replyToken, {
      text: '「問題ちょうだい」と送ると問題を出します。回答は「1」「2」などの番号で送ってください。',
    });
  }
});

/**
 * Render監視用
 */
app.get("/", (req, res) => res.send("RENDER ACTIVE: OK"));

app.listen(PORT, () => console.log(`✅ Server running on PORT ${PORT}`));
