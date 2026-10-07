import { chatKind } from './helper.js';

const SEEN_TTL = 10 * 60 * 1000;

export function createD1Store(db) {
    const seen = new Map();
    let ready = null;

    function init() {
        if (!ready) ready = (async () => {
            await db.prepare('CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY, kind TEXT NOT NULL)').run();
            await db.prepare(`CREATE TABLE IF NOT EXISTS chat_settings (
                chat_id INTEGER PRIMARY KEY,
                reactions_enabled INTEGER NOT NULL DEFAULT 1,
                reactions TEXT,
                welcome_enabled INTEGER NOT NULL DEFAULT 1,
                welcome_mode TEXT NOT NULL DEFAULT 'group',
                welcome_message TEXT,
                welcome_buttons TEXT,
                join_enabled INTEGER NOT NULL DEFAULT 0,
                join_mode TEXT NOT NULL DEFAULT 'notify',
                join_message TEXT,
                join_buttons TEXT,
                required_channel_id INTEGER,
                required_channel_url TEXT,
                required_channels TEXT,
                required_buttons TEXT,
                required_enabled INTEGER NOT NULL DEFAULT 1
            )`).run();
            await db.prepare(`CREATE TABLE IF NOT EXISTS pending_settings (
                user_id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, mode TEXT NOT NULL, payload TEXT, expires_at INTEGER NOT NULL
            )`).run();
            await db.prepare(`CREATE TABLE IF NOT EXISTS channel_request_users (user_id INTEGER PRIMARY KEY, first_seen INTEGER NOT NULL)`).run();
            await db.prepare("INSERT OR IGNORE INTO chats(id,kind) SELECT user_id,'users' FROM channel_request_users").run();
            await db.prepare(`CREATE TABLE IF NOT EXISTS connections (
                user_id INTEGER NOT NULL, chat_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT, PRIMARY KEY(user_id, chat_id)
            )`).run();
            const migrations = [
                'ALTER TABLE chat_settings ADD COLUMN required_channel_id INTEGER',
                'ALTER TABLE chat_settings ADD COLUMN required_channel_url TEXT',
                'ALTER TABLE chat_settings ADD COLUMN required_channels TEXT',
                'ALTER TABLE chat_settings ADD COLUMN required_buttons TEXT',
                'ALTER TABLE chat_settings ADD COLUMN required_enabled INTEGER NOT NULL DEFAULT 1',
                'ALTER TABLE chat_settings ADD COLUMN join_enabled INTEGER NOT NULL DEFAULT 0',
                'ALTER TABLE connections ADD COLUMN title TEXT'
            ];
            for (const sql of migrations) { try { await db.prepare(sql).run(); } catch (_) {} }
        })().catch(e => { ready = null; throw e; });
        return ready;
    }
    async function row(id) { await init(); return db.prepare('SELECT * FROM chat_settings WHERE chat_id=?1').bind(id).first(); }
    function normalize(r) { return {
        reactions_enabled: r?.reactions_enabled !== 0, reactions: parseJson(r?.reactions),
        welcome_enabled: r?.welcome_enabled !== 0, welcome_mode: r?.welcome_mode || 'group', welcome_message: r?.welcome_message || '', welcome_buttons: parseJson(r?.welcome_buttons) || [],
        join_enabled: r?.join_enabled === 1, join_mode: r?.join_mode || 'notify', join_message: r?.join_message || '', join_buttons: parseJson(r?.join_buttons) || [],
        required_channel_id: r?.required_channel_id ? Number(r.required_channel_id) : null, required_channel_url: r?.required_channel_url || '', required_channels: parseJson(r?.required_channels) || [], required_buttons: parseJson(r?.required_buttons) || [], required_enabled: r?.required_enabled === 1
    }; }
    return {
        async add(id,type,{force=false}={}) { const kind=chatKind(type); if(!kind)return; const last=seen.get(id); if(!force&&last&&Date.now()-last<SEEN_TTL)return; await init(); await db.prepare('INSERT OR IGNORE INTO chats(id,kind) VALUES(?1,?2)').bind(id,kind).run(); seen.set(id,Date.now()); },
        async remove(id){await init();seen.delete(id);await db.prepare('DELETE FROM chats WHERE id=?1').bind(id).run();await db.prepare('DELETE FROM chat_settings WHERE chat_id=?1').bind(id).run();await db.prepare('DELETE FROM connections WHERE chat_id=?1').bind(id).run();},
        async setReactionsEnabled(id,v){await init();await db.prepare(`INSERT INTO chat_settings(chat_id,reactions_enabled) VALUES(?1,?2) ON CONFLICT(chat_id) DO UPDATE SET reactions_enabled=excluded.reactions_enabled`).bind(id,v?1:0).run();},
        async setReactions(id,v){await init();await db.prepare(`INSERT INTO chat_settings(chat_id,reactions) VALUES(?1,?2) ON CONFLICT(chat_id) DO UPDATE SET reactions=excluded.reactions`).bind(id,JSON.stringify(v||[])).run();},
        async resetReactions(id){await init();await db.prepare('UPDATE chat_settings SET reactions=NULL WHERE chat_id=?1').bind(id).run();},
        async getReactions(id){return parseJson((await row(id))?.reactions);},
        async isReactionsEnabled(id){return normalize(await row(id)).reactions_enabled;},
        async setPending(userId,chatId,mode,payload=null,ttlMs=300000){await init();await db.prepare(`INSERT INTO pending_settings(user_id,chat_id,mode,payload,expires_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,mode=excluded.mode,payload=excluded.payload,expires_at=excluded.expires_at`).bind(userId,chatId,mode,payload==null?null:JSON.stringify(payload),Date.now()+ttlMs).run();},
        async getPending(userId){await init();const r=await db.prepare('SELECT * FROM pending_settings WHERE user_id=?1').bind(userId).first();if(!r)return null;if(Number(r.expires_at)<Date.now()){await this.clearPending(userId);return null;}return {chatId:Number(r.chat_id),mode:r.mode,payload:parseJson(r.payload)};},
        async clearPending(userId){await init();await db.prepare('DELETE FROM pending_settings WHERE user_id=?1').bind(userId).run();},
        async hasGroupSettings(id){return !!(await row(id));},
        async getGroupSettings(id){return normalize(await row(id));},
        async updateGroupSettings(id,patch){await init();const f=Object.entries(patch);if(!f.length)return;await db.prepare('INSERT OR IGNORE INTO chat_settings(chat_id) VALUES(?1)').bind(id).run();const cols=f.map(([k])=>`${k}=?`).join(',');const vals=f.map(([,v])=>Array.isArray(v)?JSON.stringify(v):v);await db.prepare(`UPDATE chat_settings SET ${cols} WHERE chat_id=?`).bind(...vals,id).run();},
        async connect(userId,chatId,kind,title=''){await init();await db.prepare(`INSERT INTO connections(user_id,chat_id,kind,title) VALUES(?1,?2,?3,?4) ON CONFLICT(user_id,chat_id) DO UPDATE SET kind=excluded.kind,title=excluded.title`).bind(userId,chatId,kind,title).run();},
        async addChannelRequestUser(userId){await init();await db.prepare('INSERT OR IGNORE INTO chats(id,kind) VALUES(?1,\'users\')').bind(userId).run();await db.prepare('INSERT OR IGNORE INTO channel_request_users(user_id,first_seen) VALUES(?1,?2)').bind(userId,Date.now()).run();},
        async channelRequestCount(){await init();return Number((await db.prepare('SELECT COUNT(*) n FROM channel_request_users').first())?.n||0);},
        async audienceIds(audience='users',afterId=Number.MIN_SAFE_INTEGER,limit=1000000){
            await init(); const ids=new Set();
            const kinds=audience==='groups'?['group']:audience==='channels'?['channel']:audience==='all'?['group','channel']:[];
            if(kinds.length){const marks=kinds.map((_,i)=>`?${i+3}`).join(',');const r=await db.prepare(`SELECT DISTINCT chat_id FROM connections WHERE chat_id>?1 AND kind IN(${marks}) ORDER BY chat_id LIMIT ?2`).bind(afterId,limit,...kinds).all();for(const x of r.results||[])ids.add(Number(x.chat_id));}
            if(audience==='users'||audience==='all'){const r=await db.prepare("SELECT id FROM chats WHERE id>?1 AND kind=\'users\' ORDER BY id LIMIT ?2").bind(afterId,limit).all();for(const x of r.results||[])ids.add(Number(x.id));}
            return [...ids].sort((a,b)=>a-b).slice(0,limit);
        },
        async audienceCount(audience='users'){ await init(); let n=0; if(audience==='groups'||audience==='channels'||audience==='all'){const kinds=audience==='groups'?['group']:audience==='channels'?['channel']:['group','channel'];const marks=kinds.map((_,i)=>`?${i+1}`).join(',');n+=Number((await db.prepare(`SELECT COUNT(DISTINCT chat_id) n FROM connections WHERE kind IN(${marks})`).bind(...kinds).first())?.n||0);} if(audience==='users'||audience==='all'){n+=Number((await db.prepare("SELECT COUNT(*) n FROM chats WHERE kind='users'").first())?.n||0);} return n; },
        async channelRequestIds(afterId=Number.MIN_SAFE_INTEGER,limit=1000000){await init();const r=await db.prepare('SELECT user_id FROM channel_request_users WHERE user_id>?1 ORDER BY user_id LIMIT ?2').bind(afterId,limit).all();return (r.results||[]).map(x=>Number(x.user_id));},
        async disconnect(userId,chatId){await init();await db.prepare('DELETE FROM connections WHERE user_id=?1 AND chat_id=?2').bind(userId,chatId).run();},
        async connections(userId,kind=null){await init();const q=kind?'SELECT * FROM connections WHERE user_id=?1 AND kind=?2 ORDER BY title':'SELECT * FROM connections WHERE user_id=?1 ORDER BY kind,title';const r=kind?await db.prepare(q).bind(userId,kind).all():await db.prepare(q).bind(userId).all();return r.results||[];},
        async counts(){await init();const r=await db.prepare('SELECT kind,COUNT(*) n FROM chats GROUP BY kind').all();const c={users:0,groups:0,channels:0};for(const x of r.results||[])if(x.kind in c)c[x.kind]=Number(x.n);return c;},
        async ids(kinds,afterId=Number.MIN_SAFE_INTEGER,limit=1000000){await init();const marks=kinds.map((_,i)=>`?${i+3}`).join(',');const r=await db.prepare(`SELECT id FROM chats WHERE id>?1 AND kind IN(${marks}) ORDER BY id LIMIT ?2`).bind(afterId,limit,...kinds).all();return (r.results||[]).map(x=>Number(x.id));}
    };
}
function parseJson(v){if(!v)return null;try{return JSON.parse(v);}catch{return null;}}
