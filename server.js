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
  const amount = Number(req.body.amount);
  const payment = req.body.payment === "ATM" ? "ATM" : "CVS";

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).send("金額錯誤，請重新輸入。<br><a href='/'>返回</a>");
  }

  res.redirect(`/receiving-info?amount=${amount}&payment=${payment}`);
});

app.get("/receiving-info", (req, res) => {
  const amount = Number(req.query.amount);
  const payment = req.query.payment === "ATM" ? "ATM" : "CVS";

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).send("金額錯誤，請重新輸入。<br><a href='/'>返回</a>");
  }

  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>填寫寄送資料 Receiving information</title>
  <style>
    body{margin:0;background:#eee;font-family:Arial,"Microsoft JhengHei",sans-serif;}
    .header{background:white;height:65px;border-bottom:1px solid #999;display:flex;align-items:center;padding-left:70px;font-size:26px;font-weight:bold;}
    .box{width:88%;max-width:1100px;margin:25px auto;background:white;padding:30px 40px;box-sizing:border-box;}
    h2{text-align:center;font-size:20px;margin-bottom:35px;}
    table{width:100%;border-collapse:collapse;margin-bottom:20px;}
    td{border-top:1px solid #ddd;border-bottom:1px solid #ddd;padding:12px;}
    td:first-child{background:#f3f3f3;width:25%;}
    .row{width:620px;max-width:100%;margin:20px auto;display:flex;align-items:center;}
    label{width:150px;}
    input{width:390px;padding:12px;border:1px solid #ccc;border-radius:4px;}
    .btn{display:block;margin:35px auto 0;background:#333;color:white;border:0;padding:12px 55px;border-radius:4px;cursor:pointer;}
    .red{color:red;}
  </style>
</head>
<body>
  <div class="header">OhMyGod 金流</div>

  <div class="box">
    <h2>填寫寄送資料 Receiving information</h2>

    <table>
      <tr>
        <td>商店名稱 Store</td>
        <td>金幣多</td>
      </tr>
      <tr>
        <td>商品名稱 Product</td>
        <td>金爸爸遊戲幣</td>
      </tr>
      <tr>
        <td>總計 Amount</td>
        <td>${amount.toLocaleString()}元</td>
      </tr>
    </table>
  </div>

  <div class="box">
    <h2>付款人資訊 Order Information</h2>

    <form method="POST" action="/submit-payment">
      <input type="hidden" name="amount" value="${amount}">
      <input type="hidden" name="payment" value="${payment}">

      <div class="row">
        <label><span class="red">*</span>姓名 Name</label>
        <input name="name" required placeholder="請輸入姓名">
      </div>

      <div class="row">
        <label><span class="red">*</span>手機 Cell phone</label>
        <input name="phone" required placeholder="請輸入手機號碼">
      </div>

      <div class="row">
        <label><span class="red">*</span>電子信箱 Email</label>
        <input name="email" type="email" required placeholder="請輸入電子郵件">
      </div>

      <button class="btn" type="submit">下一步</button>
    </form>
  </div>
</body>
</html>
  `);
});

app.post("/submit-payment", (req, res) => {
  if (!HashKey || !HashIV) {
    return res.status(500).send(`
      <h2>尚未設定 HashKey / HashIV</h2>
      <p>請確認 .env 或 Render Environment 已設定 HASH_KEY 與 HASH_IV。</p>
      <p><a href="/">返回</a></p>
    `);
  }

  const amount = Number(req.body.amount);
  const payment = req.body.payment === "ATM" ? "ATM" : "CVS";

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
    ChoosePayment: payment,

    ExpireDate: 1,
    StoreExpireDate: 1440,

    ReturnURL: "https://ohmygod-pay-api.onrender.com/api/opay/notify",
    ClientBackURL: "https://ohmygod-pay-api.onrender.com/payment-result",
    OrderResultURL: "https://ohmygod-pay-api.onrender.com/payment-result",
    PaymentInfoURL: "https://ohmygod-pay-api.onrender.com/api/opay/payment-info",
    ClientRedirectURL: "https://ohmygod-pay-api.onrender.com/payment-info",

    NeedExtraPaidInfo: "Y",
    EncryptType: 1
  };

  params.CheckMacValue = createCheckMacValue(params);

  let form = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>前往歐買尬付款</title>
</head>
<body onload="document.forms[0].submit()">
  <p>正在前往歐買尬付款頁...</p>
  <form method="POST" action="https://payment.funpoint.com.tw/Cashier/AioCheckOut/V5">
`;

  for (const key of Object.keys(params)) {
    form += `<input type="hidden" name="${key}" value="${String(params[key]).replace(/"/g, "&quot;")}">\n`;
  }

  form += `
  </form>
</body>
</html>
`;

  res.send(form);
});

app.get("/api/opay/notify", (req, res) => {
  res.send("notify ok");
});

app.get("/api/opay/payment-info", (req, res) => {
  res.send("payment-info ok");
});

app.post("/api/opay/notify", (req, res) => {
  console.log("收到歐買尬付款通知：", req.body);
  res.send("1|OK");
});

app.post("/api/opay/payment-info", (req, res) => {
  console.log("收到歐買尬付款資訊：", req.body);
  res.send("1|OK");
});

app.get("/payment-result", (req, res) => {
  res.send("付款流程完成或已返回商店頁。<br><a href='/'>回首頁</a>");
});

app.post("/payment-info", (req, res) => {
  console.log("歐買尬導回 payment-info：", req.body);
  res.send("付款資訊已建立，請依照歐買尬頁面指示完成付款。<br><a href='/'>回首頁</a>");
});

app.listen(PORT, () => {
  console.log(`收款系統已啟動：http://localhost:${PORT}`);
});