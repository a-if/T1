# Telegram Auto Reaction Bot

A Telegram bot built around one codebase with two supported deployments: **Vercel + MongoDB** and **Cloudflare Workers + D1**. It supports automatic reactions, group/channel settings, welcome messages, required-channel verification, private-channel join requests, and broadcasts.

## ✨ V6 changes

- `/groupsetting` is the central group/channel management entry point.
- Running `/groupsetting` inside a group connects that group to the admin's private settings panel.
- Private `/groupsetting` shows all connected groups/channels.
- Group + Channel selection is separated when both are connected.
- Settings are managed in the bot's private chat instead of filling the group with configuration messages.
- Text-edit/input modes temporarily hide the settings buttons and restore the panel after input is received.
- Welcome mode: **Only User** or **Group**.
- Welcome buttons support multiple rows and multiple buttons in the same row.
- Button management supports **Add**, **Delete One**, and **Delete All**.
- Required-channel gate for groups: users are muted until they join the configured channel and press **Check & Unmute**.
- The required channel is accepted only after the bot is verified as an admin there.
- Private-channel join-request users are stored for statistics and an optional broadcast audience.
- `/help` deletes the old welcome message and sends a fresh help message; Back edits that help message back to the welcome screen.
- The old Upload/Add UI is replaced with **Donation**.
- Commands such as `/groupsetting` and `/start` are never converted to Unicode small-caps.
- MongoDB adapter for the Vercel/Node entry point (`MONGODB_URL` is required; there is no local storage fallback).
- Cloudflare Workers uses D1 + Queues and does **not** bundle the MongoDB Node driver.

## 🚀 One-click deployment

> The repository used by the buttons below is `https://github.com/a-if/Reactions`. If you fork the project, replace the repository URL in the button/link with your fork.

### Cloudflare Workers — recommended free-tier path

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/a-if/Reactions)

Cloudflare's Deploy button can provision resources declared in `wrangler.toml`, including D1 and Queues. The Worker expects `BOT_TOKEN` as a secret/deployment value. `UPLOAD_URL` is **not required** in V6. Do not put your Telegram token in GitHub.

### Vercel (MongoDB)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fa-if%2FReactions&project-name=auto-reaction-bot&env=BOT_TOKEN,BOT_USERNAME,MONGODB_URL,MONGODB_DB,ADMIN_IDS)

Vercel uses the Node webhook entry point (`api/index.js`). During the one-click flow, fill in:

```text
BOT_TOKEN        (from @BotFather — required)
BOT_USERNAME     (your bot username without @ — required)
MONGODB_URL      (MongoDB connection string, e.g. MongoDB Atlas — required)
MONGODB_DB       (database name, default: reaction-bot)
ADMIN_IDS        (comma-separated Telegram user IDs for /stats and /broadcast)
```

After the first deploy, copy your `*.vercel.app` URL into the `WEBHOOK_URL` env var and redeploy once — the bot then sets its Telegram webhook automatically. (If `MONGODB_URL` is missing, the webhook returns an error and `/health` reports `dbConfigured: false`.)

## 📢 Channel reactions not working?

Check these four things:

1. The bot is an **admin** in the channel.
2. Reactions are **enabled** in the channel settings (channel info → Reactions).
3. `EMOJI_LIST` contains valid Telegram reaction emojis (the default list is fine).
4. On Vercel, `MONGODB_URL` is set and reachable — check `/health` on your deployment.

Reaction failures are logged with the reason; set `LOG_LEVEL=debug` for full detail.

## ☁️ Cloudflare Free architecture

Cloudflare deployment uses:

- Workers for webhook execution
- D1 for bot data/settings
- Queues for broadcast jobs
- Worker Secrets for `BOT_TOKEN`

The Node `mongodb` package is not used by the Worker runtime.

Cloudflare's Deploy-to-Workers flow reads the Wrangler configuration and can automatically provision supported resources such as D1 and Queues.

### Cloudflare variables

Required:

```text
BOT_TOKEN
BOT_USERNAME
```

Recommended:

```text
ADMIN_IDS=123456789,987654321
UPDATES_URL=https://t.me/YourUpdates
SUPPORT_URL=https://t.me/YourSupport
```

Optional:

```text
EMOJI_LIST=👍❤🔥🥰👏😁🎉🤩🙏👌🕊😍🐳❤‍🔥💯⚡🏆
RANDOM_LEVEL=0
RESTRICTED_CHATS=
START_ANIMATION=
DONATE_ANIMATION=
LOG_LEVEL=info
AUTO_SET_WEBHOOK=true
```

**Do not add a random `UPLOAD_URL`. V6 does not use it.**

After deployment, opening the Worker URL once lets the Worker automatically set the Telegram webhook to `/` when `AUTO_SET_WEBHOOK=true`.

## 🍃 Vercel environment (MongoDB)

Use MongoDB Atlas or another reachable MongoDB deployment. `MONGODB_URL` is required — the bot has no local storage fallback.

```env
BOT_TOKEN=
BOT_USERNAME=ReactionsXBot
MONGODB_URL=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=reaction-bot
ADMIN_IDS=
UPDATES_URL=https://t.me/PythonBotz
SUPPORT_URL=
AUTO_SET_WEBHOOK=true
WEBHOOK_URL=https://your-app.vercel.app/
```

`WEBHOOK_URL` is recommended. Vercel only gives you the public URL after the first deployment, so add it in environment variables and redeploy once. Use the bare origin only (e.g. `https://your-app.vercel.app`) — never add a path like `/webhook`; the bot serves updates at `/` and the code enforces this.

## 🤖 Commands

### Users

```text
/start
/help
/reactions
/donate
```

### Group admins

```text
/groupsetting
/welcome
/reactions_on
/reactions_off
```

`/groupsetting` is the recommended central dashboard. The older shortcuts remain for compatibility where applicable.

### Channel admins

```text
/connectchannel
/mychannels
/joinsetting
```

Use `/connectchannel @username` for a public channel. For a private channel, use `CHANNEL_ID | INVITE_LINK` or forward one of its posts after making the bot an admin. The bot verifies that the channel exists and that it is an admin before saving it.

### Bot owner/admin

```text
/stats
/users
/broadcast
```

## 👋 Welcome system

From the private group settings panel:

- Enable / Disable
- Message editor
- Only User / Group mode
- Button manager with Add / Rename / Change Link / Change Color / Move Up / Move Down / Delete
- 1 button per row or 2 buttons per row
- The bot stays inside the button manager while adding/editing multiple buttons
- Preview
- Add buttons
- Delete one button
- Delete all buttons

Template variables:

```text
{name}
{username}
{mention}
{group}
```

### Multiple buttons per row

Button creation is guided step-by-step: send the button name, then the link, then choose the color. You can later change its name, link, color, position and row layout from the same manager.

Result:

```text
[ Button 1 ] [ Button 2 ]
[ Button 3 ]
```

Styles supported by the current Telegram Bot API implementation:

```text
primary
success
danger
```

## 🔐 Required channel for groups

An admin can configure a required channel from:

`/groupsetting → Require Channel`

The bot verifies that it is an admin in the configured channel before saving it.

When a new member joins the group:

1. Bot checks channel membership.
2. If the user has joined, normal group access continues.
3. If not, the bot attempts to mute the user.
4. The user receives a join button and **Check & Unmute** button.
5. After joining the channel, the user presses **Check & Unmute**.
6. Bot checks membership again and restores normal permissions.

The bot needs administrator permission to restrict members in the group and administrator access in the required channel to verify membership reliably.

## 📢 Private channel join requests

Channel settings support:

- Enable / Disable
- Notify Only
- Auto Accept
- Custom message
- Custom buttons
- Preview
- Separate statistics for channel-request users

Join-request users are stored in the database so they can be counted and, where Telegram permits messaging, used as a broadcast audience.

## 📣 Broadcast

Reply to a message and use:

```text
/broadcast
```

The flow is:

```text
Copy / Forward
       ↓
Pin / Without Pin
       ↓
Broadcast
```

Node hosts use the local broadcast runner. Cloudflare uses Queues to keep each invocation small.

## 🗄️ Database model

### Cloudflare

```text
D1
├── chats
├── chat_settings
├── pending_settings
├── connections
└── channel_request_users
```

### MongoDB

```text
chats
chat_settings
pending_settings
connections
channel_request_users
```

## 🔒 Security

Never commit:

```text
BOT_TOKEN
MONGODB_URL
```

If a BotFather token is exposed, revoke it immediately and create a new token.

## 🩺 Health check

All Node deployments expose:

```text
GET /health
```

Cloudflare exposes the same health endpoint.

## 🧪 Local testing

```bash
cp .env.example .env
# edit .env — BOT_TOKEN, BOT_USERNAME and MONGODB_URL are required
npm install
npm run check
npm start
```

Health check:

```text
http://localhost:3000/health
```

For local Telegram webhook testing, use an HTTPS tunnel such as Cloudflare Tunnel or another trusted HTTPS tunnel and set `WEBHOOK_URL` to that public URL.

## ⚠️ Important platform notes

- Cloudflare Workers is the preferred low-cost/serverless deployment for this architecture.
- MongoDB is required for the Vercel/Node entry point; it is not bundled into the Worker path.
- Vercel is used as a webhook/serverless adapter, not as a permanent background process.

## License

See `LICENSE`.


## 🔐 Required Channels

Groups can have multiple required channels. The bot verifies every channel before saving it, checks that the bot is an admin there, and requires new members to join all configured channels before unmuting them. Public channels can use a username/link; private channels should use a channel ID together with an invite/join-request link.

## 📣 Broadcast audiences

`/broadcast` must be used as a reply to the message to send. The bot then offers:

- `Users` — normal users + channel-request users
- `Groups` — connected groups only
- `Channels` — connected channels only
- `All` — users + connected groups + connected channels

After selecting the audience, choose Copy/Forward, Pin/Without Pin, review the summary, then confirm Send.

If `/broadcast` is used without replying to a message, the bot shows an easy Broadcast Help screen with the audience rules and a bold block-quote warning.
