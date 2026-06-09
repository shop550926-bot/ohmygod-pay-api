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

  buyer_name VARCHAR(100),
  buyer_phone VARCHAR(50),
  buyer_email VARCHAR(150),

  payment_no VARCHAR(100),
  bank_code VARCHAR(50),
  v_account VARCHAR(100),

  trade_no VARCHAR(100),

  expire_date VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
)
    `);

    // 刪除7天前訂單
    await pool.query(`
      DELETE FROM orders
      WHERE created_at < NOW() - INTERVAL '7 days'
    `);
await pool.query(`
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS trade_no VARCHAR(100)
`);

await pool.query(`
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS store_id VARCHAR(50)
`);

await pool.query(`
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS store_name VARCHAR(100)
`);

await pool.query(`
UPDATE orders
SET status='OK'
WHERE status='已付款'
`);

await pool.query(`
UPDATE orders
SET status='NO'
WHERE status='未付款'
`);

console.log("✅ PostgreSQL 已連線");
console.log("✅ 已清除7天前訂單");

  } catch (err) {
    console.error("❌ PostgreSQL 錯誤", err);
  }
}

initDB();

const cron = require("node-cron");

cron.schedule("0 0 * * *", async () => {
  try {

    const result = await pool.query(`
      DELETE FROM orders
      WHERE created_at < NOW() - INTERVAL '7 days'
    `);

    console.log(`✅ 已清除 ${result.rowCount} 筆7天前訂單`);

  } catch (err) {
    console.error("自動清理失敗", err);
  }
});

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
  (
    order_id,
    amount,
    payment,
    status,
    buyer_name,
    buyer_phone,
    buyer_email,
    payment_no,
    bank_code,
    v_account,
    expire_date
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [
    orderId,
    amount,
    payment,
    "NO",
    req.body.name || "",
    req.body.phone || "",
    req.body.email || "",
    "",
    "",
    "",
    ""
  ]
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
   SET payment_no=$1,
    bank_code=$2,
    v_account=$3,
    expire_date=$4,
    trade_no=$5,
    store_id=$6,
    store_name=$7
WHERE order_id=$8

  [
  data.PaymentNo || data.CVSCode || data.CVSNo || "",
  data.BankCode || "",
  data.ATMAccNo || data.VirtualAccount || data.vAccount || data.PaymentNo || "",
  data.ExpireDate || data.ExpireTime || "",
  data.TradeNo || data.OTradeNo || "",

  data.CVSStoreID || "",
  data.CVSStoreName || "",

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
      [
        data.RtnCode === "1" ? "OK" : "NO",
        orderId
      ]
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
  const paymentNo = data.PaymentNo || data.CVSCode || data.CVSNo || order?.payment_no || "";
  const bankCode = data.BankCode || order?.bank_code || "";
  const vAccount =
  bankCode
    ? (
        data.ATMAccNo ||
        data.vAccount ||
        data.VirtualAccount ||
        order?.v_account ||
        ""
      )
    : "";
  const expireDate = data.ExpireDate || data.ExpireTime || order?.expire_date || "";
 const copyValue = vAccount || paymentNo;

const bankName =
bankCode === "007"
? "第一銀行"
: bankCode === "822"
? "中國信託"
: "";

  return `
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>付款資訊</title>
<style>
*{box-sizing:border-box;font-family:"Microsoft JhengHei",Arial,sans-serif;}
body{margin:0;padding:20px;background:#f3f4f6;}
.card{max-width:500px;margin:20px auto;background:white;border-radius:20px;padding:25px;box-shadow:0 10px 30px rgba(0,0,0,.08);}
.success{text-align:center;font-size:26px;font-weight:900;color:#16a34a;margin-bottom:20px;}
.label{font-size:16px;font-weight:900;color:#374151;margin-bottom:8px;text-align:center;}
.code-box{background:#f9fafb;border:2px solid #f59e0b;border-radius:16px;padding:18px;text-align:center;margin-bottom:15px;}
.code{
  font-size:22px;
  font-weight:900;
  color:#dc2626;
  word-break:break-all;
  line-height:1.8;
}
.copy-btn{width:100%;height:54px;border:0;border-radius:14px;background:#16a34a;color:white;font-size:18px;font-weight:900;cursor:pointer;}
.info{margin-top:20px;background:#f9fafb;padding:18px;border-radius:16px;}
.row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #e5e7eb;padding:10px 0;font-size:15px;}
.row span:first-child{color:#6b7280;}
.row span:last-child{font-weight:800;text-align:right;word-break:break-all;}
.home-btn{display:block;width:100%;margin-top:20px;height:54px;line-height:54px;text-align:center;background:#f59e0b;color:#111827;text-decoration:none;font-weight:900;border-radius:14px;}
</style>
</head>

<body>
<div class="card">

  <div class="success">✅ 訂單建立成功</div>

 

<div class="code-box">
<div class="code" id="copyText">
${bankCode
  ? `銀行：${bankCode} ${bankName}<br>帳號：${vAccount}`
  : `${paymentNo}`}
</div>
</div>

  <button class="copy-btn" onclick="copyCode()">📋 一鍵複製</button>


  <div class="info">
    <div class="row"><span>訂單編號</span><span>${orderId}</span></div>
    <div class="row"><span>交易金額</span><span>${amount} 元</span></div>
    <div class="row"><span>付款方式</span><span>${vAccount ? "ATM 虛擬帳號" : "超商代碼"}</span></div>
    <div class="row"><span>繳費期限</span><span>${expireDate || "-"}</span></div>
  </div>

  <a href="/" class="home-btn">返回首頁</a>

</div>

<script>

function copyCode(){

  const text =
    document.getElementById("copyText").innerText;

  navigator.clipboard.writeText(text);

  const btn = document.querySelector(".copy-btn");

  btn.innerHTML = "✅ 已複製";

  setTimeout(() => {
    btn.innerHTML = "📋 一鍵複製";
  }, 2000);

}

</script>

</body>
</html>
`;
}

app.get("/admin/orders", async (req, res) => {
  try {
    const keyword = req.query.keyword || "";
const status = req.query.status || "all";
const payment = req.query.payment || "all";

    let query = `
      SELECT 
  order_id,
  amount,
  payment,
  status,
  buyer_name,
  buyer_phone,
  buyer_email,
  payment_no,
  bank_code,
  v_account,
  trade_no,
store_id,
store_name,
expire_date,
created_at
FROM orders
      WHERE 1=1
    `;

    const values = [];

    if (keyword) {
      values.push(`%${keyword}%`);
      query += ` AND order_id ILIKE $${values.length}`;
    }

    if (payment !== "all") {
  values.push(payment);
  query += ` AND payment = $${values.length}`;
}

if (status !== "all") {
  values.push(status);
  query += ` AND status = $${values.length}`;
}
    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);

const statResult = await pool.query(`
  SELECT
    COUNT(*)::int AS total_orders,
    COUNT(*) FILTER (WHERE status = 'OK')::int AS paid_orders,
    COUNT(*) FILTER (WHERE status != 'OK')::int AS unpaid_orders,
    COALESCE(SUM(amount) FILTER (WHERE status = 'OK'), 0)::int AS paid_amount
  FROM orders
  WHERE created_at::date = CURRENT_DATE
`);

const stats = statResult.rows[0];

const monthResult = await pool.query(`
  SELECT
    COALESCE(SUM(amount),0)::int AS month_amount
  FROM orders
  WHERE status='OK'
  AND DATE_TRUNC('month',created_at)=DATE_TRUNC('month',NOW())
`);

const totalResult = await pool.query(`
  SELECT
    COALESCE(SUM(amount),0)::int AS total_amount
  FROM orders
  WHERE status='OK'
`);

const monthAmount = monthResult.rows[0].month_amount;
const totalAmount = totalResult.rows[0].total_amount;

   const rows = result.rows.map(order => `
  <tr>

<td>${order.order_id}</td>

<td>${order.buyer_name || "-"}</td>

<td>
${order.payment_no || order.v_account || "-"}
</td>

<td>
${Number(order.amount).toLocaleString()}
</td>

<td>
${order.payment}
</td>

<td>
<span class="status ${
order.status === "OK"
? "paid"
: "unpaid"
}">
${order.status}
</span>
</td>

<td>
${dayjs(order.created_at).format("YYYY/MM/DD HH:mm:ss")}
</td>

<td>
${order.payment === "CVS"
  ? `${order.store_id || order.payment_no || "-"}<br>${order.store_name || ""}`
  : `${order.bank_code || ""}<br>${order.v_account || "-"}`
}
</td>

<td>
<a class="view-btn" href="/admin/order/${order.order_id}">
查看
</a>
</td>

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
  background:#fdf2f8;
  padding:30px;
}
.box{
  max-width:1200px;
  margin:auto;
  background:white;
  padding:24px;
  border-radius:16px;
}
h2{
  margin-top:0;
}
.stats{
  display:grid;
  grid-template-columns:repeat(6,1fr);
  gap:12px;
}
.card{
  background:white;
  border:2px solid #fbcfe8;
  padding:16px;
  border-radius:12px;
  text-align:center;
  font-weight:900;
}
.card span{
  display:block;
  margin-top:8px;
  font-size:24px;
}
.search{
  display:flex;
  gap:10px;
  margin-bottom:20px;
}
.search input,.search select{
  height:44px;
  padding:0 12px;
  border:1px solid #ddd;
  border-radius:8px;
  font-size:16px;
}
.search input{
  flex:1;
}
.search button{
  width:120px;
  border:0;
  border-radius:8px;
  background:#db2777;
  color:white;
  font-weight:900;
  cursor:pointer;
}
table{
  width:100%;
  border-collapse:collapse;
}
th,td{
  border:1px solid #ddd;
  padding:12px;
  text-align:center;
}
th{
  background:#f8fafc;
}
.status{
  padding:6px 12px;
  border-radius:999px;
  font-weight:900;
}
.paid{
  background:#dcfce7;
  color:#166534;
}

.unpaid{
  background:#fee2e2;
  color:#991b1b;
}
  .header-area{
  background:linear-gradient(135deg,#ec4899,#db2777);
  color:white;
  padding:24px;
  border-radius:16px;
  margin-bottom:20px;
}

.header-area h2{
  margin:0;
  font-size:32px;
}

.header-area div{
  margin-top:8px;
  opacity:.9;
}

.view-btn{
  display:inline-block;
  padding:8px 16px;
  background:#ec4899;
  color:white;
  border-radius:10px;
  text-decoration:none;
  font-weight:900;
}
</style>
</head>
<body>
<div class="box">

<div class="header-area">
  <h2>訂單管理後台</h2>
  <div>最近 7 天訂單資料</div>
</div>

<div class="stats">

  <div class="card">
  7日收款
  <span>${Number(totalAmount).toLocaleString()}</span>
</div>

<div class="card">
  7日訂單
  <span>${result.rows.length}</span>
</div>

  <div class="card">
    本月收款
    <span>${Number(monthAmount).toLocaleString()}</span>
  </div>

  <div class="card">
    總收款
    <span>${Number(totalAmount).toLocaleString()}</span>
  </div>

  <div class="card">
    OK
    <span>${stats.paid_orders}</span>
  </div>

  <div class="card">
    NO
    <span>${stats.unpaid_orders}</span>
  </div>

</div>

<form class="search" method="GET" action="/admin/orders">

  <input
    name="keyword"
    value="${keyword}"
    placeholder="搜尋訂單編號 KBB..."
  >

  <select name="payment">

 <option value="all" ${payment === "all" ? "selected" : ""}>
  全部付款方式
</option>

<option value="CVS" ${payment === "CVS" ? "selected" : ""}>
  超商代碼
</option>

<option value="ATM" ${payment === "ATM" ? "selected" : ""}>
  ATM虛擬帳號
</option>

  </select>

  <select name="status">

    <option value="all" ${status === "all" ? "selected" : ""}>
      全部狀態
    </option>

    <option value="NO" ${status === "NO" ? "selected" : ""}>
      NO
    </option>

    <option value="OK" ${status === "OK" ? "selected" : ""}>
      OK
    </option>

  </select>

  <button type="submit">
    搜尋
  </button>

</form>

<table>
<tr>
<th>訂單編號</th>
<th>姓名</th>
<th>付款代碼</th>
<th>金額</th>
<th>付款方式</th>
<th>付款狀態</th>
<th>建立時間</th>
<th>付款資訊</th>
<th>查看</th>
</tr>
${rows || `<tr><td colspan="9">目前沒有訂單</td></tr>`}
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

app.get("/admin/order/:orderId", async (req, res) => {

  const orderId = req.params.orderId;

  const result = await pool.query(
    "SELECT * FROM orders WHERE order_id=$1",
    [orderId]
  );

  if (!result.rows.length) {
    return res.send("找不到訂單");
  }

  const order = result.rows[0];

  res.send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>訂單詳細資訊</title>

<style>
body{
  font-family:"Microsoft JhengHei";
  background:#fdf2f8;
  padding:30px;
}
  
.box{
max-width:700px;
margin:auto;
background:white;
padding:30px;
border-radius:16px;
}

table{
width:100%;
border-collapse:collapse;
}

td{
border:1px solid #ddd;
padding:12px;
}

td:first-child{
background:#f8fafc;
font-weight:900;
width:35%;
}

.code{
font-size:24px;
font-weight:900;
color:#dc2626;
}

.view-btn{
  display:inline-block;
  padding:8px 16px;
  background:#ec4899;
  color:white;
  border-radius:10px;
  text-decoration:none;
  font-weight:900;
}

.header-area{
  background:linear-gradient(135deg,#ec4899,#db2777);
  color:white;
  padding:24px;
  border-radius:16px;
  margin-bottom:20px;
}

.header-area h2{
  margin:0;
  font-size:32px;
}

.header-area div{
  margin-top:8px;
  opacity:.9;
}

.detail-header{
  background:linear-gradient(135deg,#ec4899,#db2777);
  color:white;
  padding:18px;
  border-radius:12px;
  font-size:26px;
  font-weight:900;
  margin-bottom:20px;
}

.back{
display:inline-block;
margin-top:20px;
}
</style>

</head>
<body>

<div class="box">

<div class="detail-header">
  訂單詳細資訊
</div>

<table>

<tr>
<td>訂單編號</td>
<td>${order.order_id}</td>
</tr>

<tr>
<td>金額</td>
<td>${order.amount}</td>
</tr>

<tr>
<td>付款方式</td>
<td>${order.payment}</td>
</tr>

<tr>
<td>付款資訊</td>
<td>

${order.payment === "ATM"
? `
<div style="font-weight:900;font-size:18px;">
${order.bank_code === "007"
? "第一銀行（007）"
: order.bank_code === "822"
? "中國信託（822）"
: order.bank_code || "-"}
</div>

<div class="code" style="margin-top:10px;">
${order.v_account || "-"}
</div>
`
: `
<div class="code">
${order.payment_no || "-"}
</div>
`
}

</td>
</tr>

<tr>
<td>付款狀態</td>
<td>${order.status}</td>
</tr>

<tr>
<td>繳費期限</td>
<td>${order.expire_date || "-"}</td>
</tr>

</table>

<a class="back" href="/admin/orders">
返回後台
</a>

</div>

<script>

function copyPayment(){

const text =
document.getElementById("copyCode").innerText;

navigator.clipboard.writeText(text);

alert("已複製付款代碼");

}

</script>

</body>
</html>
`);
});

app.listen(PORT, () => {
  console.log(`收款系統已啟動：http://localhost:${PORT}`);
});