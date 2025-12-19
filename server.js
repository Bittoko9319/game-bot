import express from "express";
import line from "@line/bot-sdk";

const app = express();

// Render 會提供 PORT
const PORT = process.env.PORT || 3000;

// 你要在 Render 設定這兩個環境變數
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

if (!config.channelAccessToken || !config.channelSecret) {
  console.warn("Missing LINE env vars. Set LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET.");
}

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// 讓 LINE Verify（GET）也能拿到 200
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).send("OK"));

function parseOrderText(text) {
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

  return { game, raw: rawItems, items, total };
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

function flexPaymentCard({ game, items, total, orderId }) {
  return {
    type: "flex",
    altText: "付款確認",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "🧾 付款確認", weight: "bold", size: "xl" },
          { type: "text", text: "請確認金額無誤後再匯款", size: "sm", wrap: true },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              { type: "text", text: `遊戲：${game}`, wrap: true },
              { type: "text", text: `明細：${itemsText(items)}`, wrap: true },
              { type: "text", text: `應付總額：${total}`, weight: "bold", size: "lg", wrap: true },
              { type: "text", text: `訂單編號：${orderId}`, size: "sm", wrap: true, color: "#666666" }
            ]
          },
          { type: "text", text: "⚠️ 未收到款項前不會進行儲值", size: "xs", wrap: true, color: "#888888", margin: "md" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            action: { type: "postback", label: "💰 我已付款", data: `action=paid&orderId=${orderId}` }
          },
          {
            type: "button",
            style: "secondary",
            action: { type: "postback", label: "🔢 回傳帳號末五碼", data: `action=last5&orderId=${orderId}` }
          }
        ]
      }
    }
  };
}

// LINE webhook（POST）一定要 200 快速回
app.post(
  "/webhook",
  express.json({ verify: line.middleware(config) }),
  async (req, res) => {
    // 先立刻回 200，避免 timeout
    res.sendStatus(200);

    try {
      const events = req.body.events || [];
      for (const ev of events) {
        // 文字訊息：解析成訂單→回確認卡
        if (ev.type === "message" && ev.message?.type === "text") {
          const text = (ev.message.text || "").trim();
          const parsed = parseOrderText(text);

          if (!parsed) {
            await client.replyMessage({
              replyToken: ev.replyToken,
              messages: [
                {
                  type: "text",
                  text:
                    "我看不太懂格式～請用：\n遊戲名 + 空格 + 面額*數量（可多組）\n例：逆水寒 2500*10 170*5 240*1",
                },
              ],
            });
            continue;
          }

          const orderId = makeOrderId(parsed.game);

          await client.replyMessage({
            replyToken: ev.replyToken,
            messages: [flexPaymentCard({ ...parsed, orderId })],
          });
          continue;
        }

        // 按鈕 postback：先回提示（先做 MVP，不做記帳）
        if (ev.type === "postback") {
          const data = ev.postback?.data || "";
          if (data.includes("action=paid")) {
            await client.replyMessage({
              replyToken: ev.replyToken,
              messages: [{ type: "text", text: "收到～請回覆帳號末五碼（5位數字），例如：12345" }],
            });
          } else if (data.includes("action=last5")) {
            await client.replyMessage({
              replyToken: ev.replyToken,
              messages: [{ type: "text", text: "請直接輸入 5 位數字末五碼（例如：12345）" }],
            });
          }
        }
      }
    } catch (err) {
      console.error("Webhook handler error:", err);
    }
  }
);

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
