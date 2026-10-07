import TelegramBotAPI from "./TelegramBotAPI.js";
import { htmlContent } from './constants.js';
import { splitEmojis, returnHTML, getChatIds } from "./helper.js";
import { onUpdate } from './bot-handler.js';
import { logger, setLogLevel } from './logger.js';
import { createD1Store } from './store-d1.js';
import { broadcastStep, progressText, finishText, errorText, editStatus } from './broadcast.js';

const BROADCAST_CHUNK = 20;
let webhookReady = false;

let configCache = null;

function getConfig(env) {

    if (!configCache || configCache.env !== env) {

        setLogLevel(env.LOG_LEVEL);
        configCache = {
            env: env,
            botToken: env.BOT_TOKEN,
            botUsername: env.BOT_USERNAME,
            reactions: splitEmojis(env.EMOJI_LIST),
            restrictedChats: getChatIds(env.RESTRICTED_CHATS),
            randomLevel: Math.min(10, Math.max(0, Number.parseInt(env.RANDOM_LEVEL || '0', 10) || 0)),
            botApi: new TelegramBotAPI(env.BOT_TOKEN),
            store: env.DB ? createD1Store(env.DB) : null,
            adminIds: getChatIds(env.ADMIN_IDS),
            updatesUrl: env.UPDATES_URL || undefined,
            supportUrl: env.SUPPORT_URL || undefined,
            startAnimation: env.START_ANIMATION || undefined,
            donateAnimation: env.DONATE_ANIMATION || undefined,
            defaultReactions: splitEmojis(env.EMOJI_LIST)
        };
    }
    return configCache;
}

export default {
    async fetch(request, env) {

        const config = getConfig(env);
        const url = new URL(request.url);

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {

            if (env.AUTO_SET_WEBHOOK !== 'false' && !webhookReady && config.botToken) {
                try {
                    await config.botApi.setWebhook(url.origin + '/', env.WEBHOOK_SECRET || undefined);
                    webhookReady = true;
                } catch (error) {
                    logger.warn('Automatic webhook setup failed:', error.message);
                }
            }
        }

        if (url.pathname === '/health' && request.method === 'GET') {
            return new Response(JSON.stringify({
                status: 'ok',
                timestamp: new Date().toISOString(),
                environment: env.NODE_ENV || 'production',
                botConfigured: !!config.botToken && !!config.botUsername
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (request.method === 'POST') {
            if (env.WEBHOOK_SECRET && request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
            if (!config.store) return new Response('D1 database is not bound. Bind a D1 database as DB in wrangler.toml.', { status: 500 });
            let data;
            try {
                data = await request.json();
            } catch {
                return new Response('Invalid JSON', { status: 400 });
            }
            try {
                await onUpdate(
                    data,
                    config.botApi,
                    config.reactions,
                    config.restrictedChats,
                    config.botUsername,
                    config.randomLevel,
                    {
                        store: config.store,
                        adminIds: config.adminIds,
                        updatesUrl: config.updatesUrl,
                        supportUrl: config.supportUrl,
                        startAnimation: config.startAnimation,
                        donateAnimation: config.donateAnimation,
                        botUsername: config.botUsername,
                        defaultReactions: config.reactions,
                        enqueueBroadcast: env.BROADCAST_QUEUE ? (job) => env.BROADCAST_QUEUE.send(job) : null
                    }
                )
            } catch (error) {
                logger.error('Error in onUpdate:', error.message)
            }
        } else {
            return returnHTML(htmlContent)
        }

        return new Response('Ok', { status: 200 })
    },

    async queue(batch, env) {
        const config = getConfig(env);
        for (const message of batch.messages) {
            let job = message.body;
            try {
                const step = await broadcastStep(config.botApi, config.store, job, BROADCAST_CHUNK);
                job = step.job;

                if (step.done) {
                    await editStatus(config.botApi, job, finishText(job));
                } else {
                    if (Date.now() - (job.lastEdit || 0) > 4000) {
                        job.lastEdit = Date.now();
                        await editStatus(config.botApi, job, progressText(job));
                    }
                    await env.BROADCAST_QUEUE.send(job, { delaySeconds: 1 });
                }
            } catch (error) {
                logger.error('Broadcast error:', error.message);
                await editStatus(config.botApi, job, errorText(job, error));
            }
            message.ack();
        }
    }
};
