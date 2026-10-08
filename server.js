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

if (MONGO_URI) {
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
    resave: false,
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
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            accessToken = refreshRes.data.access_token;
            req.session.accessToken = accessToken;
            req.session.refreshToken = refreshRes.data.refresh_token;
        } catch (e) {
            console.log('Refresh token attempt failed, using existing access token.');
        }
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
    } catch (botErr) {
        console.error('Bot Guilds Fetch Error:', botErr.response ? botErr.response.data : botErr.message);
    }

    return userGuildsResponse.data.filter(g => {
        const isManager = (parseInt(g.permissions) & 0x8) === 0x8 || (parseInt(g.permissions) & 0x20) === 0x20;
        const botInGuild = botGuildIds.has(String(g.id));
        return isManager && botInGuild;
    });
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
        console.error('Fetch Roles Error:', err.response ? err.response.data : err.message);
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
        console.error('Get Settings Error:', err);
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
        console.error('Save Settings Error:', err);
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
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refreshToken;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.accessToken = accessToken;
        req.session.refreshToken = refreshToken;
        req.session.user = userResponse.data;

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Auth Callback Error:', error.response ? error.response.data : error.message);
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} - لوحة التحكم الاحترافية</title>
        
        <!-- Open Graph / Discord Embed Meta Tags -->
        <meta property="og:site_name" content="${BOT_NAME}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="${BOT_NAME} - لوحة التحكم للإدارة">
        <meta property="og:description" content="مرحباً بك! قم بإدارة سيرفرك ونظام التذاكر باحترافية وسهولة عبر لوحة التحكم الخاصة بنا.">
        <meta property="og:image" content="https://i.postimg.cc/tJW3r0PJ/Screenshot-20261001-232609-ibis-Paint-X.jpg">
        <meta property="og:url" content="https://ticket-bot-board.vercel.app">
        <meta name="theme-color" content="#5865F2">

        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; overflow: hidden; background-color: #0b0e14; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.4) blur(2px); }
            .card { background: rgba(15, 18, 25, 0.75); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 24px; padding: 45px 35px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.7); }
            .bot-avatar { width: 110px; height: 110px; border-radius: 50%; border: 3px solid #5865F2; margin-bottom: 20px; object-fit: cover; }
            h1 { font-size: 28px; font-weight: 800; margin-bottom: 10px; color: #fff; }
            p { margin: 15px 0 30px; color: #b9bbbe; font-size: 15px; line-height: 1.6; }
            .btn-login { display: inline-flex; align-items: center; justify-content: center; gap: 12px; width: 100%; background: #5865F2; color: #fff; padding: 14px 28px; font-size: 16px; font-weight: 700; border-radius: 12px; text-decoration: none; transition: 0.3s; }
            .btn-login:hover { background: #4752C4; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${BOT_AVATAR}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" alt="Bot Avatar" class="bot-avatar">
            <h1>${BOT_NAME}</h1>
            <p>مرحباً بك! يرجى تسجيل الدخول بحساب ديسكورد لإدارة واستعراض سيرفراتك.</p>
            <a href="${req.session.user ? '/dashboard' : '/login'}" class="btn-login">
                <i class="fa-brands fa-discord"></i> ${req.session.user ? 'الانتقال للوحة التحكم' : 'تسجيل الدخول بواسطة Discord'}
            </a>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    let guilds = [];
    try {
        guilds = await getFreshUserGuilds(req);
        req.session.guilds = guilds;
    } catch (e) {
        guilds = req.session.guilds || [];
    }

    const user = req.session.user;
    const userAvatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;

    let guildsCardsHtml = '';
    if (guilds.length === 0) {
        guildsCardsHtml = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: rgba(24, 30, 41, 0.85); border-radius: 16px;"><h3>لا توجد سيرفرات متاحة</h3></div>`;
    } else {
        guilds.forEach(guild => {
            const guildIcon = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : `https://cdn.discordapp.com/embed/avatars/1.png`;
            guildsCardsHtml += `
                <div class="guild-card">
                    <img src="${guildIcon}" class="guild-icon" alt="${guild.name}">
                    <div class="guild-info">
                        <div class="guild-name">${guild.name}</div>
                        <div class="guild-id">ID: ${guild.id}</div>
                    </div>
                    <a href="/dashboard/${guild.id}" class="btn-manage"><i class="fa-solid fa-gear"></i> إعدادات البوت</a>
                </div>
            `;
        });
    }

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة التحكم | ${BOT_NAME}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; background-color: #0f1219; position: relative; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.35) blur(2px); }
            .navbar { background: rgba(22, 27, 34, 0.85); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .user-profile { display: flex; align-items: center; gap: 12px; }
            .user-avatar { width: 45px; height: 45px; border-radius: 50%; border: 2px solid #5865f2; }
            .btn-logout { background: rgba(237, 66, 69, 0.2); color: #ed4245; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .container { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
            .guilds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
            .guild-card { background: rgba(24, 30, 41, 0.85); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; }
            .guild-icon { width: 70px; height: 70px; border-radius: 20px; margin-bottom: 12px; object-fit: cover; }
            .guild-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
            .guild-id { font-size: 12px; color: #80848e; margin-bottom: 18px; }
            .btn-manage { width: 100%; background: rgba(88,101,242,0.2); color: #5865f2; padding: 10px; border-radius: 10px; text-decoration: none; font-weight: 700; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <div class="user-profile"><img src="${userAvatar}" class="user-avatar"><span>أهلاً بك، ${user.username} 👋</span></div>
            <a href="/logout" class="btn-logout"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</a>
        </div>
        <div class="container">
            <h2 style="margin-bottom: 25px;"><i class="fa-solid fa-server" style="color:#5865f2;"></i> اختر السيرفر لإدارة البوت</h2>
            <div class="guilds-grid">${guildsCardsHtml}</div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/dashboard/:guildId', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const guildId = String(req.params.guildId);
    let guilds = req.session.guilds || [];
    const guild = guilds.find(g => String(g.id) === guildId);
    if (!guild) return res.send('❌ لا تملك صلاحيات لإدارة هذا السيرفر.');

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>إعدادات ${guild.name} | ${BOT_NAME}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; background-color: #0f1219; position: relative; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.35) blur(2px); }
            .navbar { background: rgba(22, 27, 34, 0.85); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .btn-back { color: #5865f2; text-decoration: none; font-weight: 700; }
            .main-layout { display: flex; flex: 1; max-width: 1200px; width: 100%; margin: 30px auto; gap: 25px; padding: 0 20px; }
            .sidebar { width: 270px; background: rgba(24, 30, 41, 0.85); border-radius: 16px; padding: 15px; display: flex; flex-direction: column; gap: 8px; height: fit-content; }
            .tab-btn { background: transparent; border: none; color: #949ba4; padding: 12px 16px; border-radius: 10px; cursor: pointer; text-align: right; font-weight: 700; display: flex; gap: 12px; }
            .tab-btn.active { background: #5865f2; color: #fff; }
            .content-panel { flex: 1; background: rgba(24, 30, 41, 0.85); border-radius: 16px; padding: 30px; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            h2 { font-size: 20px; font-weight: 800; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; }
            .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: 600; color: #b5bac1; font-size: 14px; }
            input, select, textarea { width: 100%; padding: 12px; background: rgba(11, 14, 20, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; }
            select option { background: #161b22; padding: 4px; }
            .btn-save { background: #5865f2; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; cursor: pointer; margin-top: 10px; }
            .cmd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 15px; }
            .cmd-card { background: rgba(11, 14, 20, 0.7); padding: 15px; border-radius: 10px; }
            .cmd-card label { color: #5865f2; font-weight: 700; font-size: 15px; display: block; margin-bottom: 5px; }
            .hint { font-size: 11px; color: #949ba4; margin-top: 4px; }

            /* تصميم القائمة المنسدلة الاحترافية المتعددة الرتب */
            .custom-dropdown { position: relative; width: 100%; user-select: none; }
            .dropdown-select-box { background: rgba(11, 14, 20, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: #fff; min-height: 48px; }
            .dropdown-options-container { position: absolute; top: 100%; left: 0; right: 0; background: #161b22; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; margin-top: 5px; max-height: 200px; overflow-y: auto; z-index: 99; display: none; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .dropdown-options-container.open { display: block; }
            .dropdown-option { padding: 10px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: 0.2s; color: #b5bac1; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.03); }
            .dropdown-option:hover { background: rgba(88, 101, 242, 0.2); color: #fff; }
            .dropdown-option input[type="checkbox"] { accent-color: #5865f2; width: 16px; height: 16px; cursor: pointer; }
            .selected-tags { display: flex; flex-wrap: wrap; gap: 5px; }
            .selected-tag { background: rgba(88, 101, 242, 0.25); color: #5865f2; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; border: 1px solid rgba(88, 101, 242, 0.4); }
        </style>
    </head>
    <body>
        <div class="navbar"><a href="/dashboard" class="btn-back"><i class="fa-solid fa-arrow-right"></i> العودة</a><span>سيرفر: <b>${guild.name}</b></span></div>
        <div class="main-layout">
            <div class="sidebar">
                <button class="tab-btn active" onclick="openTab(event, 'botsettings')"><i class="fa-solid fa-robot"></i> إعدادات البوت</button>
                <button class="tab-btn" onclick="openTab(event, 'channels')"><i class="fa-solid fa-hashtag"></i> الرومات والرتب</button>
                <button class="tab-btn" onclick="openTab(event, 'design')"><i class="fa-solid fa-palette"></i> التصاميم والصور</button>
                <button class="tab-btn" onclick="openTab(event, 'categories')"><i class="fa-solid fa-list-check"></i> أقسام القائمة</button>
                <button class="tab-btn" onclick="openTab(event, 'cmdnames')"><i class="fa-solid fa-terminal"></i> أسماء الأوامر والبادئة</button>
                <button class="tab-btn" onclick="openTab(event, 'permissions')"><i class="fa-solid fa-user-shield"></i> صلاحيات الأوامر</button>
                <button class="tab-btn" onclick="openTab(event, 'points')"><i class="fa-solid fa-trophy"></i> إعدادات النقاط</button>
            </div>
            <div class="content-panel">
                <div id="botsettings" class="tab-content active">
                    <h2><i class="fa-solid fa-robot" style="color:#5865f2;"></i> إعدادات حالة واسم وصورة البوت</h2>
                    <div class="form-grid">
                        <div class="form-group"><label>اسم البوت (Bot Name):</label><input type="text" id="botName"></div>
                        <div class="form-group"><label>رابط صورة البوت (Avatar URL):</label><input type="text" id="botAvatar"></div>
                        <div class="form-group">
                            <label>حالة البوت (Status):</label>
                            <select id="botStatus">
                                <option value="online">متصل (Online)</option>
                                <option value="idle">مشغول / خامل (Idle)</option>
                                <option value="dnd">عدم الإزعاج (Do Not Disturb)</option>
                                <option value="invisible">مخفي (Invisible)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>نوع النشاط (Activity Type):</label>
                            <select id="activityType">
                                <option value="0">يلعب (Playing)</option>
                                <option value="2">يستمع إلى (Listening)</option>
                                <option value="3">يشاهد (Watching)</option>
                                <option value="5">في منافسة (Competing)</option>
                            </select>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>نص النشاط / الحالة (Activity Text):</label>
                            <input type="text" id="activityText" placeholder="مثال: -help | نظام التذاكر">
                        </div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveBotSettings()"><i class="fa-solid fa-floppy-disk"></i> حفظ إعدادات البوت</button>
                </div>

                <div id="channels" class="tab-content">
                    <h2>إعدادات الرومات والرتب الذكية</h2>
                    <div class="form-grid">
                        <div class="form-group"><label>رتبة الإدارة الرئيسية:</label><select id="staffRoleId" class="single-role-select"><option value="">جاري جلب الرتب...</option></select></div>
                        <div class="form-group"><label>كاتيجوري التكتات:</label><input type="text" id="ticketCategoryId"></div>
                        <div class="form-group"><label>روم السجلات:</label><input type="text" id="logChannelId"></div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveChannels()">حفظ التغييرات</button>
                </div>
                <div id="design" class="tab-content">
                    <h2>تخصيص نصوص وصور البانل والتكت</h2>
                    <div class="form-group"><label>صورة البانل:</label><input type="text" id="panelImage"></div>
                    <div class="form-group"><label>صورة التكت الداخلي:</label><input type="text" id="ticketImage"></div>
                    <div class="form-group"><label>عنوان البانل:</label><input type="text" id="panelTitle"></div>
                    <div class="form-group"><label>نص البانل:</label><textarea id="panelDescription" rows="3"></textarea></div>
                    <button type="button" class="btn-save" onclick="saveDesign()">حفظ التصميم</button>
                </div>
                <div id="categories" class="tab-content">
                    <h2>قائمة فتح التكتات</h2>
                    <div class="form-group"><label>الخيار الأول:</label><input type="text" id="opt1_label"><input type="text" id="opt1_emoji" style="margin-top:5px;"><input type="text" id="opt1_desc" style="margin-top:5px;"></div>
                    <div class="form-group"><label>الخيار الثاني:</label><input type="text" id="opt2_label"><input type="text" id="opt2_emoji" style="margin-top:5px;"><input type="text" id="opt2_desc" style="margin-top:5px;"></div>
                    <div class="form-group"><label>الخيار الثالث:</label><input type="text" id="opt3_label"><input type="text" id="opt3_emoji" style="margin-top:5px;"><input type="text" id="opt3_desc" style="margin-top:5px;"></div>
                    <button type="button" class="btn-save" onclick="saveCategories()">حفظ الأقسام</button>
                </div>
                <div id="cmdnames" class="tab-content">
                    <h2>تخصيص الأوامر والبادئة</h2>
                    <div class="form-group"><label>البادئة (Prefix):</label><input type="text" id="prefix"></div>
                    <div class="cmd-grid">
                        <div class="cmd-card"><label>أمر الإضافة</label><input type="text" id="alias_add"></div>
                        <div class="cmd-card"><label>أمر المنشن</label><input type="text" id="alias_come"></div>
                        <div class="cmd-card"><label>أمر تغيير الاسم</label><input type="text" id="alias_rename"></div>
                        <div class="cmd-card"><label>أمر الاستلام</label><input type="text" id="alias_claim"></div>
                        <div class="cmd-card"><label>أمر التايم أوت</label><input type="text" id="alias_timeout"></div>
                        <div class="cmd-card"><label>أمر التحذير</label><input type="text" id="alias_warn"></div>
                        <div class="cmd-card"><label>أمر إغلاق</label><input type="text" id="alias_close"></div>
                        <div class="cmd-card"><label>أمر حذف</label><input type="text" id="alias_delete"></div>
                        <div class="cmd-card"><label>إضافة نقاط</label><input type="text" id="alias_addpoints"></div>
                        <div class="cmd-card"><label>خصم نقاط</label><input type="text" id="alias_removepoints"></div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveAliases()">حفظ الأوامر</button>
                </div>
                
                <!-- قسم صلاحيات الأوامر بالشكل الاحترافي المطلوب -->
                <div id="permissions" class="tab-content">
                    <h2>صلاحيات الأوامر المخصصة حسب الرتب</h2>
                    <div class="cmd-grid">
                        ${['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].map(cmd => `
                            <div class="cmd-card">
                                <label>/${cmd}</label>
                                <div class="custom-dropdown" id="dropdown_${cmd}">
                                    <div class="dropdown-select-box" onclick="toggleDropdown('${cmd}')">
                                        <span class="selected-tags" id="tags_${cmd}">اختر الرتب...</span>
                                        <i class="fa-solid fa-chevron-down" style="color: #949ba4; font-size: 12px;"></i>
                                    </div>
                                    <div class="dropdown-options-container" id="options_${cmd}">
                                        <!-- سيتم تعبئة الرتب ديناميكياً هنا -->
                                    </div>
                                </div>
                                <div class="hint">اتركه فارغاً للجميع</div>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="btn-save" onclick="savePermissions()">حفظ الصلاحيات</button>
                </div>

                <div id="points" class="tab-content">
                    <h2>النقاط والمهل</h2>
                    <div class="form-grid">
                        <div class="form-group"><label>نقاط الاستلام:</label><input type="number" id="claimPoints"></div>
                        <div class="form-group"><label>نقاط التحذير:</label><input type="number" id="warnPoints"></div>
                        <div class="form-group"><label>نقاط التايم أوت:</label><input type="number" id="timeoutPoints"></div>
                        <div class="form-group"><label>مهلة rename:</label><input type="number" id="renameCooldown"></div>
                    </div>
                    <button type="button" class="btn-save" onclick="savePoints()">حفظ النقاط</button>
                </div>
            </div>
        </div>
        <script>
            const currentGuildId = "${guild.id}";
            let serverRoles = [];
            const commandsList = ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'];

            async function loadRoles() {
                try {
                    const res = await fetch('/api/roles/' + currentGuildId + '?_t=' + Date.now());
                    serverRoles = await res.json();
                    
                    const staffSelect = document.getElementById('staffRoleId');
                    staffSelect.innerHTML = '<option value="">-- اختر رتبة الإدارة --</option>';
                    serverRoles.forEach(role => {
                        const opt = document.createElement('option');
                        opt.value = role.id;
                        opt.textContent = '🛡️ ' + role.name;
                        staffSelect.appendChild(opt);
                    });

                    // تعبئة القوائم المنسدلة الاحترافية لكل أمر
                    commandsList.forEach(cmd => {
                        const container = document.getElementById('options_' + cmd);
                        if (!container) return;
                        container.innerHTML = '';
                        serverRoles.forEach(role => {
                            const div = document.createElement('div');
                            div.className = 'dropdown-option';
                            div.innerHTML = \`<input type="checkbox" value="\${role.id}" onchange="updateTags('\${cmd}')"> 🛡️ \${role.name}\`;
                            div.onclick = (e) => {
                                if (e.target.tagName !== 'INPUT') {
                                    const cb = div.querySelector('input');
                                    cb.checked = !cb.checked;
                                    updateTags(cmd);
                                }
                            };
                            container.appendChild(div);
                        });
                    });
                } catch (err) { console.error('Error loading roles:', err); }
            }

            function toggleDropdown(cmd) {
                document.querySelectorAll('.dropdown-options-container').forEach(el => {
                    if (el.id !== 'options_' + cmd) el.classList.remove('open');
                });
                const container = document.getElementById('options_' + cmd);
                container.classList.toggle('open');
            }

            window.addEventListener('click', (e) => {
                if (!e.target.closest('.custom-dropdown')) {
                    document.querySelectorAll('.dropdown-options-container').forEach(el => el.classList.remove('open'));
                }
            });

            function updateTags(cmd) {
                const container = document.getElementById('options_' + cmd);
                const tagsContainer = document.getElementById('tags_' + cmd);
                const checkedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');

                if (checkedBoxes.length === 0) {
                    tagsContainer.innerHTML = '<span style="color:#949ba4;">اختر الرتب...</span>';
                    return;
                }

                let html = '';
                checkedBoxes.forEach(cb => {
                    const roleName = cb.parentElement.textContent.trim();
                    html += \`<span class="selected-tag">\${roleName}</span>\`;
                });
                tagsContainer.innerHTML = html;
            }

            window.addEventListener('DOMContentLoaded', async () => {
                await loadRoles();
                try {
                    const res = await fetch('/api/settings/' + currentGuildId + '?_t=' + Date.now());
                    const data = await res.json();
                    if (data && !data.error) {
                        if (data.botName) document.getElementById('botName').value = data.botName;
                        if (data.botAvatar) document.getElementById('botAvatar').value = data.botAvatar;
                        if (data.botStatus) document.getElementById('botStatus').value = data.botStatus;
                        if (data.activityType !== undefined) document.getElementById('activityType').value = data.activityType;
                        if (data.activityText) document.getElementById('activityText').value = data.activityText;

                        if (data.prefix) document.getElementById('prefix').value = data.prefix;
                        if (data.staffRoleId) document.getElementById('staffRoleId').value = data.staffRoleId;
                        if (data.ticketCategoryId) document.getElementById('ticketCategoryId').value = data.ticketCategoryId;
                        if (data.logChannelId) document.getElementById('logChannelId').value = data.logChannelId;
                        if (data.panelImage) document.getElementById('panelImage').value = data.panelImage;
                        if (data.ticketImage) document.getElementById('ticketImage').value = data.ticketImage;
                        if (data.panelTitle) document.getElementById('panelTitle').value = data.panelTitle;
                        if (data.panelDescription) document.getElementById('panelDescription').value = data.panelDescription;
                        if (data.claimPoints !== undefined) document.getElementById('claimPoints').value = data.claimPoints;
                        if (data.warnPoints !== undefined) document.getElementById('warnPoints').value = data.warnPoints;
                        if (data.timeoutPoints !== undefined) document.getElementById('timeoutPoints').value = data.timeoutPoints;
                        if (data.renameCooldown !== undefined) document.getElementById('renameCooldown').value = data.renameCooldown;

                        if (data.selectOptions && data.selectOptions.length >= 3) {
                            for(let i=0; i<3; i++) {
                                document.getElementById('opt'+(i+1)+'_label').value = data.selectOptions[i].label || '';
                                document.getElementById('opt'+(i+1)+'_emoji').value = data.selectOptions[i].emoji || '';
                                document.getElementById('opt'+(i+1)+'_desc').value = data.selectOptions[i].description || '';
                            }
                        }
                        if (data.commandAliases) {
                            ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                                const el = document.getElementById('alias_' + cmd);
                                if (el && data.commandAliases[cmd]) el.value = data.commandAliases[cmd];
                            });
                        }
                        if (data.commandPermissions) {
                            commandsList.forEach(cmd => {
                                const allowedRoles = data.commandPermissions[cmd];
                                if (Array.isArray(allowedRoles)) {
                                    const container = document.getElementById('options_' + cmd);
                                    if (container) {
                                        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                                            if (allowedRoles.includes(cb.value)) {
                                                cb.checked = true;
                                            }
                                        });
                                        updateTags(cmd);
                                    }
                                }
                            });
                        }
                    }
                } catch (e) { console.error('Fetch error:', e); }
            });

            function openTab(evt, tabName) {
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.getElementById(tabName).classList.add('active');
                evt.currentTarget.classList.add('active');
            }

            async function postPayload(payload, msg) {
                try {
                    const res = await fetch('/api/settings/' + currentGuildId + '?_t=' + Date.now(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json();
                    if (result.success) alert(msg); else alert('❌ حدث خطأ.');
                } catch (err) { alert('❌ تعذر الاتصال.'); }
            }

            function saveBotSettings() {
                postPayload({
                    botName: document.getElementById('botName').value.trim(),
                    botAvatar: document.getElementById('botAvatar').value.trim(),
                    botStatus: document.getElementById('botStatus').value,
                    activityType: Number(document.getElementById('activityType').value) || 0,
                    activityText: document.getElementById('activityText').value.trim()
                }, '✅ تم حفظ إعدادات البوت بنجاح!');
            }
            function saveChannels() {
                postPayload({
                    staffRoleId: document.getElementById('staffRoleId').value.trim(),
                    ticketCategoryId: document.getElementById('ticketCategoryId').value.trim(),
                    logChannelId: document.getElementById('logChannelId').value.trim()
                }, '✅ تم الحفظ بنجاح!');
            }
            function saveDesign() {
                postPayload({
                    panelImage: document.getElementById('panelImage').value.trim(),
                    ticketImage: document.getElementById('ticketImage').value.trim(),
                    panelTitle: document.getElementById('panelTitle').value.trim(),
                    panelDescription: document.getElementById('panelDescription').value.trim()
                }, '✅ تم الحفظ بنجاح!');
            }
            function saveCategories() {
                const selectOptions = [
                    { label: document.getElementById('opt1_label').value.trim(), value: 'inquiry', emoji: document.getElementById('opt1_emoji').value.trim(), description: document.getElementById('opt1_desc').value.trim() },
                    { label: document.getElementById('opt2_label').value.trim(), value: 'complaint', emoji: document.getElementById('opt2_emoji').value.trim(), description: document.getElementById('opt2_desc').value.trim() },
                    { label: document.getElementById('opt3_label').value.trim(), value: 'technical', emoji: document.getElementById('opt3_emoji').value.trim(), description: document.getElementById('opt3_desc').value.trim() }
                ];
                postPayload({ selectOptions }, '✅ تم الحفظ بنجاح!');
            }
            function saveAliases() {
                const commandAliases = {};
                commandsList.forEach(cmd => {
                    commandAliases[cmd] = document.getElementById('alias_' + cmd).value.trim() || cmd;
                });
                const prefix = document.getElementById('prefix').value.trim() || '-';
                postPayload({ prefix, commandAliases }, '✅ تم الحفظ بنجاح!');
            }
            function savePermissions() {
                const commandPermissions = {};
                commandsList.forEach(cmd => {
                    const container = document.getElementById('options_' + cmd);
                    const selected = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
                    commandPermissions[cmd] = selected;
                });
                postPayload({ commandPermissions }, '✅ تم حفظ صلاحيات الأوامر بنجاح!');
            }
            function savePoints() {
                postPayload({
                    claimPoints: Number(document.getElementById('claimPoints').value) || 1,
                    warnPoints: Number(document.getElementById('warnPoints').value) || 1,
                    timeoutPoints: Number(document.getElementById('timeoutPoints').value) || 1,
                    renameCooldown: Number(document.getElementById('renameCooldown').value) || 10
                }, '✅ تم الحفظ بنجاح!');
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => { res.redirect('/'); });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
