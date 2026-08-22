# 苜蓿云端中继

这个目录把糯叽机的「Cloudflare Worker + Cron + KV + Web Push + Outbox」后台思路接到苜蓿的主动发消息。网页设置里的 **最小/最大分钟数会直接同步到服务器**；服务器每次发送后都会在这个区间里重新随机下一次时间，所以网页被锁屏或系统杀掉也不会靠前台计时。

## 部署

1. 在 Cloudflare 创建一个 KV namespace：`npx wrangler kv namespace create OUTBOX`。
2. 把输出的 id 填到 `wrangler.toml` 的 `REPLACE_WITH_KV_NAMESPACE_ID`。
3. 设置中继密钥：`npx wrangler secret put RELAY_SECRET`。
4. `npm install`，然后 `npm run deploy`。
5. 把部署得到的 `https://...workers.dev`（大陆网络建议绑定自己的可访问域名）和同一个密钥填进苜蓿：设置 → 主动发消息 → 后台保活模式。
6. 打开「后台推送提醒」。第一次连接会自动创建 VAPID 密钥并注册 Web Push。

无需另外配置 VAPID；Worker 会首次运行时自动生成并存在 KV。
