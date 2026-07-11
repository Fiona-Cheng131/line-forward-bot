require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');

// ===== 基本設定 =====
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// A 群組（訊息來源）的 group ID
const SOURCE_GROUP_ID = process.env.SOURCE_GROUP_ID;

// B~F 群組（要轉發過去）的 group ID，用逗號分隔
const TARGET_GROUP_IDS = (process.env.TARGET_GROUP_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const client = new line.Client(config);
const app = express();

// 健康檢查用（Render 會 ping 這個網址確認服務還活著）
app.get('/', (_req, res) => res.send('LINE 轉發機器人運作中'));

app.post('/webhook', line.middleware(config), (req, res) => {
  // 先立刻回 200，避免超過 LINE 的 2 秒 timeout
  res.sendStatus(200);

  const events = req.body.events || [];
  events.forEach((event) => {
    handleEvent(event).catch((err) => {
      console.error('處理事件失敗:', err);
    });
  });
});

async function handleEvent(event) {
  // 方便你找出每個群組的 group ID：只要群組裡有人講話（或機器人被加入），
  // 就會在這裡印出來，去 Render 的 Logs 頁面看就找得到。
  if (event.source && event.source.type === 'group') {
    console.log(`[群組事件] type=${event.type} groupId=${event.source.groupId}`);
  }

  if (event.type !== 'message') return;
  if (!event.source || event.source.type !== 'group') return;

  // 只轉發來自 A 群組的訊息
  if (!SOURCE_GROUP_ID || event.source.groupId !== SOURCE_GROUP_ID) return;

  const forwardMessage = buildForwardMessage(event.message);
  if (!forwardMessage) return;

  if (TARGET_GROUP_IDS.length === 0) {
    console.warn('尚未設定 TARGET_GROUP_IDS，訊息不會被轉發到任何群組。');
    return;
  }

  await Promise.all(
    TARGET_GROUP_IDS.map((groupId) =>
      client.pushMessage(groupId, [forwardMessage]).catch((err) => {
        console.error(`推播到群組 ${groupId} 失敗:`, err.originalError?.response?.data || err.message);
      })
    )
  );
}

// 把 A 群組收到的訊息轉成要轉發的訊息物件
function buildForwardMessage(message) {
  switch (message.type) {
    case 'text':
      return { type: 'text', text: message.text };
    case 'sticker':
      return { type: 'sticker', packageId: message.packageId, stickerId: message.stickerId };
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      // 圖片/影片/語音/檔案目前不轉發實際內容，只提示收到（需要的話可以再擴充下載+重新上傳的邏輯）
      return { type: 'text', text: `[收到一則 ${message.type} 訊息，暫不支援自動轉發此類型內容]` };
    default:
      return null;
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`伺服器已啟動，監聽 port ${port}`));
