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
    warn: [{ alias: 'تحذير', active: true }],
    close: [{ alias: 'اغلاق', active: true }],
    delete: [{ alias: 'حذف', active: true }],
    addpoints: [{ alias: 'addpoints', active: true }],
    removepoints: [{ alias: 'removepoints', active: true }]
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
        claimPoints: { type: Number, default: 1 },
        warnPoints: { type: Number, default: 1 },
        timeoutPoints: { type: Number, default: 1 },
        renameCooldown: { type: Number, default: 10 },
        selectOptions: { type: Array, default: defaultOptions },
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

const COMMANDS = [
    'add', 'come', 'rename', 'claim', 'timeout',
    'warn', 'close', 'delete', 'addpoints', 'removepoints'
];

const COMMAND_NAMES = {
    add: 'إضافة عضو (add)',
    come: 'استدعاء إداري (come)',
    rename: 'إعادة تسمية (rename)',
    claim: 'استلام التذكرة (claim)',
    timeout: 'تايم عضو (timeout)',
    warn: 'تحذير عضو (warn)',
    close: 'قفل التذكرة (close)',
    delete: 'حذف التذكرة (delete)',
    addpoints: 'إضافة نقاط (addpoints)',
    removepoints: 'إزالة نقاط (removepoints)'
};

const ALLOWED_FIELDS = [
    'prefix', 'staffRoleId', 'ticketCategoryId', 'logChannelId',
    'panelImage', 'ticketImage', 'panelTitle', 'panelDescription',
    'botName', 'botAvatar', 'botStatus', 'activityType', 'activityText',
    'claimPoints', 'warnPoints', 'timeoutPoints', 'renameCooldown',
    'selectOptions', 'commandPermissions', 'commandAliases'
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
            return res.status(401).json({ error: 'انتهت جلسة تسجيل الدخول. سجّل دخولك مجدداً.' });
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
                } catch (error) {
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
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: 10000
                }
            );

            accessToken = refreshResponse.data.access_token;
            req.session.accessToken = accessToken;
            if (refreshResponse.data.refresh_token) {
                req.session.refreshToken = refreshResponse.data.refresh_token;
            }

            const guilds = await fetchGuilds(accessToken);
            req.session.guilds = guilds;
            return guilds;
        } catch (error) {
            req.session.accessToken = null;
            req.session.refreshToken = null;
            throw new Error('Discord session expired');
        }
    }

    throw new Error('Discord login required');
}

async function isAuthorizedGuild(req, guildId) {
    if (!req.session?.user || !validSnowflake(String(guildId))) {
        return false;
    }

    const guilds = await getFreshUserGuilds(req);
    return guilds.some(guild => String(guild.id) === String(guildId));
}

app.get('/login', (req, res) => {
    const clientId = process.env.CLIENT_ID;

    if (!clientId || !process.env.CLIENT_SECRET || !REDIRECT_URI) {
        return res.status(500).send('إعدادات تسجيل الدخول غير مكتملة. راجع CLIENT_ID وCLIENT_SECRET وREDIRECT_URI.');
    }

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

        if (typeof code !== 'string' || !code) {
            return res.redirect('/?error=login');
        }

        const clientId = process.env.CLIENT_ID;
        const clientSecret = process.env.CLIENT_SECRET;

        if (!clientId || !clientSecret || !REDIRECT_URI) {
            return res.status(500).send('إعدادات Discord OAuth غير مكتملة.');
        }

        const tokenResponse = await axios.post(
            `${API}/oauth2/token`,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            }).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
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
    } catch (error) {
        console.error('Discord OAuth callback error:', error.response?.data || error.message);
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
    const loginError = req.query.error === 'login'
        ? '<p class="error">تعذّر تسجيل الدخول. حاول مرة أخرى.</p>'
        : '';

    res.set('Cache-Control', 'no-store');

    return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${botName} - لوحة التحكم</title>
<meta property="og:title" content="${botName} - لوحة التحكم">
<meta property="og:description" content="إدارة إعدادات بوت التذاكر بسهولة">
<meta property="og:image" content="${escapeHtml(botAvatar)}">
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
.small{font-size:13px;color:#9095a8;margin-top:22px}
.error{color:#ffaaaa}
</style>
</head>
<body>
<div class="card">
${botAvatar ? `<img class="avatar" src="${escapeHtml(botAvatar)}" alt="Bot">` : ''}
<h1>${botName}</h1>
<p>لوحة تحكم بوت التذاكر. سجّل دخولك باستخدام Discord لإدارة إعدادات السيرفرات التي تملك صلاحية إدارتها والبوت موجود فيها.</p>
${loginError}
<a class="btn" href="/login">تسجيل الدخول عبر Discord</a>
<div class="small">تسجيل الدخول عبر Discord OAuth2</div>
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

        res.set('Cache-Control', 'no-store');

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
.subtitle{color:#a6aabd;line-height:1.7;margin-bottom:24px}
.guilds{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.guild{display:flex;align-items:center;gap:13px;padding:17px;background:#1b1d28;border:1px solid #303344;border-radius:15px;transition:.15s}
.guild:hover{border-color:#6874ff;transform:translateY(-2px)}
.guild img{width:54px;height:54px;border-radius:16px;object-fit:cover;background:#303344}
.guild-info{min-width:0;flex:1}
.guild-info strong{display:block;overflow-wrap:anywhere;font-size:15px}
.guild-info span{display:block;color:#a6aabd;font-size:12px;margin-top:7px}
.arrow{font-size:20px;color:#929bff}
.empty{padding:25px;border:1px solid #303344;border-radius:15px;background:#1b1d28;color:#c4c7d5;line-height:1.9}
@media(max-width:500px){body{padding:15px}h1{font-size:24px}.guild{padding:13px}}
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
    <div class="subtitle">اختر سيرفرًا لإدارة إعدادات البوت وصلاحيات الأوامر.</div>
    <div class="guilds">
        ${guildCards || '<div class="empty">لم يتم العثور على سيرفرات يمكنك إدارتها والبوت موجود فيها. تأكد من صلاحيات حسابك وأن البوت موجود في السيرفر.</div>'}
    </div>
</main>
</body>
</html>`);
    } catch (error) {
        console.error('Dashboard error:', error.response?.data || error.message);

        if (error.message === 'Discord session expired' || error.message === 'Discord login required') {
            if (req.session) {
                req.session.user = null;
                req.session.accessToken = null;
                req.session.refreshToken = null;
            }
            return res.redirect('/?error=login');
        }

        return res.status(500).send('حدث خطأ أثناء تحميل السيرفرات. تأكد من إعدادات Discord OAuth وتوكن البوت.');
    }
});

app.get('/api/roles/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!BOT_TOKEN) {
            return res.status(500).json({ error: 'إعدادات توكن البوت غير مكتملة (تأكد من وجود TOKEN في المتغيرات).' });
        }

        if (!(await isAuthorizedGuild(req, guildId))) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر أو البوت غير موجود فيه.' });
        }

        const response = await axios.get(`${API}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            timeout: 15000
        });

        const roles = response.data
            .filter(role => role.id !== guildId && !role.managed)
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.color
            }));

        res.set('Cache-Control', 'no-store');
        return res.json(roles);
    } catch (error) {
        console.error('Roles API error:', error.response?.data || error.message);

        if ([400, 401].includes(error.response?.status)) {
            return res.status(401).json({ error: 'انتهت جلسة Discord. سجّل الدخول مجدداً.' });
        }

        return res.status(500).json({ error: 'تعذّر تحميل الرتب من Discord.' });
    }
});

app.get('/api/settings/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!(await isAuthorizedGuild(req, guildId))) {
            return res.status(403).json({ error: 'غير مسموح لك بالوصول إلى إعدادات هذا السيرفر.' });
        }

        let settings = await GuildSettings.findOne({ guildId });

        if (!settings) {
            settings = await GuildSettings.create({ guildId });
        }

        res.set('Cache-Control', 'no-store');
        return res.json(plainSettings(settings));
    } catch (error) {
        console.error('Get settings error:', error.response?.data || error.message);
        return res.status(500).json({ error: 'تعذّر تحميل الإعدادات.' });
    }
});

app.post('/api/settings/:guildId', requireLogin, async (req, res) => {
    try {
        const { guildId } = req.params;

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!(await isAuthorizedGuild(req, guildId))) {
            return res.status(403).json({ error: 'غير مسموح لك بتعديل إعدادات هذا السيرفر.' });
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'بيانات الإعدادات غير صحيحة.' });
        }

        const body = req.body;
        const updates = {};

        for (const key of Object.keys(body)) {
            if (!ALLOWED_FIELDS.includes(key)) continue;

            const value = body[key];

            if (key === 'prefix') {
                if (typeof value !== 'string' || value.length > 5) {
                    return res.status(400).json({ error: 'البادئة يجب أن تكون أقصاها 5 أحرف.' });
                }

                updates.prefix = value.trim();
            } else if (['staffRoleId', 'ticketCategoryId', 'logChannelId'].includes(key)) {
                if (typeof value !== 'string' || (value !== '' && !validSnowflake(value))) {
                    return res.status(400).json({ error: `قيمة ${key} غير صحيحة.` });
                }

                updates[key] = value;
            } else if ([
                'botName',
                'botStatus',
                'activityText',
                'panelTitle',
                'panelDescription',
                'panelImage',
                'ticketImage',
                'botAvatar'
            ].includes(key)) {
                if (typeof value !== 'string' || value.length > 2000) {
                    return res.status(400).json({ error: `قيمة ${key} غير صحيحة أو طويلة جداً.` });
                }

                if (['panelImage', 'ticketImage', 'botAvatar'].includes(key) && !validUrl(value)) {
                    return res.status(400).json({ error: `الرابط الموجود في ${key} غير صحيح.` });
                }

                if (key === 'botStatus' && !['online', 'idle', 'dnd', 'invisible'].includes(value)) {
                    return res.status(400).json({ error: 'حالة البوت غير صحيحة.' });
                }

                if (key === 'botName' && value.length > 100) {
                    return res.status(400).json({ error: 'اسم البوت طويل جداً.' });
                }

                if (key === 'activityText' && value.length > 128) {
                    return res.status(400).json({ error: 'نص النشاط يجب ألا يتجاوز 128 حرفاً.' });
                }

                updates[key] = value;
            } else if (key === 'activityType') {
                const number = Number(value);

                if (![0, 2, 3, 5].includes(number)) {
                    return res.status(400).json({ error: 'نوع نشاط البوت غير صحيح.' });
                }

                updates.activityType = number;
            } else if ([
                'claimPoints',
                'warnPoints',
                'timeoutPoints',
                'renameCooldown'
            ].includes(key)) {
                const number = Number(value);
                const max = key === 'renameCooldown' ? 1440 : 1000;

                if (!Number.isInteger(number) || number < 0 || number > max) {
                    return res.status(400).json({ error: `قيمة ${key} يجب أن تكون رقماً صحيحاً بين 0 و${max}.` });
                }

                updates[key] = number;
            } else if (key === 'selectOptions') {
                if (!Array.isArray(value) || value.length !== 4) {
                    return res.status(400).json({ error: 'يجب تحديد 4 خيارات للتذاكر.' });
                }

                const allowedValues = ['inquiry', 'complaint', 'gifts', 'other'];
                const cleanOptions = [];

                for (let i = 0; i < value.length; i++) {
                    const option = value[i];

                    if (!option || typeof option !== 'object' || Array.isArray(option)) {
                        return res.status(400).json({ error: 'أحد خيارات التذاكر غير صحيح.' });
                    }

                    const optionValue = allowedValues[i];
                    const label = typeof option.label === 'string' ? option.label.trim() : '';
                    const description = typeof option.description === 'string' ? option.description.trim() : '';
                    const emoji = typeof option.emoji === 'string' ? option.emoji.trim() : '';

                    if (!label || label.length > 100 || description.length > 100 || emoji.length > 100) {
                        return res.status(400).json({ error: 'راجع أسماء وأوصاف خيارات التذاكر.' });
                    }

                    cleanOptions.push({
                        label,
                        value: optionValue,
                        description,
                        emoji
                    });
                }

                updates.selectOptions = cleanOptions;
            } else if (key === 'commandPermissions' || key === 'commandAliases') {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    return res.status(400).json({ error: `بيانات ${key} غير صحيحة.` });
                }

                const clean = {};

                for (const command of COMMANDS) {
                    if (!(command in value)) continue;

                    if (key === 'commandPermissions') {
                        if (!Array.isArray(value[command]) || value[command].length > 100) {
                            return res.status(400).json({ error: 'قائمة صلاحيات أحد الأوامر غير صحيحة.' });
                        }

                        const ids = value[command];

                        if (ids.some(id => typeof id !== 'string' || !validSnowflake(id))) {
                            return res.status(400).json({ error: 'يوجد معرّف رتبة غير صحيح.' });
                        }

                        clean[command] = [...new Set(ids)];
                    } else {
                        const rawAliases = value[command];
                        if (Array.isArray(rawAliases)) {
                            clean[command] = rawAliases.map(item => ({
                                alias: String(item.alias || '').trim(),
                                active: Boolean(item.active)
                            })).filter(item => item.alias.length > 0);
                        } else if (typeof rawAliases === 'string' && rawAliases.trim().length > 0) {
                            clean[command] = [{ alias: rawAliases.trim(), active: true }];
                        } else {
                            clean[command] = [];
                        }
                    }
                }

                updates[key] = clean;
            }
        }

        let settings = await GuildSettings.findOne({ guildId });

        if (!settings) {
            settings = new GuildSettings({ guildId });
        }

        for (const [key, value] of Object.entries(updates)) {
            if (key === 'commandPermissions' || key === 'commandAliases') {
                const targetMap = settings[key];

                for (const [command, item] of Object.entries(value)) {
                    targetMap.set(command, item);
                }
            } else {
                settings.set(key, value);
            }
        }

        await settings.save();

        res.set('Cache-Control', 'no-store');

        return res.json({
            success: true,
            settings: plainSettings(settings)
        });
    } catch (error) {
        console.error('Save settings error:', error.response?.data || error.message);
        return res.status(500).json({ error: 'حدث خطأ أثناء حفظ الإعدادات.' });
    }
});

app.get('/dashboard/:guildId', requireLogin, async (req, res) => {
    try {
        const guildId = req.params.guildId;

        if (!validSnowflake(guildId)) {
            return res.status(400).send('معرّف السيرفر غير صحيح.');
        }

        if (!(await isAuthorizedGuild(req, guildId))) {
            return res.status(403).send('ليس لديك صلاحية إدارة هذا السيرفر أو البوت غير موجود فيه.');
        }

        let guildName = 'إعدادات السيرفر';

        try {
            const guildResponse = await axios.get(`${API}/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${BOT_TOKEN}` },
                timeout: 10000
            });

            guildName = guildResponse.data.name || guildName;
        } catch (error) {
            console.error('Guild name error:', error.response?.status || error.message);
        }

        res.set('Cache-Control', 'no-store');

        return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إعدادات السيرفر - ${escapeHtml(BOT_NAME)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#101116;color:#f5f5fa;font-family:Arial,sans-serif}
header{padding:18px 22px;background:#191b26;border-bottom:1px solid #303344;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.brand{font-weight:bold;font-size:19px}
header a{color:#cdd0df;text-decoration:none;background:#292c3a;padding:10px 13px;border-radius:9px;font-size:13px}
main{max-width:1100px;margin:25px auto;padding:0 16px 40px}
h1{font-size:27px;margin:0 0 8px}
.sub{color:#a6aabd;margin-bottom:22px;line-height:1.7}
.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:18px;align-items:start}
nav{background:#1b1d28;border:1px solid #303344;border-radius:14px;padding:8px;position:sticky;top:15px}
nav button{width:100%;text-align:right;border:0;background:transparent;color:#bfc3d4;padding:13px 12px;border-radius:9px;cursor:pointer;font-size:14px}
nav button.active,nav button:hover{background:#30344a;color:#fff}
section.panel{display:none;background:#1b1d28;border:1px solid #303344;border-radius:15px;padding:20px}
section.panel.active{display:block}
h2{font-size:20px;margin:0 0 18px}
h3{font-size:15px;margin:22px 0 12px;color:#dfe1ed}
.field{margin-bottom:15px}
label{display:block;font-size:13px;color:#cdd0df;margin-bottom:7px}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid #3a3e52;border-radius:9px;background:#12141c;color:#fff;font:inherit;outline:none}
input:focus,textarea:focus,select:focus{border-color:#737eff}
textarea{min-height:90px;resize:vertical}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.help{font-size:12px;color:#999fb4;margin-top:6px;line-height:1.6}
.savebar{display:flex;align-items:center;gap:12px;margin-top:20px;flex-wrap:wrap}
.save{border:0;background:#5865f2;color:white;padding:12px 20px;border-radius:10px;font-weight:bold;cursor:pointer}
.save:hover{background:#4752c4}
.save:disabled{opacity:.6;cursor:wait}
#status{font-size:13px;color:#bfc3d4;line-height:1.7}
.command{border:1px solid #35394b;padding:13px;border-radius:11px;margin-bottom:12px}
.command strong{display:block;margin-bottom:10px;font-size:14px}
.role-list{display:flex;flex-wrap:wrap;gap:8px}
.role-choice{display:flex;align-items:center;gap:7px;background:#12141c;border:1px solid #3a3e52;padding:8px 10px;border-radius:8px;font-size:12px;max-width:100%}
.role-choice input{width:auto;margin:0}
.role-choice span{overflow-wrap:anywhere}
.option{padding:14px;border:1px solid #35394b;border-radius:11px;margin-bottom:12px}
.empty{color:#a6aabd;font-size:13px;line-height:1.8}

.alias-card{background:#12141c;border:1px solid #3a3e52;padding:15px;border-radius:10px;margin-bottom:12px}
.alias-item{display:flex;align-items:center;gap:10px;margin-top:8px}
.btn-sm{padding:6px 12px;border-radius:6px;border:0;cursor:pointer;font-size:12px;font-weight:bold}
.btn-add{background:#57f287;color:#000}
.btn-danger{background:#ed4245;color:#fff}
.btn-toggle{background:#fee75c;color:#000}
@media(max-width:750px){.layout{grid-template-columns:1fr}nav{position:static;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}section.panel{padding:15px}header{padding:14px}}
</style>
</head>
<body>
<header>
    <div class="brand">${escapeHtml(BOT_NAME)} | لوحة التحكم</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/dashboard">السيرفرات</a>
        <a href="/logout">تسجيل الخروج</a>
    </div>
</header>
<main>
    <h1>${escapeHtml(guildName)}</h1>
    <div class="sub">عدّل إعدادات البوت ثم اضغط «حفظ الإعدادات» لتطبيق التغييرات.</div>

    <div class="layout">
        <nav id="tabs">
            <button class="active" data-tab="general">إعدادات البوت</button>
            <button data-tab="channels">القنوات والرتب</button>
            <button data-tab="panel">لوحة التذاكر</button>
            <button data-tab="options">خيارات التذاكر</button>
            <button data-tab="aliases">البادئة والاختصارات</button>
            <button data-tab="permissions">صلاحيات الأوامر</button>
            <button data-tab="points">النقاط والمهلة</button>
        </nav>

        <div>
            <section class="panel active" id="general">
                <h2>إعدادات البوت</h2>
                <div class="field"><label for="botName">اسم البوت</label><input id="botName" maxlength="100" placeholder="اسم البوت"></div>
                <div class="field"><label for="botAvatar">رابط صورة البوت</label><input id="botAvatar" type="url" placeholder="https://..."></div>

                <div class="grid">
                    <div class="field">
                        <label for="botStatus">حالة البوت</label>
                        <select id="botStatus">
                            <option value="online">متصل</option>
                            <option value="idle">خامل</option>
                            <option value="dnd">عدم الإزعاج</option>
                            <option value="invisible">مخفي</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="activityType">نوع النشاط</label>
                        <select id="activityType">
                            <option value="0">يلعب</option>
                            <option value="2">يستمع إلى</option>
                            <option value="3">يشاهد</option>
                            <option value="5">يتنافس في</option>
                        </select>
                    </div>
                </div>

                <div class="field"><label for="activityText">نص النشاط</label><input id="activityText" maxlength="128" placeholder="مثال: الدعم الفني"></div>
                <p class="help">يتم حفظ الإعدادات في قاعدة البيانات. يجب أن يقرأها كود البوت ويطبّقها حتى يتغير نشاطه فعلياً.</p>
            </section>

            <section class="panel" id="channels">
                <h2>القنوات والرتب</h2>
                <div class="field"><label for="staffRoleId">معرّف رتبة الإدارة</label><input id="staffRoleId" placeholder="Role ID"></div>
                <div class="field"><label for="ticketCategoryId">معرّف كاتيجوري التذاكر</label><input id="ticketCategoryId" placeholder="Category ID"></div>
                <div class="field"><label for="logChannelId">معرّف قناة اللوق</label><input id="logChannelId" placeholder="Channel ID"></div>
                <p class="help">فعّل وضع المطوّر في Discord ثم اختر نسخ المعرّف من الرتبة أو القناة.</p>
            </section>

            <section class="panel" id="panel">
                <h2>لوحة التذاكر</h2>
                <div class="field"><label for="panelTitle">عنوان اللوحة</label><input id="panelTitle" maxlength="200" placeholder="الدعم الفني"></div>
                <div class="field"><label for="panelDescription">وصف اللوحة</label><textarea id="panelDescription" maxlength="2000" placeholder="اكتب وصف لوحة الدعم الفني"></textarea></div>
                <div class="field"><label for="panelImage">رابط صورة اللوحة</label><input id="panelImage" type="url" placeholder="https://..."></div>
                <div class="field"><label for="ticketImage">رابط صورة التذكرة</label><input id="ticketImage" type="url" placeholder="https://..."></div>
                <p class="help">يجب أن تكون الروابط فارغة أو تبدأ بـ https:// أو http://.</p>
            </section>

            <section class="panel" id="options">
                <h2>خيارات التذاكر</h2>
                <div class="option">
                    <h3>الخيار الأول: استفسار</h3>
                    <div class="field"><label for="option0label">الاسم الظاهر</label><input id="option0label" maxlength="100"></div>
                    <div class="field"><label for="option0emoji">الإيموجي</label><input id="option0emoji" maxlength="100"></div>
                    <div class="field"><label for="option0description">الوصف</label><input id="option0description" maxlength="100" placeholder="استفسار عام"></div>
                </div>
                <div class="option">
                    <h3>الخيار الثاني: شكوى</h3>
                    <div class="field"><label for="option1label">الاسم الظاهر</label><input id="option1label" maxlength="100"></div>
                    <div class="field"><label for="option1emoji">الإيموجي</label><input id="option1emoji" maxlength="100"></div>
                    <div class="field"><label for="option1description">الوصف</label><input id="option1description" maxlength="100" placeholder="تقديم شكوى"></div>
                </div>
                <div class="option">
                    <h3>الخيار الثالث: استلام هدايا</h3>
                    <div class="field"><label for="option2label">الاسم الظاهر</label><input id="option2label" maxlength="100"></div>
                    <div class="field"><label for="option2emoji">الإيموجي</label><input id="option2emoji" maxlength="100"></div>
                    <div class="field"><label for="option2description">الوصف</label><input id="option2description" maxlength="100" placeholder="استلام هدايا"></div>
                </div>
                <div class="option">
                    <h3>الخيار الرابع: شيء اخر ..</h3>
                    <div class="field"><label for="option3label">الاسم الظاهر</label><input id="option3label" maxlength="100"></div>
                    <div class="field"><label for="option3emoji">الإيموجي</label><input id="option3emoji" maxlength="100"></div>
                    <div class="field"><label for="option3description">الوصف</label><input id="option3description" maxlength="100" placeholder="شيء اخر"></div>
                </div>
            </section>

            <section class="panel" id="aliases">
                <h2>البادئة والاختصارات</h2>
                <div class="field">
                    <label for="prefix">بادئة الأوامر (Prefix)</label>
                    <input id="prefix" maxlength="5" placeholder="مثال: - أو اتركها فارغة ليعمل بدون Prefix">
                </div>
                <p class="help">يمكنك إضافة أكثر من اختصار لكل أمر وتفعيلها أو إيقافها، وعند ترك البادئة فارغة ستعمل الأوامر مباشرة.</p>
                <div id="aliasContainer"></div>
            </section>

            <section class="panel" id="permissions">
                <h2>صلاحيات الأوامر</h2>
                <p class="help">إذا لم تختر أي رتبة لأمر، فسيكون متاحاً للجميع حسب منطق البوت. عند اختيار رتب، يُسمح لحاملي واحدة منها باستخدام الأمر.</p>
                <div id="permissionFields"><div class="empty">جارٍ تحميل الرتب...</div></div>
            </section>

            <section class="panel" id="points">
                <h2>النقاط والمهلة</h2>
                <div class="grid">
                    <div class="field"><label for="claimPoints">نقاط الاستلام</label><input id="claimPoints" type="number" min="0" max="1000"></div>
                    <div class="field"><label for="warnPoints">نقاط التحذير</label><input id="warnPoints" type="number" min="0" max="1000"></div>
                    <div class="field"><label for="timeoutPoints">نقاط التايم</label><input id="timeoutPoints" type="number" min="0" max="1000"></div>
                    <div class="field"><label for="renameCooldown">مهلة إعادة تسمية التذكرة بالدقائق</label><input id="renameCooldown" type="number" min="0" max="1440"></div>
                </div>
                <p class="help">تأثير النقاط والمهلة يعتمد على أن كود البوت يقرأ هذه الإعدادات من قاعدة البيانات.</p>
            </section>

            <div class="savebar">
                <button class="save" id="saveButton">حفظ الإعدادات</button>
                <span id="status" role="status"></span>
            </div>
        </div>
    </div>
</main>

<script>
(function () {
    const guildId = ${JSON.stringify(guildId)};
    const commandNames = ${JSON.stringify(COMMAND_NAMES)};

    let currentSettings = {};
    let roles = [];
    let aliasesData = {};

    document.querySelectorAll('#tabs button').forEach(function (button) {
        button.addEventListener('click', function () {
            document.querySelectorAll('#tabs button').forEach(function (item) {
                item.classList.remove('active');
            });

            document.querySelectorAll('section.panel').forEach(function (panel) {
                panel.classList.remove('active');
            });

            button.classList.add('active');
            document.getElementById(button.dataset.tab).classList.add('active');
        });
    });

    function setValue(id, value) {
        const element = document.getElementById(id);

        if (element && value !== undefined && value !== null) {
            element.value = value;
        }
    }

    function getValue(id) {
        const element = document.getElementById(id);
        return element ? element.value : '';
    }

    function renderAliases() {
        const container = document.getElementById('aliasContainer');
        container.innerHTML = '';

        Object.keys(commandNames).forEach(function (cmd) {
            const card = document.createElement('div');
            card.className = 'alias-card';
            
            let list = Array.isArray(aliasesData[cmd]) ? aliasesData[cmd] : [];
            
            card.innerHTML = '<strong>' + commandNames[cmd] + '</strong>';
            
            const listDiv = document.createElement('div');
            list.forEach(function (item, index) {
                const row = document.createElement('div');
                row.className = 'alias-item';
                row.innerHTML = \`
                    <input type="text" value="\${item.alias}" placeholder="اكتب الاختصار" onchange="updateAlias('\${cmd}', \${index}, this.value)">
                    <button type="button" class="btn-sm btn-toggle" onclick="toggleAlias('\${cmd}', \${index})">\${item.active ? 'مفعل' : 'معطل'}</button>
                    <button type="button" class="btn-sm btn-danger" onclick="deleteAlias('\${cmd}', \${index})">حذف</button>
                \`;
                listDiv.appendChild(row);
            });

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'btn-sm btn-add';
            addBtn.style.marginTop = '10px';
            addBtn.textContent = '+ إضافة اختصار جديد';
            addBtn.onclick = function() { addAlias(cmd); };

            card.appendChild(listDiv);
            card.appendChild(addBtn);
            container.appendChild(card);
        });
    }

    window.updateAlias = function(cmd, idx, val) {
        if (aliasesData[cmd] && aliasesData[cmd][idx]) {
            aliasesData[cmd][idx].alias = val.trim();
        }
    };

    window.toggleAlias = function(cmd, idx) {
        if (aliasesData[cmd] && aliasesData[cmd][idx]) {
            aliasesData[cmd][idx].active = !aliasesData[cmd][idx].active;
            renderAliases();
        }
    };

    window.deleteAlias = function(cmd, idx) {
        if (aliasesData[cmd]) {
            aliasesData[cmd].splice(idx, 1);
            renderAliases();
        }
    };

    window.addAlias = function(cmd) {
        if (!aliasesData[cmd] || !Array.isArray(aliasesData[cmd])) {
            aliasesData[cmd] = [];
        }
        aliasesData[cmd].push({ alias: '', active: true });
        renderAliases();
    };

    function makePermissionFields(settings) {
        const container = document.getElementById('permissionFields');
        container.innerHTML = '';

        if (!roles.length) {
            container.innerHTML = '<div class="empty">لم يتم العثور على رتب قابلة للاختيار.</div>';
            return;
        }

        Object.keys(commandNames).forEach(function (command) {
            const wrapper = document.createElement('div');
            wrapper.className = 'command';

            const title = document.createElement('strong');
            title.textContent = commandNames[command];
            wrapper.appendChild(title);

            const list = document.createElement('div');
            list.className = 'role-list';

            const selected = settings.commandPermissions && Array.isArray(settings.commandPermissions[command])
                ? settings.commandPermissions[command]
                : [];

            roles.forEach(function (role) {
                const label = document.createElement('label');
                label.className = 'role-choice';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.dataset.command = command;
                checkbox.value = role.id;
                checkbox.checked = selected.includes(role.id);

                const name = document.createElement('span');
                name.textContent = role.name;

                label.appendChild(checkbox);
                label.appendChild(name);
                list.appendChild(label);
            });

            wrapper.appendChild(list);
            container.appendChild(wrapper);
        });
    }

    function fillForm(settings) {
        const textFields = [
            'botName', 'botAvatar', 'botStatus', 'activityType', 'activityText',
            'staffRoleId', 'ticketCategoryId', 'logChannelId', 'panelTitle',
            'panelDescription', 'panelImage', 'ticketImage', 'prefix',
            'claimPoints', 'warnPoints', 'timeoutPoints', 'renameCooldown'
        ];

        textFields.forEach(function (key) {
            setValue(key, settings[key]);
        });

        const options = Array.isArray(settings.selectOptions) ? settings.selectOptions : [];
        const defaultLabels = ['استفسار', 'شكوى', 'استلام هدايا', 'شيء اخر ..'];
        const defaultEmojis = ['1493382115318960169', '1545031336274960384', '1545029143777902702', '1450547743025008650'];

        for (let i = 0; i < 4; i++) {
            const option = options[i] || {};

            setValue('option' + i + 'label', option.label || defaultLabels[i]);
            setValue('option' + i + 'emoji', option.emoji || defaultEmojis[i]);
            setValue('option' + i + 'description', option.description || '');
        }

        aliasesData = settings.commandAliases || {};
        Object.keys(commandNames).forEach(function(cmd) {
            if (!aliasesData[cmd]) {
                aliasesData[cmd] = [];
            } else if (typeof aliasesData[cmd] === 'string') {
                aliasesData[cmd] = [{ alias: aliasesData[cmd], active: true }];
            }
        });

        renderAliases();
        makePermissionFields(settings);
    }

    async function loadData() {
        const status = document.getElementById('status');
        status.textContent = 'جارٍ تحميل الإعدادات...';

        try {
            const settingsRes = await fetch('/api/settings/' + encodeURIComponent(guildId), { credentials: 'same-origin' });
            const settingsData = await settingsRes.json().catch(() => ({}));

            if (!settingsRes.ok) {
                throw new Error(settingsData.error || 'تعذّر تحميل إعدادات السيرفر.');
            }

            currentSettings = settingsData;

            try {
                const rolesRes = await fetch('/api/roles/' + encodeURIComponent(guildId), { credentials: 'same-origin' });
                const rolesData = await rolesRes.json().catch(() => ([]));

                if (rolesRes.ok && Array.isArray(rolesData)) {
                    roles = rolesData;
                } else {
                    roles = [];
                    status.textContent = 'تنبيه: ' + (rolesData.error || 'تعذّر تحميل الرتب.');
                }
            } catch (roleErr) {
                roles = [];
                status.textContent = 'تنبيه: تعذّر الاتصال بجلب الرتب.';
            }

            fillForm(currentSettings);
            if (!status.textContent.startsWith('تنبيه:')) {
                status.textContent = '';
            }
        } catch (error) {
            status.textContent = error.message || 'حدث خطأ أثناء التحميل.';
        }
    }

    function collectPermissions() {
        const permissions = {};

        Object.keys(commandNames).forEach(function (command) {
            permissions[command] = [];
        });

        document.querySelectorAll('#permissionFields input[type="checkbox"]:checked').forEach(function (checkbox) {
            permissions[checkbox.dataset.command].push(checkbox.value);
        });

        return permissions;
    }

    function collectOptions() {
        return [
            {
                label: getValue('option0label').trim(),
                value: 'inquiry',
                emoji: getValue('option0emoji').trim(),
                description: getValue('option0description').trim()
            },
            {
                label: getValue('option1label').trim(),
                value: 'complaint',
                emoji: getValue('option1emoji').trim(),
                description: getValue('option1description').trim()
            },
            {
                label: getValue('option2label').trim(),
                value: 'gifts',
                emoji: getValue('option2emoji').trim(),
                description: getValue('option2description').trim()
            },
            {
                label: getValue('option3label').trim(),
                value: 'other',
                emoji: getValue('option3emoji').trim(),
                description: getValue('option3description').trim()
            }
        ];
    }

    document.getElementById('saveButton').addEventListener('click', async function () {
        const button = this;
        const status = document.getElementById('status');

        button.disabled = true;
        status.textContent = 'جارٍ حفظ الإعدادات...';

        const payload = {
            botName: getValue('botName').trim(),
            botAvatar: getValue('botAvatar').trim(),
            botStatus: getValue('botStatus'),
            activityType: Number(getValue('activityType')),
            activityText: getValue('activityText').trim(),
            staffRoleId: getValue('staffRoleId').trim(),
            ticketCategoryId: getValue('ticketCategoryId').trim(),
            logChannelId: getValue('logChannelId').trim(),
            panelTitle: getValue('panelTitle').trim(),
            panelDescription: getValue('panelDescription').trim(),
            panelImage: getValue('panelImage').trim(),
            ticketImage: getValue('ticketImage').trim(),
            selectOptions: collectOptions(),
            prefix: getValue('prefix'),
            commandAliases: aliasesData,
            commandPermissions: collectPermissions(),
            claimPoints: Number(getValue('claimPoints')),
            warnPoints: Number(getValue('warnPoints')),
            timeoutPoints: Number(getValue('timeoutPoints')),
            renameCooldown: Number(getValue('renameCooldown'))
        };

        try {
            const response = await fetch('/api/settings/' + encodeURIComponent(guildId), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json().catch(function () {
                return {};
            });

            if (!response.ok) {
                throw new Error(result.error || 'فشل حفظ الإعدادات.');
            }

            currentSettings = result.settings || currentSettings;
            status.textContent = 'تم حفظ الإعدادات بنجاح.';
        } catch (error) {
            status.textContent = error.message || 'حدث خطأ أثناء الحفظ.';
        } finally {
            button.disabled = false;
        }
    });

    loadData();
})();
</script>
</body>
</html>`);
    } catch (error) {
        console.error('Guild settings page error:', error.response?.data || error.message);

        if (error.message === 'Discord session expired' || error.message === 'Discord login required') {
            if (req.session) {
                req.session.user = null;
                req.session.accessToken = null;
                req.session.refreshToken = null;
            }
            return res.redirect('/?error=login');
        }

        return res.status(500).send('حدث خطأ أثناء فتح إعدادات السيرفر.');
    }
});

app.use((req, res) => {
    res.status(404).send('الصفحة غير موجودة.');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Dashboard running on port ${PORT}`);
    });
}

module.exports = app;
