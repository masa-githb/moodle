const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("Hello from Render + GitHub!");
});

// Render が割り当てるポート番号を使う
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
