require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// 這個服務對外的網址，用來組成圖片/影片/檔案的公開下載連結。
// Render 會自動提供 RENDER_EXTERNAL_URL，通常不用自己設定。
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

const client = new line.Client(config);
const app = express();

// 下載下來的圖片/影片/語音/檔案暫存在這裡，並用靜態路由對外提供下載連結
const MEDIA_DIR = path.join(__dirname, 'media-storage');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));

// 影片訊息需要一張預覽縮圖，這裡放一張固定的通用縮圖
app.use('/assets', express.static(path.join(__dirname, 'assets')));

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

  let forwardMessage;
  try {
    forwardMessage = await buildForwardMessage(event.message);
  } catch (err) {
    console.error('處理訊息內容失敗:', err);
    forwardMessage = { type: 'text', text: '[轉發失敗：處理訊息時發生錯誤]' };
  }
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
async function buildForwardMessage(message) {
  switch (message.type) {
    case 'text':
      return { type: 'text', text: message.text };

    case 'sticker':
      return { type: 'sticker', packageId: message.packageId, stickerId: message.stickerId };

    case 'image': {
      const url = await downloadToPublicUrl(message.id, '.jpg');
      if (!url) return { type: 'text', text: '[圖片轉發失敗，請稍後再試]' };
      return { type: 'image', originalContentUrl: url, previewImageUrl: url };
    }

    case 'video': {
      const url = await downloadToPublicUrl(message.id, '.mp4');
      if (!url) return { type: 'text', text: '[影片轉發失敗，請稍後再試]' };
      const previewUrl = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/assets/video-preview.jpg` : url;
      return { type: 'video', originalContentUrl: url, previewImageUrl: previewUrl };
    }

    case 'audio': {
      const url = await downloadToPublicUrl(message.id, '.m4a');
      if (!url) return { type: 'text', text: '[語音轉發失敗，請稍後再試]' };
      return { type: 'audio', originalContentUrl: url, duration: message.duration || 60000 };
    }

    case 'file': {
      // LINE 沒有提供「檔案訊息」的推播類型（例如 PDF），所以改成轉發一個下載連結
      const ext = path.extname(message.fileName || '') || '';
      const url = await downloadToPublicUrl(message.id, ext);
      if (!url) return { type: 'text', text: `[檔案轉發失敗：${message.fileName || '未知檔名'}]` };
      return { type: 'text', text: `📎 ${message.fileName || '檔案'}\n${url}` };
    }

    default:
      return null;
  }
}

// 把 LINE 訊息內容下載下來、存到本機磁碟，回傳一個外部可以存取的網址
async function downloadToPublicUrl(messageId, extension) {
  if (!PUBLIC_BASE_URL) {
    console.error('未設定 PUBLIC_BASE_URL / RENDER_EXTERNAL_URL，無法組出公開下載連結');
    return null;
  }
  try {
    const stream = await client.getMessageContent(messageId);
    const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${extension}`;
    const filePath = path.join(MEDIA_DIR, filename);

    await new Promise((resolve, reject) => {
      const writable = fs.createWriteStream(filePath);
      stream.pipe(writable);
      stream.on('error', reject);
      writable.on('finish', resolve);
      writable.on('error', reject);
    });

    return `${PUBLIC_BASE_URL}/media/${filename}`;
  } catch (err) {
    console.error('下載 LINE 媒體內容失敗:', err.originalError?.response?.data || err.message);
    return null;
  }
}

// 定期清掉舊的媒體檔案，避免免費方案有限的磁碟空間被塞滿
const MEDIA_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 小時
setInterval(() => {
  fs.readdir(MEDIA_DIR, (err, files) => {
    if (err) return;
    const now = Date.now();
    files.forEach((file) => {
      const filePath = path.join(MEDIA_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > MEDIA_MAX_AGE_MS) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 30 * 60 * 1000); // 每 30 分鐘檢查一次

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`伺服器已啟動，監聽 port ${port}`));
