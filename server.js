require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

const REDIRECT_URI = process.env.REDIRECT_URI || 'https://ticket-bot-board.vercel.app/api/auth/callback';
const MONGO_URI = process.env.MONGO_URI;
const BOT_TOKEN = process.env.TOKEN;

const BOT_NAME = process.env.BOT_NAME || 'Light Ticket Bot';
const BOT_AVATAR = process.env.BOT_AVATAR || 'https://i.postimg.cc/tJW3r0PJ/Screenshot-20261001-232609-ibis-Paint-X.jpg';
const SITE_BG = 'https://i.postimg.cc/s2x5kG7S/1791496064027.jpg';

if (MONGO_URI && mongoose.connection.readyState === 0) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB Connected in Dashboard'))
        .catch(err => console.error('MongoDB Error:', err));
}

const GuildSettings = mongoose.models.GuildSettings || mongoose.model('GuildSettings', new mongoose.Schema({
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
  botBanner: { type: String, default: '' },
  botStatus: { type: String, default: 'online' },
  activityType: { type: Number, default: 0 },
  activityText: { type: String, default: '-help / التذاكر' },

  claimPoints: { type: Number, default: 1 },
  warnPoints: { type: Number, default: 1 },
  timeoutPoints: { type: Number, default: 1 },
  renameCooldown: { type: Number, default: 10 },

  selectOptions: {
    type: Array,
    default: [
      { label: 'استفسار', value: 'inquiry', emoji: '❓', description: 'للاستفسارات العامة والأسئلة' },
      { label: 'شكوى', value: 'complaint', emoji: '⚠️', description: 'تقديم شكوى إدارية' },
      { label: 'مشكلة تقنية', value: 'technical', emoji: '🛠', description: 'المشاكل الفنية والتقنية' }
    ]
  },

  commandPermissions: { type: Map, of: [String], default: {} },
  commandAliases: {
    type: Map,
    of: String,
    default: {
      add: 'add',
      come: 'come',
      rename: 'rename',
      claim: 'استلام',
      timeout: 'تايم',
      warn: 'تحذير',
      close: 'اغلاق',
      delete: 'حذف',
      addpoints: 'addpoints',
      removepoints: 'removepoints'
    }
  }
}, { timestamps: true }));

// إعدادات Express واللوحة
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-empire-12345',
    resave: true,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI || 'mongodb://localhost:27017/ticketbot',
        ttl: 30 * 24 * 60 * 60
    }),
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

async function getFreshUserGuilds(req) {
    let accessToken = req.session.accessToken;
    if (req.session.refreshToken) {
        try {
            const refreshRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: req.session.refreshToken,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            accessToken = refreshRes.data.access_token;
            req.session.accessToken = accessToken;
            req.session.refreshToken = refreshRes.data.refresh_token;
        } catch (e) {}
    }

    const userGuildsResponse = await axios.get(`https://discord.com/api/users/@me/guilds?_t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    let botGuildIds = new Set();
    try {
        const botGuildsResponse = await axios.get(`https://discord.com/api/users/@me/guilds?limit=200&_t=${Date.now()}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        botGuildIds = new Set(botGuildsResponse.data.map(g => String(g.id)));
    } catch (botErr) {}

    const filtered = userGuildsResponse.data.filter(g => {
        const isManager = (parseInt(g.permissions) & 0x8) === 0x8 || (parseInt(g.permissions) & 0x20) === 0x20;
        const botInGuild = botGuildIds.has(String(g.id));
        return isManager && botInGuild;
    });

    req.session.guilds = filtered;
    return filtered;
}

app.get('/api/roles/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });
    try {
        const response = await axios.get(`https://discord.com/api/v10/guilds/${req.params.guildId}/roles?_t=${Date.now()}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const roles = response.data
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => ({ id: r.id, name: r.name, color: r.color }));
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: 'تعذر جلب رتب السيرفر' });
    }
});

app.get('/api/settings/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });
    try {
        let settings = await GuildSettings.findOne({ guildId: String(req.params.guildId) });
        if (!settings) {
            settings = await GuildSettings.create({ guildId: String(req.params.guildId) });
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'حدث خطأ أثناء جلب الإعدادات' });
    }
});

app.post('/api/settings/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });
    try {
        const guildId = String(req.params.guildId);
        const updateData = req.body;

        const updated = await GuildSettings.findOneAndUpdate(
            { guildId: guildId },
            { $set: updateData },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return res.json({ success: true, settings: updated });
    } catch (err) {
        return res.status(500).json({ error: 'حدث خطأ أثناء حفظ الإعدادات' });
    }
});

app.get('/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('لم يتم استقبال كود التحقق من ديسكورد.');
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        req.session.accessToken = tokenResponse.data.access_token;
        req.session.refreshToken = tokenResponse.data.refresh_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });
        req.session.user = userResponse.data;

        await getFreshUserGuilds(req);
        res.redirect('/dashboard');
    } catch (error) {
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <title>${BOT_NAME} - لوحة التحكم</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
        <style>
            * { margin:0; padding:0; box-sizing:border-box; font-family:'Cairo',sans-serif; }
            body { color:#fff; min-height:100vh; display:flex; justify-content:center; align-items:center; background:#030508; }
            body::before { content:""; position:fixed; inset:0; background:url('${SITE_BG}') center/cover; z-index:-1; filter:brightness(0.25) blur(6px); }
            .card { background:rgba(9,13,20,0.85); backdrop-filter:blur(25px); border:1px solid rgba(114,137,218,0.2); border-radius:32px; padding:50px; text-align:center; max-width:450px; width:90%; }
            .bot-avatar { width:120px; height:120px; border-radius:50%; border:4px solid #5865F2; margin-bottom:20px; object-fit:cover; }
            h1 { font-size:28px; margin-bottom:15px; }
            p { color:#b5bac1; font-size:14px; margin-bottom:30px; }
            .btn { display:inline-block; background:#5865F2; color:#fff; padding:15px 30px; border-radius:14px; text-decoration:none; font-weight:800; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${BOT_AVATAR}" class="bot-avatar">
            <h1>${BOT_NAME}</h1>
            <p>مرحباً بك في لوحة تحكم البوت الاحترافية.</p>
            <a href="${req.session.user ? '/dashboard' : '/login'}" class="btn">تسجيل الدخول بواسطة Discord</a>
        </div>
    </body>
    </html>
    `);
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    let guilds = [];
    try { guilds = await getFreshUserGuilds(req); } catch (e) { guilds = req.session.guilds || []; }

    let guildsHtml = guilds.map(g => `
        <div style="background:rgba(11,16,25,0.85); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:25px; text-align:center;">
            <img src="${g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : 'https://cdn.discordapp.com/embed/avatars/1.png'}" style="width:75px; height:75px; border-radius:20px; margin-bottom:15px;">
            <div style="font-size:18px; font-weight:800; margin-bottom:15px;">${g.name}</div>
            <a href="/dashboard/${g.id}" style="display:block; background:#5865F2; color:#fff; padding:10px; border-radius:12px; text-decoration:none; font-weight:700;">إدارة الإعدادات</a>
        </div>
    `).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head><meta charset="UTF-8"><title>اختر السيرفر</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:'Cairo',sans-serif;}body{background:#030508;color:#fff;min-height:100vh;}body::before{content:"";position:fixed;inset:0;background:url('${SITE_BG}') center/cover;z-index:-1;filter:brightness(0.2) blur(5px);}.container{max-width:1100px;margin:50px auto;padding:0 20px;}</style></head>
    <body>
        <div class="container">
            <h2 style="margin-bottom:30px; font-size:24px;">اختر السيرفر لإدارة البوت</h2>
            <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:20px;">${guildsHtml || '<p>لا توجد سيرفرات متاحة</p>'}</div>
        </div>
    </body>
    </html>
    `);
});

app.get('/dashboard/:guildId', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const guildId = String(req.params.guildId);
    let guilds = [];
    try { guilds = await getFreshUserGuilds(req); } catch (e) { guilds = req.session.guilds || []; }
    const guild = guilds.find(g => String(g.id) === guildId);
    if (!guild) return res.send('❌ لا تملك صلاحيات لإدارة هذا السيرفر.');

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>إعدادات ${guild.name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin:0; padding:0; box-sizing:border-box; font-family:'Cairo',sans-serif; }
            body { color:#fff; min-height:100vh; display:flex; flex-direction:column; background:#030508; }
            body::before { content:""; position:fixed; inset:0; background:url('${SITE_BG}') center/cover; z-index:-1; filter:brightness(0.22) blur(5px); }
            .navbar { background:rgba(9,13,20,0.85); backdrop-filter:blur(20px); padding:20px 40px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); }
            .main-layout { display:flex; flex:1; max-width:1250px; width:100%; margin:40px auto; gap:30px; padding:0 25px; }
            .sidebar { width:285px; background:rgba(11,16,25,0.85); border-radius:24px; padding:22px; display:flex; flex-direction:column; gap:10px; height:fit-content; border:1px solid rgba(255,255,255,0.08); }
            .tab-btn { background:transparent; border:none; color:#949ba4; padding:14px 18px; border-radius:14px; cursor:pointer; text-align:right; font-weight:800; font-size:15px; display:flex; align-items:center; gap:14px; transition:0.3s; }
            .tab-btn.active { background:#5865F2; color:#fff; }
            .content-panel { flex:1; background:rgba(11,16,25,0.85); border-radius:24px; padding:40px; border:1px solid rgba(255,255,255,0.08); }
            .tab-content { display:none; } .tab-content.active { display:block; }
            .form-group { margin-bottom:20px; } label { display:block; margin-bottom:8px; color:#b5bac1; font-weight:700; font-size:14px; }
            input, select, textarea { width:100%; padding:14px; background:rgba(6,9,14,0.8); border:1px solid rgba(255,255,255,0.1); border-radius:14px; color:#fff; }
            select[multiple] { height:140px; }
            .btn-save { background:#5865F2; color:#fff; border:none; padding:14px 30px; border-radius:14px; font-weight:900; cursor:pointer; }
            .cmd-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:20px; }
            .cmd-card { background:rgba(6,9,14,0.7); border:1px solid rgba(255,255,255,0.06); padding:20px; border-radius:16px; }
            .cmd-card label { color:#7983f5; font-weight:800; margin-bottom:10px; display:block; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <a href="/dashboard" style="color:#7983f5; text-decoration:none; font-weight:800;"><i class="fa-solid fa-arrow-right"></i> العودة للسيرفرات</a>
            <div>${guild.name}</div>
        </div>
        <div class="main-layout">
            <div class="sidebar">
                <button class="tab-btn active" onclick="openTab(event, 'botsettings')"><i class="fa-solid fa-robot"></i> إعدادات البوت</button>
                <button class="tab-btn" onclick="openTab(event, 'channels')"><i class="fa-solid fa-hashtag"></i> الرومات والرتب</button>
                <button class="tab-btn" onclick="openTab(event, 'permissions')"><i class="fa-solid fa-user-shield"></i> صلاحيات الأوامر</button>
            </div>
            <div class="content-panel">
                <div id="botsettings" class="tab-content active">
                    <h2>إعدادات البوت الشاملة</h2>
                    <div class="form-group"><label>اسم البوت:</label><input type="text" id="botName"></div>
                    <div class="form-group"><label>رابط الصورة:</label><input type="text" id="botAvatar"></div>
                    <div class="form-group"><label>رابط البانر:</label><input type="text" id="botBanner"></div>
                    <div class="form-group"><label>الحالة:</label><select id="botStatus"><option value="online">متصل</option><option value="idle">خامل</option><option value="dnd">العدم إزعاج</option></select></div>
                    <div class="form-group"><label>نص النشاط:</label><input type="text" id="activityText"></div>
                    <button type="button" class="btn-save" onclick="saveData({ botName: v('botName'), botAvatar: v('botAvatar'), botBanner: v('botBanner'), botStatus: v('botStatus'), activityText: v('activityText') })">حفظ</button>
                </div>
                <div id="channels" class="tab-content">
                    <h2>الرومات والرتب</h2>
                    <div class="form-group"><label>رتبة الإدارة:</label><select id="staffRoleId" class="single-role-select"></select></div>
                    <div class="form-group"><label>كاتيجوري التكتات:</label><input type="text" id="ticketCategoryId"></div>
                    <div class="form-group"><label>روم السجلات:</label><input type="text" id="logChannelId"></div>
                    <button type="button" class="btn-save" onclick="saveData({ staffRoleId: v('staffRoleId'), ticketCategoryId: v('ticketCategoryId'), logChannelId: v('logChannelId') })">حفظ</button>
                </div>
                <div id="permissions" class="tab-content">
                    <h2>صلاحيات الأوامر حسب الرتب</h2>
                    <div class="cmd-grid">
                        ${['add','come','rename','claim','timeout','warn','close','delete','addpoints','removepoints'].map(cmd => `
                            <div class="cmd-card">
                                <label>أمر ${cmd}</label>
                                <select id="perm_${cmd}" class="multi-role-select" multiple></select>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="btn-save" style="margin-top:20px;" onclick="savePermissions()">حفظ الصلاحيات</button>
                </div>
            </div>
        </div>
        <script>
            const guildId = "${guild.id}";
            function v(id) { return document.getElementById(id).value; }

            async function loadData() {
                const rolesRes = await fetch('/api/roles/' + guildId + '?_t=' + Date.now());
                const roles = await rolesRes.json();
                
                document.querySelectorAll('.single-role-select, .multi-role-select').forEach(sel => {
                    sel.innerHTML = '';
                    roles.forEach(r => {
                        const opt = document.createElement('option');
                        opt.value = r.id;
                        opt.textContent = r.name;
                        sel.appendChild(opt);
                    });
                });

                const setRes = await fetch('/api/settings/' + guildId + '?_t=' + Date.now());
                const data = await setRes.json();
                if(data) {
                    if(data.botName) document.getElementById('botName').value = data.botName;
                    if(data.botAvatar) document.getElementById('botAvatar').value = data.botAvatar;
                    if(data.botBanner) document.getElementById('botBanner').value = data.botBanner;
                    if(data.botStatus) document.getElementById('botStatus').value = data.botStatus;
                    if(data.activityText) document.getElementById('activityText').value = data.activityText;
                    if(data.staffRoleId) document.getElementById('staffRoleId').value = data.staffRoleId;
                    if(data.ticketCategoryId) document.getElementById('ticketCategoryId').value = data.ticketCategoryId;
                    if(data.logChannelId) document.getElementById('logChannelId').value = data.logChannelId;

                    if(data.commandPermissions) {
                        ['add','come','rename','claim','timeout','warn','close','delete','addpoints','removepoints'].forEach(cmd => {
                            const sel = document.getElementById('perm_' + cmd);
                            const allowed = data.commandPermissions instanceof Map ? data.commandPermissions.get(cmd) : data.commandPermissions[cmd];
                            if(sel && Array.isArray(allowed)) {
                                Array.from(sel.options).forEach(opt => { if(allowed.includes(opt.value)) opt.selected = true; });
                            }
                        });
                    }
                }
            }
            window.addEventListener('DOMContentLoaded', loadData);

            function openTab(evt, name) {
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById(name).classList.add('active');
                evt.currentTarget.classList.add('active');
            }

            async function saveData(payload) {
                const res = await fetch('/api/settings/' + guildId, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                const r = await res.json();
                if(r.success) alert('✅ تم الحفظ بنجاح!'); else alert('❌ حدث خطأ');
            }

            function savePermissions() {
                const commandPermissions = {};
                ['add','come','rename','claim','timeout','warn','close','delete','addpoints','removepoints'].forEach(cmd => {
                    const sel = document.getElementById('perm_' + cmd);
                    commandPermissions[cmd] = Array.from(sel.selectedOptions).map(o => o.value);
                });
                saveData({ commandPermissions });
            }
        </script>
    </body>
    </html>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// التوافق التام مع نظام Serverless على Vercel
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Dashboard server running on port ${PORT}`));
}
