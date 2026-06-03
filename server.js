require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const path = require("path");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const MerchantID = process.env.MERCHANT_ID || "1032429";
const HashKey = process.env.HASH_KEY;
const HashIV = process.env.HASH_IV;
const PORT = process.env.PORT || 3000;

function encodeOpay(raw) {
  return encodeURIComponent(raw)
    .toLowerCase()
    .replace(/%20/g, "+")
    .replace(/%21/g, "!")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2a/g, "*");
}

function createCheckMacValue(params) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const raw = `HashKey=${HashKey}&${sorted}&HashIV=${HashIV}`;
  const encoded = encodeOpay(raw);

  return crypto
    .createHash("sha256")
    .update(encoded)
    .digest("hex")
    .toUpperCase();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/create-payment", (req, res) => {
  if (!HashKey || !HashIV) {
    return res.status(500).send(`
      <h2>尚未設定 HashKey / HashIV</h2>
      <p>請先把 .env.example 改名成 .env，並填入你的 HASH_KEY 與 HASH_IV。</p>
      <p><a href="/">返回</a></p>
    `);
  }

  const amount = Number(req.body.amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).send("金額錯誤，請重新輸入。<br><a href='/'>返回</a>");
  }

  const orderId = "KBB" + dayjs().format("YYYYMMDDHHmmss");

  const params = {
    MerchantID,
    MerchantTradeNo: orderId,
    MerchantTradeDate: dayjs().format("YYYY/MM/DD HH:mm:ss"),
    PaymentType: "aio",
    TotalAmount: amount,
    TradeDesc: "歐買尬",
    ItemName: "金爸爸遊戲幣",
    ChoosePayment: "CVS",
    StoreExpireDate: 1,
    ReturnURL: "https://example.com/opay/notify",
    ClientBackURL: "https://example.com/payment-result",
    OrderResultURL: "https://example.com/payment-result",
    NeedExtraPaidInfo: "Y",
    EncryptType: 1
  };

  params.CheckMacValue = createCheckMacValue(params);

  let form = `<!doctype html><html><head><meta charset="utf-8"><title>前往歐買尬付款</title></head><body onload="document.forms[0].submit()"><p>正在前往歐買尬付款頁...</p><form method="POST" action="https://payment.opay.tw/Cashier/AioCheckOut">`;

  for (const key of Object.keys(params)) {
    form += `<input type="hidden" name="${key}" value="${String(params[key]).replace(/"/g, "&quot;")}">`;
  }

  form += `</form></body></html>`;
  res.send(form);
});

app.post("/opay/notify", (req, res) => {
  console.log("收到歐買尬付款通知：", req.body);
  res.send("1|OK");
});

app.get("/payment-result", (req, res) => {
  res.send("付款流程完成或已返回商店頁。<br><a href='/'>回首頁</a>");
});

app.listen(PORT, () => {
  console.log(`收款系統已啟動：http://localhost:${PORT}`);
});
