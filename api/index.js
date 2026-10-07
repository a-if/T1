import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import TelegramBotAPI from './TelegramBotAPI.js';
import { htmlContent } from './constants.js';
import { splitEmojis, getChatIds, webhookRootUrl } from './helper.js';
import { createMongoStore } from './store-mongo.js';
import { runBroadcastLocal } from './broadcast.js';
import { waitUntil } from '@vercel/functions';
import { onUpdate } from './bot-handler.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
app.use(express.json());

const botToken = process.env.BOT_TOKEN;
const botUsername = process.env.BOT_USERNAME;
const Reactions = splitEmojis(process.env.EMOJI_LIST);
const RestrictedChats = getChatIds(process.env.RESTRICTED_CHATS);
const RandomLevel = parseInt(process.env.RANDOM_LEVEL || '0', 10);

const botApi = new TelegramBotAPI(botToken);

const publicOrigin = webhookRootUrl(process.env.WEBHOOK_URL || process.env.PUBLIC_URL);

function makeEnqueueBroadcast(api) {
    let running = false;
    return async (job) => {
        if (running) throw new Error('A broadcast is already running');
        running = true;
        const task = runBroadcastLocal(api, store, job).finally(() => { running = false; });

        if (process.env.VERCEL) waitUntil(task);
    };
}
let webhookPromise = null;
let webhookSetupError = null;
function desiredWebhookUrl() {

    return webhookRootUrl(process.env.WEBHOOK_URL || process.env.PUBLIC_URL);
}
async function ensureWebhook() {
    if (process.env.AUTO_SET_WEBHOOK === 'false' || !botToken) return;
    const webhookUrl = desiredWebhookUrl();
    if (!webhookUrl || webhookPromise) return webhookPromise;
    webhookSetupError = null;
    webhookPromise = botApi.setWebhook(webhookUrl, process.env.WEBHOOK_SECRET || undefined).catch(error => { webhookSetupError = error.message; logger.warn(`Webhook setup failed: ${error.message}`); webhookPromise = null; });
    return webhookPromise;
}

const mongoUrl = process.env.MONGODB_URL;
if (!mongoUrl) {
    logger.error('MONGODB_URL is not set. Set it to a MongoDB connection string (e.g. MongoDB Atlas) and redeploy.');
}
const store = mongoUrl ? createMongoStore(mongoUrl, process.env.MONGODB_DB || 'reaction-bot') : null;
const options = {
    store,
    adminIds: getChatIds(process.env.ADMIN_IDS),
    updatesUrl: process.env.UPDATES_URL || undefined,
    supportUrl: process.env.SUPPORT_URL || undefined,
    startAnimation: process.env.START_ANIMATION || (publicOrigin ? publicOrigin + '/start.jpg' : undefined),
    donateAnimation: process.env.DONATE_ANIMATION || undefined,
    botUsername,
    mainBotUsername: botUsername,
    defaultReactions: Reactions,
    publicOrigin,
    enqueueBroadcast: makeEnqueueBroadcast(botApi)
};

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => { try { if (store && store.close) await store.close(); } finally { process.exit(0); } });
}

app.post('/', async (req, res) => {
    if (process.env.WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== process.env.WEBHOOK_SECRET) return res.status(401).send('Unauthorized');
    if (!store) return res.status(500).send('Database not configured: set MONGODB_URL');
    if (process.env.VERCEL) await ensureWebhook();
    const data = req.body;
    try {
        await onUpdate(data, botApi, Reactions, RestrictedChats, botUsername, RandomLevel, options);
        res.status(200).send('Ok');
    } catch (error) {
        logger.error('Error in onUpdate:', error.message);
        res.status(200).send('Ok');
    }
});

app.get('/', (req, res) => {
    res.send(htmlContent);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.get('/start.jpg', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'start.jpg'));
});

app.post('/clone/:id', async (req, res) => {
    const clone = store && typeof store.getClone === 'function'
        ? await store.getClone(req.params.id).catch(() => null)
        : null;
    if (!clone) return res.status(404).send('Not found');
    if (clone.secret && req.get('x-telegram-bot-api-secret-token') !== clone.secret) {
        return res.status(401).send('Unauthorized');
    }
    const cloneApi = new TelegramBotAPI(clone.token);
    let cloneUsername = clone.username || '';
    try { cloneUsername = (await cloneApi.getMe()).username || cloneUsername; } catch (_) {}
    const cloneOptions = {
        ...options,
        botUsername: cloneUsername,
        adminIds: [clone.ownerId],
        isClone: true,
        enqueueBroadcast: makeEnqueueBroadcast(cloneApi),
    };
    try {
        await onUpdate(req.body, cloneApi, Reactions, RestrictedChats, cloneUsername, RandomLevel, cloneOptions);
        res.status(200).send('Ok');
    } catch (error) {
        logger.error('Error in clone onUpdate:', error.message);
        res.status(200).send('Ok');
    }
});

app.get('/health', async (req, res) => {

    let tgWebhook = null;
    if (process.env.VERCEL) {
        await ensureWebhook();
        try { tgWebhook = await botApi.getWebhookInfo(); }
        catch (e) { if (!webhookSetupError) webhookSetupError = e.message; }
    }
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        botConfigured: !!botToken && !!botUsername,
        dbConfigured: !!store,
        webhookDesired: desiredWebhookUrl(),
        webhookActual: tgWebhook?.url || null,
        webhookPending: tgWebhook?.pending_update_count ?? null,
        webhookLastError: tgWebhook?.last_error_message || null,
        webhookSetupError
    });
});

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
    app.listen(PORT, async () => {
        logger.info(`Server is running on port ${PORT}`);
        await ensureWebhook();
    });
}

export default app;
