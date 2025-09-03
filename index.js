const express = require("express");
const bodyParser = require("body-parser");
const app = express();

// JSONパース用
app.use(bodyParser.json());

// テスト用 GET
app.get("/", (req, res) => {
  res.send("Hello from Render + GitHub!");
});

// LINE Webhook 用 POST
app.post("/webhook", (req, res) => {
  console.log("LINEからのWebhook:", req.body);
  res.status(200).send("OK");
});

// ポート設定
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
