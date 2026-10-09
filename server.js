require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const API = 'https://discord.com/api/v10';

const REDIRECT_URI = process.env.REDIRECT_URI || 'https://ticket-bot-board.vercel.app/api/auth/callback';
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.TOKEN || process.env.BOT_TOKEN || process.env.DISCORD_BOT_TOKEN;
const BOT_NAME = process.env.BOT_NAME || 'Light Ticket Bot';
const BOT_AVATAR = process.env.BOT_AVATAR || 'https://i.postimg.cc/tJW3r0PJ/Screenshot-20261001-232609-ibis-Paint-X.jpg';
const SITE_BG = 'https://i.postimg.cc/s2x5kG7S/1791496064027.jpg';

if (!process.env.SESSION_SECRET) {
    console.warn('WARNING: Set SESSION_SECRET in your hosting environment.');
}

if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    console.warn('WARNING: Discord OAuth CLIENT_ID or CLIENT_SECRET is missing.');
}

if (!BOT_TOKEN) {
    console.warn('WARNING: BOT_TOKEN / TOKEN is missing.');
}

if (!MONGO_URI) {
    console.warn('WARNING: MONGO_URI is missing.');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB Connected in Dashboard'))
        .catch(error => console.error('MongoDB Error:', error.message));
}

const defaultOptions = [
    { label: 'استفسار', value: 'inquiry', emoji: '1493382115318960169', description: 'للاستفسارات العامة والأسئلة' },
    { label: 'شكوى', value: 'complaint', emoji: '1545031336274960384', description: 'تقديم شكوى إدارية' },
    { label: 'استلام هدايا', value: 'gifts', emoji: '1545029143777902702', description: 'استلام الجوائز والهدايا' },
    { label: 'شيء اخر ..', value: 'other', emoji: '1450547743025008650', description: 'أي موضوع آخر' }
];

const defaultAliases = {
    add: [{ alias: 'add', active: true }],
    come: [{ alias: 'come', active: true }],
    rename: [{ alias: 'rename', active: true }],
    claim: [{ alias: 'استلام', active: true }],
    timeout: [{ alias: 'تايم', active: true }],
    untimeout: [{ alias: 'فك-تايم', active: true }],
    warn: [{ alias: 'تحذير', active: true }],
    unwarn: [{ alias: 'فك-تحذير', active: true }],
    warns: [{ alias: 'تحذيرات', active: true }],
    close: [{ alias: 'اغلاق', active: true }],
    delete: [{ alias: 'حذف', active: true }],
    addpoints: [{ alias: 'addpoints', active: true }],
    removepoints: [{ alias: 'removepoints', active: true }],
    resettop: [{ alias: 'تصفير-التوب', active: true }]
};

const GuildSettings = mongoose.models.GuildSettings || mongoose.model(
    'GuildSettings',
    new mongoose.Schema({
        guildId: { type: String, required: true, unique: true },
        prefix: { type: String, default: '-' },
        staffRoleId: { type: String, default: '1555478928708337775' },
        ticketCategoryId: { type: String, default: '1555176022352208012' },
        logChannelId: { type: String, default: '1555488444182962216' },
        panelImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
        ticketImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
        panelTitle: { type: String, default: '🎫 LIGHT Support | الدعم الفني' },
        panelDescription: { type: String, default: 'مرحباً بك في نظام الدعم الفني الخاص بسيرفر LIGHT.' },
        botName: { type: String, default: 'Light Ticket Bot' },
        botAvatar: { type: String, default: 'https://i.postimg.cc/tJW3r0PJ/Screenshot-20261001-232609-ibis-Paint-X.jpg' },
        botStatus: { type: String, enum: ['online', 'idle', 'dnd', 'invisible'], default: 'online' },
        activityType: { type: Number, default: 0 },
        activityText: { type: String, default: '-help / التذاكر' },
        renameCooldown: { type: Number, default: 10 },
        selectOptions: { type: Array, default: defaultOptions },
        autoReplies: { type: Array, default: [] },
        rolePointsConfig: { type: Array, default: [] },
        commandPermissions: { type: Map, of: [String], default: {} },
        commandAliases: {
            type: Map,
            of: mongoose.Schema.Types.Mixed,
            default: defaultAliases
        }
    }, { timestamps: true })
);

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    store: MONGO_URI
        ? MongoStore.create({
            mongoUrl: MONGO_URI,
            ttl: 30 * 24 * 60 * 60
        })
        : undefined,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true
    }
}));

const ALLOWED_FIELDS = [
    'prefix', 'staffRoleId', 'ticketCategoryId', 'logChannelId',
    'panelImage', 'ticketImage', 'panelTitle', 'panelDescription',
    'botName', 'botAvatar', 'botStatus', 'activityType', 'activityText',
    'renameCooldown', 'selectOptions', 'autoReplies', 'rolePointsConfig',
    'commandPermissions', 'commandAliases'
];

function validSnowflake(value) {
    return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function validUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    if (!value.trim()) return true;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function plainSettings(settings) {
    const obj = settings.toObject();
    for (const key of ['commandPermissions', 'commandAliases']) {
        if (obj[key] instanceof Map) {
            obj[key] = Object.fromEntries(obj[key]);
        }
    }
    return obj;
}

function requireLogin(req, res, next) {
    if (!req.session?.user || (!req.session.accessToken && !req.session.refreshToken)) {
        if (req.session) {
            req.session.user = null;
            req.session.accessToken = null;
            req.session.refreshToken = null;
        }
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'انتهت جلسة تسجيل الدخول.' });
        }
        return res.redirect('/?error=login');
    }
    next();
}

async function getFreshUserGuilds(req, forceRefresh = false) {
    if (!forceRefresh && req.session.guilds && Array.isArray(req.session.guilds) && req.session.guilds.length > 0) {
        return req.session.guilds;
    }
    let accessToken = req.session.accessToken;
    async function fetchGuilds(token) {
        const response = await axios.get(`${API}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000
        });
        const manageableGuilds = response.data.filter(guild => {
            const permissions = BigInt(guild.permissions || '0');
            return (permissions & 8n) === 8n || (permissions & 32n) === 32n;
        });
        const checks = await Promise.all(
            manageableGuilds.map(async guild => {
                try {
                    await axios.get(`${API}/guilds/${guild.id}`, {
                        headers: { Authorization: `Bot ${BOT_TOKEN}` },
                        timeout: 7000
                    });
                    return guild;
                } catch {
                    return null;
                }
            })
        );
        return checks.filter(Boolean);
    }
    if (accessToken) {
        try {
            const guilds = await fetchGuilds(accessToken);
            req.session.guilds = guilds;
            return guilds;
        } catch (error) {
            if (error.response?.status !== 401) {
                if (req.session.guilds) return req.session.guilds;
                throw error;
            }
        }
    }
    if (req.session.refreshToken) {
        try {
            const refreshResponse = await axios.post(
                `${API}/oauth2/token`,
                new URLSearchParams({
                    client_id: process.env.CLIENT_ID,
                    client_secret: process.env.CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: req.session.refreshToken
                }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
            );
            accessToken = refreshResponse.data.access_token;
            req.session.accessToken = accessToken;
            if (refreshResponse.data.refresh_token) {
                req.session.refreshToken = refreshResponse.data.refresh_token;
            }
            const guilds = await fetchGuilds(accessToken);
            req.session.guilds = guilds;
            return guilds;
        } catch {
            req.session.accessToken = null;
            req.session.refreshToken = null;
            throw new Error('Discord session expired');
        }
    }
    throw new Error('Discord login required');
}

async function isAuthorizedGuild(req, guildId) {
    if (!req.session?.user || !validSnowflake(String(guildId))) return false;
    const guilds = await getFreshUserGuilds(req);
    return guilds.some(guild => String(guild.id) === String(guildId));
}

app.get('/login', (req, res) => {
    const clientId = process.env.CLIENT_ID;
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds'
    });
    return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/api/auth/callback', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) return res.redirect('/?error=login');
        const tokenResponse = await axios.post(
            `${API}/oauth2/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );
        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;
        const userResponse = await axios.get(`${API}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000
        });
        await new Promise((resolve, reject) => {
            req.session.regenerate(error => error ? reject(error) : resolve());
        });
        req.session.user = {
            id: userResponse.data.id,
            username: userResponse.data.username,
            global_name: userResponse.data.global_name || userResponse.data.username,
            avatar: userResponse.data.avatar
        };
        req.session.accessToken = accessToken;
        req.session.refreshToken = refreshToken;
        await new Promise((resolve, reject) => {
            req.session.save(error => error ? reject(error) : resolve());
        });
        return res.redirect('/dashboard');
    } catch {
        return res.redirect('/?error=login');
    }
});

app.get('/logout', (req, res) => {
    if (!req.session) return res.redirect('/');
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/', (req, res) => {
    if (req.session?.user && (req.session.accessToken || req.session.refreshToken) && !req.query.error) {
        return res.redirect('/dashboard');
    }
    const botName = escapeHtml(BOT_NAME);
    const botAvatar = validUrl(BOT_AVATAR) ? BOT_AVATAR : '';
    const background = validUrl(SITE_BG) ? SITE_BG : '';
    return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${botName} - لوحة التحكم</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Arial,sans-serif;color:#fff;background:#101116 ${background ? `url('${escapeHtml(background)}') center/cover fixed` : ''};display:flex;align-items:center;justify-content:center;padding:20px}
body:before{content:"";position:fixed;inset:0;background:rgba(10,11,18,.82);z-index:-1}
.card{width:100%;max-width:460px;background:rgba(27,29,40,.96);border:1px solid #343748;border-radius:22px;padding:34px;text-align:center;box-shadow:0 18px 60px #0005}
.avatar{width:100px;height:100px;border-radius:50%;object-fit:cover;background:#383b4b}
h1{font-size:27px;margin:18px 0 10px}
p{color:#b9bdcd;line-height:1.8}
a.btn{display:block;margin-top:24px;padding:14px;border-radius:12px;background:#5865f2;color:#fff;text-decoration:none;font-weight:bold}
a.btn:hover{background:#4752c4}
</style>
</head>
<body>
<div class="card">
${botAvatar ? `<img class="avatar" src="${escapeHtml(botAvatar)}" alt="Bot">` : ''}
<h1>${botName}</h1>
<p>لوحة تحكم بوت التذاكر. سجّل دخولك باستخدام Discord لإدارة إعدادات السيرفرات.</p>
<a class="btn" href="/login">تسجيل الدخول عبر Discord</a>
</div>
</body>
</html>`);
});

app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const guilds = await getFreshUserGuilds(req, true);
        const user = req.session.user;
        const username = escapeHtml(user.global_name || user.username);
        const userAvatar = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
            : 'https://cdn.discordapp.com/embed/avatars/0.png';

        const guildCards = guilds.map(guild => {
            const icon = guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
                : 'https://cdn.discordapp.com/embed/avatars/0.png';
            return `
<a class="guild" href="/dashboard/${encodeURIComponent(guild.id)}">
    <img src="${escapeHtml(icon)}" alt="">
    <div class="guild-info">
        <strong>${escapeHtml(guild.name || 'سيرفر بدون اسم')}</strong>
        <span>فتح لوحة التحكم</span>
    </div>
    <span class="arrow">←</span>
</a>`;
        }).join('');

        return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>السيرفرات - ${escapeHtml(BOT_NAME)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#101116;color:#f5f5fa;font-family:Arial,sans-serif;padding:22px}
header{max-width:1000px;margin:0 auto 28px;display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}
.brand{font-size:22px;font-weight:bold}
.profile{display:flex;align-items:center;gap:10px;color:#d6d8e3}
.profile img{width:38px;height:38px;border-radius:50%}
a{color:inherit;text-decoration:none}
.logout{padding:10px 14px;background:#292c3a;border-radius:10px;font-size:14px}
main{max-width:1000px;margin:auto}
h1{font-size:28px;margin-bottom:8px}
.subtitle{color:#a6aabd;margin-bottom:24px}
.guilds{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.guild{display:flex;align-items:center;gap:13px;padding:17px;background:#1b1d28;border:1px solid #303344;border-radius:15px}
.guild img{width:54px;height:54px;border-radius:16px;object-fit:cover}
.guild-info{flex:1}
.guild-info strong{display:block;font-size:15px}
.guild-info span{display:block;color:#a6aabd;font-size:12px;margin-top:7px}
</style>
</head>
<body>
<header>
    <div class="brand">${escapeHtml(BOT_NAME)} | لوحة التحكم</div>
    <div class="profile">
        <img src="${escapeHtml(userAvatar)}" alt="">
        <span>${username}</span>
        <a class="logout" href="/logout">تسجيل الخروج</a>
    </div>
</header>
<main>
    <h1>اختر السيرفر</h1>
    <div class="subtitle">اختر سيرفرًا لإدارة إعدادات البوت.</div>
    <div class="guilds">
        ${guildCards || '<div class="empty">لم يتم العثور على سيرفرات.</div>'}
    </div>
</main>
</body>
</html>`);
    } catch {
        return res.redirect('/?error=login');
    }
});

app.get('/api/roles/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;
        const response = await axios.get(`${API}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const roles = response.data.filter(r => r.id !== guildId && !r.managed).map(r => ({ id: r.id, name: r.name }));
        return res.json(roles);
    } catch {
        return res.status(500).json({ error: 'خطأ' });
    }
});

app.get('/api/settings/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;
        let settings = await GuildSettings.findOne({ guildId });
        if (!settings) settings = await GuildSettings.create({ guildId });
        return res.json(plainSettings(settings));
    } catch {
        return res.status(500).json({ error: 'خطأ' });
    }
});

app.post('/api/settings/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;
        const body = req.body || {};
        const updates = {};

        for (const key of Object.keys(body)) {
            if (!ALLOWED_FIELDS.includes(key)) continue;
            const value = body[key];

            if (key === 'prefix') {
                updates.prefix = String(value || '').trim().slice(0, 5);
            } else if (['staffRoleId', 'ticketCategoryId', 'logChannelId'].includes(key)) {
                updates[key] = String(value || '');
            } else if (['renameCooldown'].includes(key)) {
                updates[key] = Number(value) || 0;
            } else if (key === 'rolePointsConfig') {
                if (Array.isArray(value)) {
                    updates.rolePointsConfig = value.map(item => ({
                        roleId: String(item.roleId || ''),
                        command: String(item.command || 'claim'),
                        points: Number(item.points) || 1
                    })).filter(item => validSnowflake(item.roleId));
                }
            } else if (key === 'autoReplies') {
                if (Array.isArray(value)) {
                    updates.autoReplies = value.map(item => ({
                        trigger: String(item.trigger || ''),
                        reply: String(item.reply || ''),
                        roleId: String(item.roleId || 'all')
                    })).filter(i => i.trigger && i.reply);
                }
            } else {
                updates[key] = value;
            }
        }

        let settings = await GuildSettings.findOne({ guildId });
        if (!settings) settings = new GuildSettings({ guildId });

        for (const [k, v] of Object.entries(updates)) {
            settings.set(k, v);
        }

        await settings.save();
        return res.json({ success: true, settings: plainSettings(settings) });
    } catch {
        return res.status(500).json({ error: 'حدث خطأ أثناء الحفظ.' });
    }
});

app.get('/dashboard/:guildId', requireLogin, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        let guildName = 'إعدادات السيرفر';
        try {
            const r = await axios.get(`${API}/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            });
            guildName = r.data.name;
        } catch {}

        return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إعدادات السيرفر - ${escapeHtml(BOT_NAME)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#101116;color:#f5f5fa;font-family:Arial,sans-serif}
header{padding:18px 22px;background:#191b26;border-bottom:1px solid #303344;display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:bold;font-size:19px}
header a{color:#cdd0df;text-decoration:none;background:#292c3a;padding:10px 13px;border-radius:9px;font-size:13px}
main{max-width:1100px;margin:25px auto;padding:0 16px 40px}
h1{font-size:27px;margin:0 0 8px}
.sub{color:#a6aabd;margin-bottom:22px}
.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:start}
nav{background:#1b1d28;border:1px solid #303344;border-radius:14px;padding:8px}
nav button{width:100%;text-align:right;border:0;background:transparent;color:#bfc3d4;padding:13px 12px;border-radius:9px;cursor:pointer;font-size:14px}
nav button.active,nav button:hover{background:#30344a;color:#fff}
section.panel{display:none;background:#1b1d28;border:1px solid #303344;border-radius:15px;padding:20px}
section.panel.active{display:block}
h2{font-size:20px;margin:0 0 18px}
.field{margin-bottom:15px}
label{display:block;font-size:13px;color:#cdd0df;margin-bottom:7px}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid #3a3e52;border-radius:9px;background:#12141c;color:#fff;font:inherit;outline:none}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.help{font-size:12px;color:#999fb4;margin-top:6px}
.savebar{display:flex;align-items:center;gap:12px;margin-top:20px}
.save{border:0;background:#5865f2;color:white;padding:12px 20px;border-radius:10px;font-weight:bold;cursor:pointer}
.alias-card{background:#12141c;border:1px solid #3a3e52;padding:15px;border-radius:10px;margin-bottom:12px}
.btn-sm{padding:6px 12px;border-radius:6px;border:0;cursor:pointer;font-size:12px;font-weight:bold}
.btn-add{background:#57f287;color:#000}
.btn-danger{background:#ed4245;color:#fff}
</style>
</head>
<body>
<header>
    <div class="brand">${escapeHtml(BOT_NAME)} | لوحة التحكم</div>
    <div><a href="/dashboard">السيرفرات</a> <a href="/logout">تسجيل الخروج</a></div>
</header>
<main>
    <h1>${escapeHtml(guildName)}</h1>
    <div class="sub">عدّل إعدادات البوت ثم اضغط «حفظ الإعدادات».</div>
    <div class="layout">
        <nav id="tabs">
            <button class="active" data-tab="general">إعدادات البوت</button>
            <button data-tab="channels">القنوات والرتب</button>
            <button data-tab="panel">لوحة التذاكر</button>
            <button data-tab="autoreplies">الرد التلقائي</button>
            <button data-tab="rolepoints">نقاط الرتب بالأمر</button>
            <button data-tab="points">المهلة</button>
        </nav>
        <div>
            <section class="panel active" id="general">
                <h2>إعدادات البوت</h2>
                <div class="field"><label>اسم البوت</label><input id="botName"></div>
                <div class="field"><label>رابط صورة البوت</label><input id="botAvatar"></div>
                <div class="field"><label>نص النشاط</label><input id="activityText"></div>
            </section>
            <section class="panel" id="channels">
                <h2>القنوات والرتب</h2>
                <div class="field"><label>رتبة الإدارة العامة</label><input id="staffRoleId"></div>
                <div class="field"><label>كاتيجوري التذاكر</label><input id="ticketCategoryId"></div>
                <div class="field"><label>قناة اللوق</label><input id="logChannelId"></div>
            </section>
            <section class="panel" id="panel">
                <h2>لوحة التذاكر</h2>
                <div class="field"><label>عنوان اللوحة</label><input id="panelTitle"></div>
                <div class="field"><label>وصف اللوحة</label><textarea id="panelDescription"></textarea></div>
                <div class="field"><label>صورة اللوحة</label><input id="panelImage"></div>
                <div class="field"><label>صورة التذكرة</label><input id="ticketImage"></div>
            </section>
            <section class="panel" id="autoreplies">
                <h2>الرد التلقائي</h2>
                <div id="autoReplyContainer"></div>
                <button type="button" class="btn-sm btn-add" onclick="addAutoReply()">+ ضيف رد جديد</button>
            </section>
            <section class="panel" id="rolepoints">
                <h2>نقاط الرتب بالأمر</h2>
                <p class="help">اختر الرتبة، ثم اختر الأمر المحدد، ثم حدد النقاط الخاصة به.</p>
                <div id="rolePointsContainer"></div>
                <button type="button" class="btn-sm btn-add" onclick="addRolePointConfig()">+ اضافة رتبه</button>
            </section>
            <section class="panel" id="points">
                <h2>المهلة</h2>
                <div class="field"><label>مهلة إعادة تسمية التذكرة بالدقائق</label><input id="renameCooldown" type="number"></div>
            </section>
            <div class="savebar">
                <button class="save" id="saveButton">حفظ الإعدادات</button>
                <span id="status"></span>
            </div>
        </div>
    </div>
</main>
<script>
(function () {
    const guildId = ${JSON.stringify(guildId)};
    let roles = [], autoRepliesData = [], rolePointsData = [];
    const commandsList = [
        { id: 'claim', name: 'استلام (claim)' },
        { id: 'timeout', name: 'تايم أوت (timeout)' },
        { id: 'warn', name: 'تحذير (warn)' },
        { id: 'unwarn', name: 'فك تحذير (unwarn)' },
        { id: 'warns', name: 'عرض التحذيرات (warns)' },
        { id: 'close', name: 'إغلاق التذكرة (close)' }
    ];

    document.querySelectorAll('#tabs button').forEach(b => {
        b.onclick = () => {
            document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('section.panel').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            document.getElementById(b.dataset.tab).classList.add('active');
        };
    });

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function renderAutoReplies() {
        const c = document.getElementById('autoReplyContainer');
        c.innerHTML = '';
        autoRepliesData.forEach((item, idx) => {
            let opts = '<option value="all" ' + (item.roleId === 'all' ? 'selected' : '') + '>الجميع</option>';
            roles.forEach(r => { opts += '<option value="' + r.id + '" ' + (item.roleId === r.id ? 'selected' : '') + '>' + escapeHtml(r.name) + '</option>'; });
            const d = document.createElement('div');
            d.className = 'alias-card';
            d.innerHTML = \`<div class="field"><label>الكلمة</label><input value="\${escapeHtml(item.trigger)}" onchange="autoRepliesData[\${idx}].trigger=this.value"></div>
                <div class="field"><label>الرد</label><textarea onchange="autoRepliesData[\${idx}].reply=this.value">\${escapeHtml(item.reply)}</textarea></div>
                <div class="field"><label>الرتبة</label><select onchange="autoRepliesData[\${idx}].roleId=this.value">\${opts}</select></div>
                <button type="button" class="btn-sm btn-danger" onclick="autoRepliesData.splice(\${idx},1);renderAutoReplies()">حذف</button>\`;
            c.appendChild(d);
        });
    }
    window.addAutoReply = () => { autoRepliesData.push({ trigger: '', reply: '', roleId: 'all' }); renderAutoReplies(); };

    function renderRolePoints() {
        const c = document.getElementById('rolePointsContainer');
        c.innerHTML = '';
        rolePointsData.forEach((item, idx) => {
            let rOpts = '<option value="">-- اختر الرتبة --</option>';
            roles.forEach(r => { rOpts += '<option value="' + r.id + '" ' + (item.roleId === r.id ? 'selected' : '') + '>' + escapeHtml(r.name) + '</option>'; });
            let cOpts = '';
            commandsList.forEach(cmd => { cOpts += '<option value="' + cmd.id + '" ' + (item.command === cmd.id ? 'selected' : '') + '>' + cmd.name + '</option>'; });
            const d = document.createElement('div');
            d.className = 'alias-card';
            d.innerHTML = \`<div class="field"><label>الرتبة</label><select onchange="rolePointsData[\${idx}].roleId=this.value">\${rOpts}</select></div>
                <div class="field"><label>الأمر</label><select onchange="rolePointsData[\${idx}].command=this.value">\${cOpts}</select></div>
                <div class="field"><label>عدد النقاط</label><input type="number" value="\${item.points ?? 1}" onchange="rolePointsData[\${idx}].points=Number(this.value)"></div>
                <button type="button" class="btn-sm btn-danger" onclick="rolePointsData.splice(\${idx},1);renderRolePoints()">حذف</button>\`;
            c.appendChild(d);
        });
    }
    window.addRolePointConfig = () => { rolePointsData.push({ roleId: '', command: 'claim', points: 1 }); renderRolePoints(); };

    async function load() {
        const [sRes, rRes] = await Promise.all([
            fetch('/api/settings/' + guildId).then(r => r.json()),
            fetch('/api/roles/' + guildId).then(r => r.json()).catch(() => [])
        ]);
        roles = Array.isArray(rRes) ? rRes : [];
        autoRepliesData = sRes.autoReplies || [];
        rolePointsData = sRes.rolePointsConfig || [];

        ['botName','botAvatar','activityText','staffRoleId','ticketCategoryId','logChannelId','panelTitle','panelDescription','panelImage','ticketImage','renameCooldown','prefix'].forEach(k => {
            if (sRes[k] !== undefined) document.getElementById(k).value = sRes[k];
        });
        renderAutoReplies();
        renderRolePoints();
    }

    document.getElementById('saveButton').onclick = async function() {
        this.disabled = true;
        document.getElementById('status').textContent = 'جارٍ الحفظ...';
        const payload = {
            botName: document.getElementById('botName').value,
            botAvatar: document.getElementById('botAvatar').value,
            activityText: document.getElementById('activityText').value,
            staffRoleId: document.getElementById('staffRoleId').value,
            ticketCategoryId: document.getElementById('ticketCategoryId').value,
            logChannelId: document.getElementById('logChannelId').value,
            panelTitle: document.getElementById('panelTitle').value,
            panelDescription: document.getElementById('panelDescription').value,
            panelImage: document.getElementById('panelImage').value,
            ticketImage: document.getElementById('ticketImage').value,
            renameCooldown: Number(document.getElementById('renameCooldown').value),
            autoReplies: autoRepliesData,
            rolePointsConfig: rolePointsData
        };
        const res = await fetch('/api/settings/' + guildId, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        this.disabled = false;
        document.getElementById('status').textContent = res.ok ? 'تم الحفظ بنجاح.' : 'فشل الحفظ.';
    };

    load();
})();
</script>
</body>
</html>`);
    } catch {
        return res.status(500).send('حدث خطأ.');
    }
});

app.use((req, res) => res.status(404).send('غير موجود.'));
if (process.env.NODE_ENV !== 'production') app.listen(PORT);
module.exports = app;
