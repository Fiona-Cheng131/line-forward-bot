# LINE 群組轉發機器人

功能：在 A 群組發訊息，機器人自動把同一則訊息轉發到 B、C、D、E、F 五個群組。程式跑在雲端（Render），你的電腦不用開機。

目前支援轉發：文字訊息、貼圖。圖片/影片/語音/檔案會提示「收到但暫不轉發內容」（要支援的話之後再擴充）。

---

## 一、申請 LINE 官方帳號 + Messaging API

1. 到 [LINE Developers](https://developers.line.biz/console/) 用你的 LINE 帳號登入。
2. 建立一個 **Provider**（名稱隨意，例如「我的機器人」）。
3. 在該 Provider 底下建立一個 **Channel**，類型選 **Messaging API**。填寫基本資料後建立。
4. 進入該 Channel，切到 **Messaging API** 分頁：
   - 找到 **Channel access token**，按「Issue」產生一組長效 token，複製起來。
   - 在同一頁或 **Basic settings** 分頁找到 **Channel secret**，複製起來。
5. 還在 Messaging API 分頁：
   - 把 **Allow bot to join group chats** 打開（一定要開，不然機器人不能加進群組）。
   - 把 **Auto-reply messages** 和 **Greeting messages** 關閉（在 [LINE Official Account Manager](https://manager.line.biz/) 的「回應設定」裡關，避免機器人亂回訊息）。
   - 「回應模式」設為 **Bot**（而非「聊天」）。

先不要急著填 Webhook URL，等程式部署好、拿到網址後再回來設定（下面第三步）。

---

## 二、把程式碼放上 GitHub

1. 到 [GitHub](https://github.com) 建立一個新的空 repository（例如叫 `line-forward-bot`）。
2. 把這個資料夾（`line-forward-bot`）裡的檔案上傳上去（可以直接在 GitHub 網頁拖拉上傳，或用 git 指令 push）。
   - 注意：不要上傳 `.env`（裡面是機密資料），`.gitignore` 已經幫你排除了。

---

## 三、部署到 Render（免費）

1. 到 [Render](https://render.com) 註冊帳號（可以用 GitHub 登入）。
2. 點 **New +** → **Web Service**，選擇剛剛那個 GitHub repo。
3. 設定：
   - **Build Command**：`npm install`
   - **Start Command**：`npm start`
   - **Instance Type**：Free
4. 在 **Environment** 頁籤新增環境變數：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 你剛剛複製的 token
   - `LINE_CHANNEL_SECRET` = 你剛剛複製的 secret
   - `SOURCE_GROUP_ID` = 先留空，晚點回來填
   - `TARGET_GROUP_IDS` = 先留空，晚點回來填
5. 部署完成後，你會拿到一個網址，例如 `https://line-forward-bot.onrender.com`。
6. 回到 LINE Developers 的 Messaging API 分頁，把 **Webhook URL** 設成：
   `https://line-forward-bot.onrender.com/webhook`
   按 **Verify** 確認顯示成功，並把 **Use webhook** 打開。

> Render 免費方案閒置 15 分鐘會休眠，喚醒約需 30-60 秒。LINE 平台在收不到即時回應時會自動重試，所以訊息通常還是送得到，只是第一則可能會延遲。如果很在意這點，之後可以換成 Google Cloud Run 之類冷啟動更快的平台。

---

## 四、把機器人加進 6 個群組，並取得 group ID

1. 在 LINE app 裡，把這個機器人分別加入 A、B、C、D、E、F 六個群組（用「邀請」功能，搜尋機器人的 LINE 官方帳號 ID 或掃 QR code）。
2. 加入後，在**每一個群組**裡隨便發一則文字訊息（例如打「test」）。
3. 到 Render 該服務的 **Logs** 頁面，會看到類似這樣的紀錄：
   ```
   [群組事件] type=message groupId=Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   把每個群組對應的 `groupId` 記下來（哪個群組發的訊息，就是哪個群組的 ID）。
4. 回到 Render 的 Environment 設定：
   - `SOURCE_GROUP_ID` 填 **A 群組**的 groupId。
   - `TARGET_GROUP_IDS` 填 **B、C、D、E、F** 五個群組的 groupId，用逗號分隔，例如：
     ```
     Cxxxx1,Cxxxx2,Cxxxx3,Cxxxx4,Cxxxx5
     ```
5. 存檔後 Render 會自動重新部署套用新的環境變數。

---

## 五、測試

在 A 群組發一則訊息，等幾秒鐘，確認 B、C、D、E、F 五個群組都有收到同樣內容。

---

## 注意事項

- **免費訊息則數限制**：LINE 官方帳號的免費方案每月可推播的訊息則數有限（依方案、地區而定），超過需額外購買訊息包，詳見 [LINE 官方定價頁面](https://developers.line.biz/en/docs/messaging-api/pricing/)。一天轉發幾十則訊息通常不會超過，但如果 A 群組很活躍要留意。
- **圖片/影片/檔案**：目前不會轉發實際內容（LINE 推播圖片需要一個公開的圖片網址，跟純文字轉發比起來複雜不少）。如果之後想要支援，可以再請我幫你加上「下載後上傳到圖床再轉發」的邏輯。
- **機密資料**：`LINE_CHANNEL_ACCESS_TOKEN`／`LINE_CHANNEL_SECRET` 不要外流，也不要上傳到公開的 GitHub repo。
