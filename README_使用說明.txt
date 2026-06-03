歐買尬收款 API 網頁系統

使用步驟：

1. 解壓縮資料夾 ohmygod-pay-api

2. 把 .env.example 改名成 .env

3. 打開 .env，填入你的資料：
   MERCHANT_ID=1032429
   HASH_KEY=你的HashKey
   HASH_IV=你的HashIV
   PORT=3000

4. 在資料夾空白處按 Shift + 右鍵 → 在終端機開啟

5. 輸入：
   npm install

6. 啟動：
   npm start

7. 瀏覽器打開：
   http://localhost:3000

注意：
如果按下「產生超商代碼」後出現找不到金鑰或參數錯誤，通常代表歐買尬 API 尚未開通、HashKey/HashIV 錯誤，或你的商家後台不是 opay.tw 這組 API。
