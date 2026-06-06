require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const dayjs = require("dayjs");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const MerchantID = process.env.MERCHANT_ID || "1032429";
const HashKey = process.env.HASH_KEY;
const HashIV = process.env.HASH_IV;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "https://ohmygod-pay-api.onrender.com";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "orders.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      orderId TEXT PRIMARY KEY,
      amount INTEGER NOT NULL,
      payment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '未付款',
      paymentNo TEXT DEFAULT '',
      bankCode TEXT DEFAULT '',
      vAccount TEXT DEFAULT '',
      expireDate TEXT DEFAULT '',
      paymentType TEXT DEFAULT '',
      rtnCode TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      paidAt TEXT DEFAULT ''
    )
  `);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function paymentName(payment) {
  if (payment === "ATM") return "ATM 虛擬帳號";
  if (payment === "BARCODE") return "超商條碼";
  return "超商代碼";
}
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
  const sorted = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  const raw = `HashKey=${HashKey}&${sorted}&HashIV=${HashIV}`;
  return crypto.createHash("sha256").update(encodeOpay(raw)).digest("hex").toUpperCase();
}
function getChoosePayment(value) {
  if (value === "ATM") return "ATM";
  if (value === "BARCODE") return "BARCODE";
  return "CVS";
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.post("/create-payment", async (req, res) => {
  try {
    if (!HashKey || !HashIV) {
      return res.status(500).send("尚未設定 HASH_KEY / HASH_IV。<br><a href='/'>返回</a>");
    }

    const amount = Number(req.body.amount);
    const payment = getChoosePayment(req.body.payment);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).send("金額錯誤，請重新輸入。<br><a href='/'>返回</a>");
    }

    const orderId = "KBB" + dayjs().format("YYYYMMDDHHmmss");
    const createdAt = dayjs().format("YYYY/MM/DD HH:mm:ss");

    await run(
      `INSERT INTO orders(orderId, amount, payment, status, createdAt)
       VALUES(?, ?, ?, '未付款', ?)`,
      [orderId, amount, payment, createdAt]
    );

    const params = {
      MerchantID,
      MerchantTradeNo: orderId,
      MerchantTradeDate: createdAt,
      PaymentType: "aio",
      TotalAmount: amount,
      TradeDesc: "OhMyGod Pay",
      ItemName: "金爸爸遊戲幣",
      ChoosePayment: payment,
      ExpireDate: 1,
      StoreExpireDate: 1440,
      ReturnURL: `${BASE_URL}/api/opay/notify`,
      ClientBackURL: `${BASE_URL}/admin/orders/${orderId}`,
      OrderResultURL: `${BASE_URL}/payment-result`,
      PaymentInfoURL: `${BASE_URL}/api/opay/payment-info`,
      ClientRedirectURL: `${BASE_URL}/payment-info`,
      NeedExtraPaidInfo: "Y",
      EncryptType: 1
    };
    params.CheckMacValue = createCheckMacValue(params);

    let form = `<!doctype html><html><head><meta charset="utf-8"><title>前往付款</title></head><body onload="document.forms[0].submit()"><p>正在前往歐買尬付款頁...</p><form method="POST" action="https://payment.funpoint.com.tw/Cashier/AioCheckOut/V5">`;
    for (const key of Object.keys(params)) form += `<input type="hidden" name="${key}" value="${esc(params[key])}">`;
    form += `</form></body></html>`;
    res.send(form);
  } catch (err) {
    console.error(err);
    res.status(500).send("建立付款單失敗。<br><a href='/'>返回</a>");
  }
});

app.get("/api/opay/notify", (req, res) => res.send("notify ok"));
app.get("/api/opay/payment-info", (req, res) => res.send("payment-info ok"));

app.post("/api/opay/payment-info", async (req, res) => {
  try {
    console.log("收到歐買尬付款資訊：", req.body);
    const data = req.body;
    const orderId = data.MerchantTradeNo;
    if (orderId) {
      await run(
        `UPDATE orders SET
          paymentNo = COALESCE(NULLIF(?, ''), paymentNo),
          bankCode = COALESCE(NULLIF(?, ''), bankCode),
          vAccount = COALESCE(NULLIF(?, ''), vAccount),
          expireDate = COALESCE(NULLIF(?, ''), expireDate),
          paymentType = COALESCE(NULLIF(?, ''), paymentType)
         WHERE orderId = ?`,
        [
          data.PaymentNo || data.CVSCode || data.CVSNo || "",
          data.BankCode || "",
          data.vAccount || data.VirtualAccount || "",
          data.ExpireDate || data.ExpireTime || "",
          data.PaymentType || data.PaymentTypeChargeFee || "",
          orderId
        ]
      );
    }
    res.send("1|OK");
  } catch (err) {
    console.error(err);
    res.send("1|OK");
  }
});

app.post("/api/opay/notify", async (req, res) => {
  try {
    console.log("收到歐買尬付款通知：", req.body);
    const data = req.body;
    const orderId = data.MerchantTradeNo;
    const status = String(data.RtnCode) === "1" ? "已付款" : "未付款";
    const paidAt = status === "已付款" ? dayjs().format("YYYY/MM/DD HH:mm:ss") : "";
    if (orderId) {
      await run(
        `UPDATE orders SET status=?, rtnCode=?, paidAt=COALESCE(NULLIF(?, ''), paidAt) WHERE orderId=?`,
        [status, data.RtnCode || "", paidAt, orderId]
      );
    }
    res.send("1|OK");
  } catch (err) {
    console.error(err);
    res.send("1|OK");
  }
});

app.post("/payment-info", async (req, res) => {
  const data = req.body;
  const orderId = data.MerchantTradeNo;
  const order = orderId ? await get("SELECT * FROM orders WHERE orderId=?", [orderId]) : null;
  res.send(renderPaymentInfo(data, order));
});
app.get("/payment-info", (req, res) => res.send("請回到歐買尬付款頁面取得繳費代碼。<br><a href='/'>回首頁</a>"));
app.get("/payment-result", (req, res) => res.send("付款流程完成或已返回商店頁。<br><a href='/'>回首頁</a>　<a href='/admin/orders'>訂單後台</a>"));

app.get("/admin/orders", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const status = String(req.query.status || "all");
  const conditions = [];
  const params = [];
  if (q) {
    conditions.push("orderId LIKE ?");
    params.push(`%${q}%`);
  }
  if (status === "paid") conditions.push("status='已付款'");
  if (status === "pending") conditions.push("status!='已付款'");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const orders = await all(`SELECT * FROM orders ${where} ORDER BY orderId DESC LIMIT 300`, params);
  const stats = await get(`
    SELECT
      COUNT(*) AS totalOrders,
      SUM(CASE WHEN status='已付款' THEN 1 ELSE 0 END) AS paidOrders,
      SUM(CASE WHEN status!='已付款' THEN 1 ELSE 0 END) AS pendingOrders,
      COALESCE(SUM(CASE WHEN status='已付款' THEN amount ELSE 0 END),0) AS paidAmount
    FROM orders
  `);

  res.send(renderAdminOrders(orders, stats, q, status));
});

app.get("/admin/orders/:orderId", async (req, res) => {
  const order = await get("SELECT * FROM orders WHERE orderId=?", [req.params.orderId]);
  if (!order) return res.status(404).send("查無訂單。<br><a href='/admin/orders'>回後台</a>");
  res.send(renderOrderDetail(order));
});

function renderPaymentInfo(data, order) {
  const orderId = data.MerchantTradeNo || order?.orderId || "";
  const amount = data.TradeAmt || data.TotalAmount || order?.amount || "";
  const paymentType = data.PaymentType || data.PaymentTypeChargeFee || order?.paymentType || order?.payment || "";
  const paymentNo = data.PaymentNo || data.CVSCode || data.CVSNo || order?.paymentNo || "";
  const bankCode = data.BankCode || order?.bankCode || "";
  const vAccount = data.vAccount || data.VirtualAccount || order?.vAccount || "";
  const expireDate = data.ExpireDate || data.ExpireTime || order?.expireDate || "";
  return renderPaymentBox({ orderId, amount, paymentType, paymentNo, bankCode, vAccount, expireDate });
}
function renderPaymentBox(info) {
  const copyText = `訂單編號：${info.orderId}\n付款金額：${info.amount} 元\n付款方式：${info.paymentType}\n超商代碼：${info.paymentNo}\n銀行代碼：${info.bankCode}\n虛擬帳號：${info.vAccount}\n繳費期限：${info.expireDate}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>付款資訊</title>${pageStyle()}</head><body><div class="box"><h2>付款資訊</h2><table><tr><td>訂單編號</td><td>${esc(info.orderId)}</td></tr><tr><td>交易金額</td><td>${esc(info.amount)} 元</td></tr><tr><td>付款方式</td><td>${esc(info.paymentType)}</td></tr><tr><td>超商代碼</td><td class="code">${esc(info.paymentNo)}</td></tr><tr><td>銀行代碼</td><td>${esc(info.bankCode)}</td></tr><tr><td>虛擬帳號</td><td class="code">${esc(info.vAccount)}</td></tr><tr><td>繳費期限</td><td>${esc(info.expireDate)}</td></tr></table><textarea id="copyText" style="position:absolute;left:-9999px">${esc(copyText)}</textarea><button onclick="navigator.clipboard.writeText(document.getElementById('copyText').value).then(()=>alert('已複製付款資訊'))">複製付款資訊</button><a class="link" href="/admin/orders/${esc(info.orderId)}">查看訂單</a><a class="link" href="/">回首頁</a></div></body></html>`;
}
function renderOrderDetail(order) {
  return renderPaymentBox({
    orderId: order.orderId,
    amount: order.amount,
    paymentType: paymentName(order.payment),
    paymentNo: order.paymentNo,
    bankCode: order.bankCode,
    vAccount: order.vAccount,
    expireDate: order.expireDate
  });
}
function renderAdminOrders(orders, stats, q, status) {
  const rows = orders.map(o => `<tr><td><a href="/admin/orders/${esc(o.orderId)}">${esc(o.orderId)}</a></td><td>${Number(o.amount).toLocaleString()}</td><td>${paymentName(o.payment)}</td><td><span class="badge ${o.status === "已付款" ? "paid" : "pending"}">${esc(o.status)}</span></td><td>${esc(o.createdAt)}</td><td>${esc(o.paidAt || "-")}</td></tr>`).join("") || `<tr><td colspan="6">目前沒有訂單</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>訂單管理後台</title>${adminStyle()}</head><body><div class="wrap"><div class="top"><h2>訂單管理後台</h2><a href="/">建立付款單</a></div><div class="cards"><div class="card"><b>${Number(stats.paidAmount || 0).toLocaleString()}</b><span>已付款金額</span></div><div class="card"><b>${stats.paidOrders || 0}</b><span>已付款</span></div><div class="card"><b>${stats.pendingOrders || 0}</b><span>待付款</span></div><div class="card"><b>${stats.totalOrders || 0}</b><span>總訂單</span></div></div><form class="filters" method="GET" action="/admin/orders"><input name="q" value="${esc(q)}" placeholder="搜尋訂單編號 KBB..." /><select name="status"><option value="all" ${status==='all'?'selected':''}>全部</option><option value="pending" ${status==='pending'?'selected':''}>待付款</option><option value="paid" ${status==='paid'?'selected':''}>已付款</option></select><button>搜尋</button></form><table><tr><th>訂單編號</th><th>金額</th><th>付款方式</th><th>狀態</th><th>建立時間</th><th>付款時間</th></tr>${rows}</table></div></body></html>`;
}
function pageStyle(){return `<style>body{font-family:"Microsoft JhengHei",Arial,sans-serif;background:#f3f4f6;padding:20px}.box{max-width:640px;margin:35px auto;background:white;padding:28px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08)}h2{text-align:center}table{width:100%;border-collapse:collapse;margin-top:20px}td{border-bottom:1px solid #e5e7eb;padding:13px}td:first-child{background:#f9fafb;width:34%;font-weight:900}.code{font-size:26px;font-weight:900;color:#dc2626;letter-spacing:1px}button{width:100%;height:52px;border:0;border-radius:12px;background:#f59e0b;font-size:18px;font-weight:900;margin-top:20px;cursor:pointer}.link{display:block;text-align:center;margin-top:18px;color:#111827}</style>`}
function adminStyle(){return `<style>body{font-family:"Microsoft JhengHei",Arial,sans-serif;background:#f3f4f6;margin:0;padding:20px;color:#111827}.wrap{max-width:1200px;margin:auto}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.top a{background:#111827;color:white;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:900}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.card{background:white;border-radius:16px;padding:18px;box-shadow:0 8px 24px rgba(0,0,0,.06)}.card b{display:block;font-size:28px}.card span{color:#6b7280}.filters{display:flex;gap:10px;background:white;padding:14px;border-radius:16px;margin-bottom:16px}.filters input,.filters select{height:46px;border:1px solid #d1d5db;border-radius:10px;padding:0 12px;font-size:16px}.filters input{flex:1}.filters button{width:110px;border:0;border-radius:10px;background:#f59e0b;font-weight:900;cursor:pointer}table{width:100%;border-collapse:collapse;background:white;border-radius:16px;overflow:hidden}th,td{border-bottom:1px solid #e5e7eb;padding:13px;text-align:center}th{background:#f9fafb}.badge{display:inline-block;padding:6px 12px;border-radius:999px;font-weight:900}.paid{background:#dcfce7;color:#166534}.pending{background:#fef3c7;color:#92400e}@media(max-width:760px){.cards{grid-template-columns:repeat(2,1fr)}.filters{display:block}.filters input,.filters select,.filters button{width:100%;margin-bottom:8px}table{font-size:13px}}</style>`}

app.listen(PORT, () => console.log(`收款系統已啟動：http://localhost:${PORT} / DB: ${DB_PATH}`));
