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
        const refreshToken = tokenResponse.data.refreshToken;
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
    return res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة التحكم</title></head><body style="background:#0f1015;color:#fff;font-family:Arial;text-align:center;padding:50px;"><h1>${escapeHtml(BOT_NAME)}</h1><a href="/login" style="background:#5865f2;color:#fff;padding:12px 20px;text-decoration:none;border-radius:10px;font-weight:bold;">تسجيل الدخول عبر Discord</a></body></html>`);
});

app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const guilds = await getFreshUserGuilds(req, true);
        const guildCards = guilds.map(g => `<a href="/dashboard/${g.id}" style="display:flex;align-items:center;gap:15px;background:#181a24;color:#fff;padding:15px;margin:10px 0;border-radius:12px;text-decoration:none;border:1px solid #282b3a;"><strong>${escapeHtml(g.name)}</strong></a>`).join('');
        return res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>السيرفرات</title></head><body style="background:#0f1015;color:#fff;font-family:Arial;padding:30px;"><h1 style="text-align:center;">اختر سيرفر</h1><div style="max-width:500px;margin:auto;">${guildCards}</div></body></html>`);
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
                updates.prefix = String(value !== undefined ? value : '').trim();
            } else if (key === 'renameCooldown') {
                updates.renameCooldown = Number(value) || 0;
            } else if (key === 'commandAliases') {
                if (typeof value === 'object' && value !== null) {
                    const cleanAliases = {};
                    for (const [cmd, aliases] of Object.entries(value)) {
                        if (Array.isArray(aliases)) {
                            cleanAliases[cmd] = aliases.map(a => ({
                                alias: String(a.alias || '').trim(),
                                active: Boolean(a.active)
                            })).filter(a => a.alias);
                        }
                    }
                    updates.commandAliases = cleanAliases;
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
        return res.status(500).json({ error: 'خطأ أثناء الحفظ' });
    }
});

app.get('/dashboard/:guildId', requireLogin, async (req, res) => {
    try {
        const guildId = req.params.guildId;
        let guildName = 'إعدادات السيرفر';
        try {
            const r = await axios.get(`${API}/guilds/${guildId}`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
            guildName = r.data.name;
        } catch {}

        return res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إعدادات السيرفر - ${escapeHtml(guildName)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0f1015;color:#f5f5fa;font-family:Arial,sans-serif}
header{padding:18px 25px;background:#141620;border-bottom:1px solid #232635;display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:bold;font-size:20px;color:#5865f2}
header a{color:#cdd0df;text-decoration:none;background:#1e2130;padding:10px 15px;border-radius:10px;font-size:13px;transition:.2s}
header a:hover{background:#2a2e43}
main{max-width:1150px;margin:30px auto;padding:0 20px 50px}
h1{font-size:28px;margin:0 0 8px}
.sub{color:#9ca3af;margin-bottom:25px}
.layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px;align-items:start}
nav{background:#141620;border:1px solid #232635;border-radius:16px;padding:10px}
nav button{width:100%;text-align:right;border:0;background:transparent;color:#9ca3af;padding:14px 15px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:bold;transition:.2s;margin-bottom:4px}
nav button.active,nav button:hover{background:#5865f2;color:#fff}
section.panel{display:none;background:#141620;border:1px solid #232635;border-radius:16px;padding:25px}
section.panel.active{display:block}
h2{font-size:22px;margin:0 0 20px;color:#fff;border-bottom:1px solid #232635;padding-bottom:10px}
.field{margin-bottom:18px}
label{display:block;font-size:13px;color:#cbd5e1;margin-bottom:8px}
input,textarea,select{width:100%;padding:12px 14px;border:1px solid #2a2e43;border-radius:10px;background:#0a0b0e;color:#fff;font:inherit;outline:none;transition:.2s}
input:focus,textarea:focus,select:focus{border-color:#5865f2}
.help{font-size:12px;color:#64748b;margin-top:6px}
.savebar{display:flex;align-items:center;gap:15px;margin-top:25px}
.save{border:0;background:#5865f2;color:white;padding:14px 25px;border-radius:12px;font-weight:bold;cursor:pointer;transition:.2s}
.save:hover{background:#4752c4}
.alias-card{background:#0a0b0e;border:1px solid #232635;padding:18px;border-radius:12px;margin-bottom:15px}
.btn-sm{padding:8px 14px;border-radius:8px;border:0;cursor:pointer;font-size:12px;font-weight:bold}
.btn-add{background:#22c55e;color:#fff}
.btn-danger{background:#ef4444;color:#fff}
#status{color:#22c55e;font-weight:bold}
</style>
</head>
<body>
<header>
    <div class="brand">⚡ ${escapeHtml(BOT_NAME)}</div>
    <div><a href="/dashboard">السيرفرات</a> <a href="/logout">تسجيل الخروج</a></div>
</header>
<main>
    <h1>${escapeHtml(guildName)}</h1>
    <div class="sub">لوحة التحكم المركزية لإدارة البوت بدقة واحترافية.</div>
    <div class="layout">
        <nav id="tabs">
            <button class="active" data-tab="general">إعدادات البوت</button>
            <button data-tab="channels">القنوات والرتب</button>
            <button data-tab="aliases">اختصارات الأوامر</button>
            <button data-tab="rolepoints">نقاط الرتب بالأمر</button>
            <button data-tab="autoreplies">الرد التلقائي</button>
        </nav>
        <div>
            <section class="panel active" id="general">
                <h2>إعدادات البوت والمهلة</h2>
                <div class="field"><label>البريفيكس (إذا تركته فارغاً، تعمل الأوامر مباشرة بدون رمز)</label><input id="prefix"></div>
                <div class="field"><label>اسم البوت</label><input id="botName"></div>
                <div class="field"><label>رابط صورة البوت</label><input id="botAvatar"></div>
                <div class="field"><label>نص النشاط</label><input id="activityText"></div>
                <div class="field"><label>مهلة إعادة تسمية التذكرة (بالدقائق)</label><input id="renameCooldown" type="number"></div>
            </section>
            <section class="panel" id="channels">
                <h2>القنوات والرتب الأساسية</h2>
                <div class="field"><label>رتبة الإدارة العامة</label><input id="staffRoleId"></div>
                <div class="field"><label>كاتيجوري التذاكر</label><input id="ticketCategoryId"></div>
                <div class="field"><label>قناة اللوق (السجلات)</label><input id="logChannelId"></div>
            </section>
            <section class="panel" id="aliases">
                <h2>اختصارات الأوامر</h2>
                <div id="aliasesContainer"></div>
            </section>
            <section class="panel" id="rolepoints">
                <h2>نقاط الرتب بالأمر</h2>
                <p class="help">حدد النقاط لكل أمر ورتبة. (إذا امتلك العضو رتبتين، سيتم تطبيق الرتبة ذات النقاط الأعلى تلقائياً).</p>
                <div id="rolePointsContainer"></div>
                <button type="button" class="btn-sm btn-add" onclick="addRolePointConfig()">+ اضافة رتبه</button>
            </section>
            <section class="panel" id="autoreplies">
                <h2>الرد التلقائي</h2>
                <div id="autoReplyContainer"></div>
                <button type="button" class="btn-sm btn-add" onclick="addAutoReply()">+ ضيف رد جديد</button>
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
    let roles = [], commandAliasesData = {}, rolePointsData = [], autoRepliesData = [];
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

    function renderAliases() {
        const c = document.getElementById('aliasesContainer');
        c.innerHTML = '';
        for (const [cmd, list] of Object.entries(commandAliasesData)) {
            const d = document.createElement('div');
            d.className = 'alias-card';
            let aliasesHtml = '';
            if (Array.isArray(list)) {
                list.forEach((item, idx) => {
                    aliasesHtml += \`<div style="display:flex;gap:10px;margin-bottom:10px;align-items:center">
                        <input value="\${escapeHtml(item.alias)}" oninput="commandAliasesData['\${cmd}'][$\{{idx}}].alias=this.value" style="flex:1">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" \${item.active ? 'checked' : ''} onchange="commandAliasesData['\${cmd}'][$\{{idx}}].active=this.checked"> تفعيل</label>
                    </div>\`;
                });
            }
            d.innerHTML = \`<strong>الأمر الأساسي: \${cmd}</strong><div style="margin-top:10px">\${aliasesHtml}</div>\`;
            c.appendChild(d);
        }
    }

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
                <div class="field"><label>عدد النقاط</label><input type="number" value="\${item.points ?? 1}" oninput="rolePointsData[\${idx}].points=Number(this.value)"></div>
                <button type="button" class="btn-sm btn-danger" onclick="rolePointsData.splice(\${idx},1);renderRolePoints()">حذف</button>\`;
            c.appendChild(d);
        });
    }
    window.addRolePointConfig = () => { rolePointsData.push({ roleId: '', command: 'claim', points: 1 }); renderRolePoints(); };

    function renderAutoReplies() {
        const c = document.getElementById('autoReplyContainer');
        c.innerHTML = '';
        autoRepliesData.forEach((item, idx) => {
            let opts = '<option value="all" ' + (item.roleId === 'all' ? 'selected' : '') + '>الجميع</option>';
            roles.forEach(r => { opts += '<option value="' + r.id + '" ' + (item.roleId === r.id ? 'selected' : '') + '>' + escapeHtml(r.name) + '</option>'; });
            const d = document.createElement('div');
            d.className = 'alias-card';
            d.innerHTML = \`<div class="field"><label>الكلمة المفتاحية</label><input value="\${escapeHtml(item.trigger)}" oninput="autoRepliesData[\${idx}].trigger=this.value"></div>
                <div class="field"><label>الرد</label><textarea oninput="autoRepliesData[\${idx}].reply=this.value">\${escapeHtml(item.reply)}</textarea></div>
                <div class="field"><label>الرتبة المخصصة</label><select onchange="autoRepliesData[\${idx}].roleId=this.value">\${opts}</select></div>
                <button type="button" class="btn-sm btn-danger" onclick="autoRepliesData.splice(\${idx},1);renderAutoReplies()">حذف</button>\`;
            c.appendChild(d);
        });
    }
    window.addAutoReply = () => { autoRepliesData.push({ trigger: '', reply: '', roleId: 'all' }); renderAutoReplies(); };

    async function load() {
        const [sRes, rRes] = await Promise.all([
            fetch('/api/settings/' + guildId).then(r => r.json()),
            fetch('/api/roles/' + guildId).then(r => r.json()).catch(() => [])
        ]);
        roles = Array.isArray(rRes) ? rRes : [];
        commandAliasesData = sRes.commandAliases || ${JSON.stringify(defaultAliases)};
        rolePointsData = sRes.rolePointsConfig || [];
        autoRepliesData = sRes.autoReplies || [];

        ['prefix','botName','botAvatar','activityText','staffRoleId','ticketCategoryId','logChannelId','renameCooldown'].forEach(k => {
            if (sRes[k] !== undefined) {
                const el = document.getElementById(k);
                if (el) el.value = sRes[k];
            }
        });
        renderAliases();
        renderRolePoints();
        renderAutoReplies();
    }

    document.getElementById('saveButton').onclick = async function() {
        this.disabled = true;
        document.getElementById('status').textContent = 'جارٍ الحفظ...';
        const payload = {
            prefix: document.getElementById('prefix').value,
            botName: document.getElementById('botName').value,
            botAvatar: document.getElementById('botAvatar').value,
            activityText: document.getElementById('activityText').value,
            staffRoleId: document.getElementById('staffRoleId').value,
            ticketCategoryId: document.getElementById('ticketCategoryId').value,
            logChannelId: document.getElementById('logChannelId').value,
            renameCooldown: Number(document.getElementById('renameCooldown').value),
            commandAliases: commandAliasesData,
            rolePointsConfig: rolePointsData,
            autoReplies: autoRepliesData
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
        return res.status(500).send('خطأ.');
    }
});

app.use((req, res) => res.status(404).send('غير موجود.'));
if (process.env.NODE_ENV !== 'production') app.listen(PORT);
module.exports = app;
