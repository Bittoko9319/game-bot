import express from "express";
import line from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// LINE 設定（從 Render 的 Environment Variables 讀）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// 基本檢查（避免沒設變數還一直 timeout）
if (!config.channelAccessToken || !config.channelSecret) {
  console.error("❌ Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET");
}

// LINE Client
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// ====== 基本健康檢查（給 Render / 瀏覽器用） ======
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).send("OK"));

// ====== 工具：解析訂單文字 ======
function parseOrderText(text) {
  // 支援：
  // 逆水寒 2500*10 170*5 240*1
  // 或
  // 逆水寒
  // 2500*10 170*5 240*1
  const lines = text.trim().split(/\n+/).map(s => s.trim()).filter(Boolean);

  let game = "";
  let rawItems = "";

  if (lines.length >= 2) {
    game = lines[0];
    rawItems = lines.slice(1).join(" ");
  } else {
    const parts = text.trim().split(/\s+/);
    game = parts.shift() || "";
    rawItems = parts.join(" ");
  }

  const pairs = rawItems.match(/\d+\s*[*xX]\s*\d+/g) || [];
  if (!game || pairs.length === 0) return null;

  const items = [];
  let total = 0;

  for (const p of pairs) {
    const m = p.replace(/\s+/g, "").match(/^(\d+)[*xX](\d+)$/);
    if (!m) continue;
    const amount = parseInt(m[1], 10);
    const qty = parseInt(m[2], 10);
    const sub = amount * qty;
    total += sub;
    items.push({ amount, qty, sub });
  }

  if (items.length === 0) return null;
  return { game, items, total };
}

function makeOrderId(game) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `${game}-${yyyy}${mm}${dd}-${rand}`;
}

function itemsText(items) {
  return items.map(it => `${it.amount}×${it.qty}=${it.sub}`).join("、");
}

//
