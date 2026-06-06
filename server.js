require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const MerchantID = process.env.MERCHANT_ID || "1032429";
const HashKey = process.env.HASH_KEY;
const HashIV = process.env.HASH_IV;
const PORT = process.env.PORT || 3000;

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(50) UNIQUE,
        amount INTEGER,
        payment VARCHAR(20),
        status VARCHAR(20),
        payment_no VARCHAR(100),
        bank_code VARCHAR(50),
        v_account VARCHAR(100),
        expire_date VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ PostgreSQL 已連線");
  } catch (err) {
    console.error("❌ PostgreSQL 錯誤", err);
  }
}

initDB();

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
  <title>填寫付款資料</title>
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
    <h2>訂單資料</h2>
    <table>
      <tr><td>商店名稱</td><td>金幣多</td></tr>
      <tr><td>商品名稱</td><td>金爸爸遊戲幣</td></tr>
      <tr><td>總計金額</td><td>${amount.toLocaleString()} 元</td></tr>
      <tr><td>付款方式</td><td>${payment === "ATM" ? "ATM 虛擬帳號" : "超商代碼"}</td></tr>
    </table>
  </div>

  <div class="box">
    <h2>付款人資訊</h2>

    <form method="POST" action="/submit-payment">
      <input type="hidden" name="amount" value="${amount}">
      <input type="hidden" name="payment" value="${payment}">

      <div class="row">
        <label><span class="red">*</span>姓名</label>
        <input name="name" required placeholder="請輸入姓名">
      </div>

      <div class="row">
        <label><span class="red">*</span>手機</label>
        <input name="phone" required placeholder="請輸入手機號碼">
      </div>

      <div class="row">
        <label><span class="red">*</span>電子信箱</label>
        <input name="email" type="email" required placeholder="請輸入電子郵件">
      </div>

      <button class="btn" type="submit">下一步</button>
    </form>
  </div>
</body>
</html>
  `);
});

app.post("/submit-payment", async (req, res) => {
  try {
    if (!HashKey || !HashIV) {
      return res.status(500).send(`
        <h2>尚未設定 HashKey / HashIV</h2>
        <p>請確認 Render Environment 已設定 HASH_KEY 與 HASH_IV。</p>
        <p><a href="/">返回</a></p>
      `);
    }

    const amount = Number(req.body.amount);
    const payment = req.body.payment === "ATM" ? "ATM" : "CVS";

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).send("金額錯誤，請重新輸入。<br><a href='/'>返回</a>");
    }

    const orderId = "KBB" + dayjs().format("YYYYMMDDHHmmss");

    await pool.query(
      `INSERT INTO orders 
      (order_id, amount, payment, status, payment_no, bank_code, v_account, expire_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId, amount, payment, "未付款", "", "", "", ""]
    );

    const params = {
      MerchantID,
      MerchantTradeNo: orderId,
      MerchantTradeDate: dayjs().format("YYYY/MM/DD HH:mm:ss"),
      PaymentType: "aio",
      TotalAmount: amount,
      TradeDesc: "OhMyGod Pay",
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
  <title>前往付款</title>
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
  } catch (err) {
    console.error("建立付款單錯誤：", err);
    res.status(500).send("建立付款單失敗，請稍後再試。<br><a href='/'>返回</a>");
  }
});

app.get("/api/opay/payment-info", (req, res) => {
  res.send("payment-info ok");
});

app.post("/api/opay/payment-info", async (req, res) => {
  try {
    console.log("收到歐買尬付款資訊：", req.body);

    const data = req.body;
    const orderId = data.MerchantTradeNo;

    await pool.query(
      `UPDATE orders
       SET payment_no=$1, bank_code=$2, v_account=$3, expire_date=$4
       WHERE order_id=$5`,
      [
        data.PaymentNo || data.CVSCode || data.CVSNo || "",
        data.BankCode || "",
        data.vAccount || data.VirtualAccount || "",
        data.ExpireDate || data.ExpireTime || "",
        orderId
      ]
    );

    res.send("1|OK");
  } catch (err) {
    console.error("更新付款資訊錯誤：", err);
    res.send("1|OK");
  }
});

app.post("/api/opay/notify", async (req, res) => {
  try {
    console.log("收到歐買尬付款通知：", req.body);

    const data = req.body;
    const orderId = data.MerchantTradeNo;

    await pool.query(
      `UPDATE orders
       SET status=$1
       WHERE order_id=$2`,
      [data.RtnCode === "1" ? "已付款" : "未付款", orderId]
    );

    res.send("1|OK");
  } catch (err) {
    console.error("更新付款狀態錯誤：", err);
    res.send("1|OK");
  }
});

app.post("/payment-info", async (req, res) => {
  try {
    console.log("歐買尬導回 payment-info：", req.body);

    const data = req.body;
    const orderId = data.MerchantTradeNo;

    const result = await pool.query(
      `SELECT * FROM orders WHERE order_id=$1`,
      [orderId]
    );

    res.send(renderPaymentInfo(data, result.rows[0]));
  } catch (err) {
    console.error("付款資訊頁錯誤：", err);
    res.status(500).send("付款資訊讀取失敗。<br><a href='/'>回首頁</a>");
  }
});

app.get("/payment-info", (req, res) => {
  res.send("請回到歐買尬付款頁面取得繳費代碼。<br><a href='/'>回首頁</a>");
});

app.get("/payment-result", (req, res) => {
  res.send("付款流程完成或已返回商店頁。<br><a href='/'>回首頁</a>");
});

function renderPaymentInfo(data, order) {
  const orderId = data.MerchantTradeNo || order?.order_id || "";
  const amount = data.TradeAmt || data.TotalAmount || order?.amount || "";
  const paymentType = data.PaymentType || data.PaymentTypeChargeFee || order?.payment || "";
  const paymentNo = data.PaymentNo || data.CVSCode || data.CVSNo || order?.payment_no || "";
  const bankCode = data.BankCode || order?.bank_code || "";
  const vAccount = data.vAccount || data.VirtualAccount || order?.v_account || "";
  const expireDate = data.ExpireDate || data.ExpireTime || order?.expire_date || "";

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>付款資訊</title>
  <style>
    body{font-family:"Microsoft JhengHei",Arial,sans-serif;background:#f3f4f6;padding:30px;}
    .box{max-width:600px;margin:40px auto;background:white;padding:30px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.1);}
    h2{text-align:center;}
    table{width:100%;border-collapse:collapse;margin-top:20px;}
    td{border-bottom:1px solid #ddd;padding:12px;}
    td:first-child{background:#f9fafb;width:35%;font-weight:bold;}
    .code{font-size:26px;font-weight:900;color:#dc2626;letter-spacing:1px;}
    a{display:block;text-align:center;margin-top:25px;}
  </style>
</head>
<body>
  <div class="box">
    <h2>付款資訊</h2>
    <table>
      <tr><td>訂單編號</td><td>${orderId}</td></tr>
      <tr><td>交易金額</td><td>${amount}</td></tr>
      <tr><td>付款方式</td><td>${paymentType}</td></tr>
      <tr><td>超商代碼</td><td class="code">${paymentNo}</td></tr>
      <tr><td>銀行代碼</td><td>${bankCode}</td></tr>
      <tr><td>虛擬帳號</td><td class="code">${vAccount}</td></tr>
      <tr><td>繳費期限</td><td>${expireDate}</td></tr>
    </table>
    <a href="/">回首頁</a>
  </div>
</body>
</html>
  `;
}

app.get("/admin/orders", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        order_id,
        amount,
        payment,
        status,
        payment_no,
        bank_code,
        v_account,
        expire_date,
        created_at
      FROM orders
      ORDER BY created_at DESC
    `);

    const rows = result.rows.map(order => `
      <tr>
        <td>${order.order_id}</td>
        <td>${Number(order.amount).toLocaleString()}</td>
        <td>${order.payment}</td>
        <td style="color:${order.status === "已付款" ? "green" : "red"}">
          ${order.status}
        </td>
        <td>${dayjs(order.created_at).format("YYYY/MM/DD HH:mm:ss")}</td>
      </tr>
    `).join("");

    res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>訂單後台</title>
<style>
body{
font-family:"Microsoft JhengHei";
background:#f3f4f6;
padding:20px;
}
.box{
max-width:1200px;
margin:auto;
background:white;
padding:20px;
border-radius:12px;
}
table{
width:100%;
border-collapse:collapse;
}
th,td{
border:1px solid #ddd;
padding:10px;
text-align:center;
}
th{
background:#f8fafc;
}
</style>
</head>
<body>
<div class="box">
<h2>訂單管理後台</h2>
<table>
<tr>
<th>訂單編號</th>
<th>金額</th>
<th>付款方式</th>
<th>付款狀態</th>
<th>建立時間</th>
</tr>
${rows}
</table>
</div>
</body>
</html>
`);
  } catch (err) {
    console.error("後台讀取訂單錯誤：", err);
    res.status(500).send("後台讀取失敗");
  }
});

app.listen(PORT, () => {
  console.log(`收款系統已啟動：http://localhost:${PORT}`);
});