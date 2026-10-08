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

// الاتصال بـ MongoDB
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB Connected in Dashboard'))
        .catch(err => console.error('MongoDB Error:', err));
}

// موديل GuildSettings
const GuildSettings = mongoose.models.GuildSettings || mongoose.model('GuildSettings', new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  staffRoleId: { type: String, default: '1555478928708337775' },
  ticketCategoryId: { type: String, default: '1555176022352208012' },
  logChannelId: { type: String, default: '1555488444182962216' },
  panelImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
  ticketImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
  panelTitle: { type: String, default: '🎫 LIGHT Support | الدعم الفني' },
  panelDescription: { type: String, default: 'مرحباً بك في نظام الدعم الفني الخاص بسيرفر LIGHT.' },
  
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

  commandPermissions: {
    type: Map,
    of: String,
    default: {}
  }
}, { timestamps: true }));

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
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
            { upsert: true, new: true }
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
        const refreshToken = tokenResponse.data.refresh_token;

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

// الصفحة الرئيسية مع إعدادات المعاينة الفخمة
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} - لوحة التحكم الاحترافية</title>

        <!-- Open Graph Meta Tags -->
        <meta property="og:title" content="${BOT_NAME} - لوحة التحكم الرسمية">
        <meta property="og:description" content="قم بإدارة وتخصيص كافة إعدادات البوت، الأقسام، والصلاحيات بسهولة عبر لوحة التحكم الرسمية.">
        <meta property="og:image" content="${BOT_AVATAR}">
        <meta property="og:type" content="website">
        <meta name="theme-color" content="#5865F2">

        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body {
                color: #ffffff;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                position: relative;
                overflow: hidden;
                background-color: #0b0e14;
            }
            body::before {
                content: "";
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: url('${SITE_BG}') no-repeat center center/cover;
                z-index: -1;
                filter: brightness(0.4) blur(2px);
                animation: animatedBg 20s infinite alternate ease-in-out;
            }
            @keyframes animatedBg {
                0% { transform: scale(1); }
                100% { transform: scale(1.08); }
            }
            .card {
                background: rgba(15, 18, 25, 0.75);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 24px;
                padding: 45px 35px;
                max-width: 480px;
                width: 90%;
                text-align: center;
                box-shadow: 0 25px 50px rgba(0,0,0,0.7);
            }
            .bot-avatar {
                width: 110px;
                height: 110px;
                border-radius: 50%;
                border: 3px solid #5865F2;
                margin-bottom: 20px;
                object-fit: cover;
                box-shadow: 0 0 25px rgba(88,101,242,0.5);
            }
            h1 { font-size: 28px; font-weight: 800; margin-bottom: 10px; color: #fff; }
            p { margin: 15px 0 30px; color: #b9bbbe; font-size: 15px; line-height: 1.6; }
            .btn-login {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                width: 100%;
                background: #5865F2;
                color: #fff;
                padding: 14px 28px;
                font-size: 16px;
                font-weight: 700;
                border-radius: 12px;
                text-decoration: none;
                transition: all 0.3s ease;
                box-shadow: 0 8px 20px rgba(88,101,242,0.4);
            }
            .btn-login:hover {
                background: #4752C4;
                transform: translateY(-2px);
                box-shadow: 0 12px 25px rgba(88,101,242,0.6);
            }
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

// قائمة السيرفرات
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    let guilds = [];
    try {
        guilds = await getFreshUserGuilds(req);
        req.session.guilds = guilds;
    } catch (e) {
        console.error('Refresh Guilds Error:', e.message);
        guilds = req.session.guilds || [];
    }

    const user = req.session.user;
    const userAvatar = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

    let guildsCardsHtml = '';

    if (guilds.length === 0) {
        guildsCardsHtml = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: rgba(24, 30, 41, 0.85); backdrop-filter: blur(10px); border-radius: 16px; border: 1px solid rgba(255,255,255,0.07);">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 40px; color: #fee75c; margin-bottom: 15px;"></i>
                <h3 style="margin-bottom: 10px;">لا توجد سيرفرات متاحة</h3>
                <p style="color: #949ba4;">تأكد من أنك تمتلك صلاحية إدارة بالسيرفر وأن البوت موجود فيه حالياً.</p>
            </div>
        `;
    } else {
        guilds.forEach(guild => {
            const guildIcon = guild.icon 
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
                : `https://cdn.discordapp.com/embed/avatars/1.png`;

            guildsCardsHtml += `
                <div class="guild-card">
                    <img src="${guildIcon}" class="guild-icon" alt="${guild.name}">
                    <div class="guild-info">
                        <div class="guild-name">${guild.name}</div>
                        <div class="guild-id">ID: ${guild.id}</div>
                    </div>
                    <a href="/dashboard/${guild.id}" class="btn-manage">
                        <i class="fa-solid fa-gear"></i> إعدادات البوت
                    </a>
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

        <!-- Open Graph Meta Tags -->
        <meta property="og:title" content="${BOT_NAME} - قائمة السيرفرات">
        <meta property="og:description" content="قم بضبط وتعديل خيارات وإعدادات البوت بالسيرفر الخاص بك.">
        <meta property="og:image" content="${BOT_AVATAR}">
        <meta name="theme-color" content="#5865F2">

        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; padding-bottom: 50px; background-color: #0f1219; position: relative; }
            body::before {
                content: "";
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: url('${SITE_BG}') no-repeat center center/cover;
                z-index: -1;
                filter: brightness(0.35) blur(2px);
                animation: animatedBg 20s infinite alternate ease-in-out;
            }
            @keyframes animatedBg {
                0% { transform: scale(1); }
                100% { transform: scale(1.08); }
            }
            .navbar { background: rgba(22, 27, 34, 0.85); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .user-profile { display: flex; align-items: center; gap: 12px; }
            .user-avatar { width: 45px; height: 45px; border-radius: 50%; border: 2px solid #5865f2; }
            .btn-logout { background: rgba(237, 66, 69, 0.2); color: #ed4245; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; border: 1px solid rgba(237, 66, 69, 0.3); }
            .container { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
            .page-title { font-size: 24px; font-weight: 800; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; }
            .guilds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
            .guild-card { background: rgba(24, 30, 41, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; transition: all 0.3s; }
            .guild-card:hover { transform: translateY(-4px); border-color: #5865f2; box-shadow: 0 10px 25px rgba(88,101,242,0.2); }
            .guild-icon { width: 70px; height: 70px; border-radius: 20px; margin-bottom: 12px; object-fit: cover; }
            .guild-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
            .guild-id { font-size: 12px; color: #80848e; margin-bottom: 18px; }
            .btn-manage { width: 100%; background: rgba(88,101,242,0.2); color: #5865f2; border: 1px solid rgba(88,101,242,0.4); padding: 10px; border-radius: 10px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: 0.3s; }
            .btn-manage:hover { background: #5865f2; color: #fff; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <div class="user-profile">
                <img src="${userAvatar}" class="user-avatar" alt="${user.username}">
                <span class="user-name">أهلاً بك، ${user.username} 👋</span>
            </div>
            <a href="/logout" class="btn-logout"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</a>
        </div>
        <div class="container">
            <h2 class="page-title"><i class="fa-solid fa-server" style="color:#5865f2;"></i> اختر السيرفر لإدارة البوت</h2>
            <div class="guilds-grid">
                ${guildsCardsHtml}
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// صفحة الإعدادات الشاملة
app.get('/dashboard/:guildId', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const guildId = String(req.params.guildId);
    
    let guilds = [];
    try {
        guilds = await getFreshUserGuilds(req);
        req.session.guilds = guilds;
    } catch (e) {
        guilds = req.session.guilds || [];
    }

    const guild = guilds.find(g => String(g.id) === guildId);

    if (!guild) {
        return res.send('❌ لا تملك صلاحيات لإدارة هذا السيرفر أو أن البوت غير موجود به.');
    }

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>إعدادات ${guild.name} | ${BOT_NAME}</title>

        <meta property="og:title" content="${BOT_NAME} - إعدادات السيرفر">
        <meta property="og:description" content="إدارة إعدادات وتخصيصات ${guild.name}.">
        <meta property="og:image" content="${BOT_AVATAR}">
        <meta name="theme-color" content="#5865F2">

        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; background-color: #0f1219; position: relative; }
            body::before {
                content: "";
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: url('${SITE_BG}') no-repeat center center/cover;
                z-index: -1;
                filter: brightness(0.35) blur(2px);
                animation: animatedBg 20s infinite alternate ease-in-out;
            }
            @keyframes animatedBg {
                0% { transform: scale(1); }
                100% { transform: scale(1.08); }
            }
            .navbar { background: rgba(22, 27, 34, 0.85); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .btn-back { color: #5865f2; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
            .main-layout { display: flex; flex: 1; max-width: 1200px; width: 100%; margin: 30px auto; gap: 25px; padding: 0 20px; }
            .sidebar { width: 270px; background: rgba(24, 30, 41, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 15px; display: flex; flex-direction: column; gap: 8px; height: fit-content; }
            .tab-btn { background: transparent; border: none; color: #949ba4; padding: 12px 16px; border-radius: 10px; cursor: pointer; text-align: right; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 12px; transition: all 0.3s; }
            .tab-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .tab-btn.active { background: #5865f2; color: #fff; }
            .content-panel { flex: 1; background: rgba(24, 30, 41, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 30px; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            h2 { font-size: 20px; font-weight: 800; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; display: flex; align-items: center; gap: 10px; }
            .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: 600; color: #b5bac1; font-size: 14px; }
            input, textarea { width: 100%; padding: 12px; background: rgba(11, 14, 20, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 14px; outline: none; }
            input:focus, textarea:focus { border-color: #5865f2; }
            .btn-save { background: #5865f2; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; cursor: pointer; transition: 0.3s; margin-top: 10px; }
            .btn-save:hover { background: #4752c4; }
            .cmd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 15px; }
            .cmd-card { background: rgba(11, 14, 20, 0.7); padding: 15px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); }
            .cmd-card label { color: #5865f2; font-weight: 700; font-size: 15px; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <a href="/dashboard" class="btn-back"><i class="fa-solid fa-arrow-right"></i> العودة للوحة التحكم</a>
            <span>سيرفر: <b>${guild.name}</b></span>
        </div>

        <div class="main-layout">
            <div class="sidebar">
                <button class="tab-btn active" onclick="openTab(event, 'channels')"><i class="fa-solid fa-hashtag"></i> الرومات والرتب</button>
                <button class="tab-btn" onclick="openTab(event, 'design')"><i class="fa-solid fa-palette"></i> التصاميم والصور</button>
                <button class="tab-btn" onclick="openTab(event, 'categories')"><i class="fa-solid fa-list-check"></i> أقسام القائمة</button>
                <button class="tab-btn" onclick="openTab(event, 'permissions')"><i class="fa-solid fa-user-shield"></i> صلاحيات الأوامر</button>
                <button class="tab-btn" onclick="openTab(event, 'points')"><i class="fa-solid fa-trophy"></i> إعدادات النقاط</button>
            </div>

            <div class="content-panel">
                <!-- Tab 1: Channels & Roles -->
                <div id="channels" class="tab-content active">
                    <h2><i class="fa-solid fa-hashtag" style="color:#5865f2;"></i> إعدادات الرومات والرتب الذكية</h2>
                    <div class="form-grid">
                        <div class="form-group">
                            <label>رتبة الإدارة الرئيسية (STAFF_ROLE_ID):</label>
                            <input type="text" id="staffRoleId" placeholder="أدخل ID الرتبة">
                        </div>
                        <div class="form-group">
                            <label>كاتيجوري التكتات (TICKET_CATEGORY_ID):</label>
                            <input type="text" id="ticketCategoryId" placeholder="أدخل ID الكاتيجوري">
                        </div>
                        <div class="form-group">
                            <label>روم السجلات (LOG_CHANNEL_ID):</label>
                            <input type="text" id="logChannelId" placeholder="أدخل ID الروم">
                        </div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveChannels()"><i class="fa-solid fa-floppy-disk"></i> حفظ التغييرات</button>
                </div>

                <!-- Tab 2: Panel & Ticket Design -->
                <div id="design" class="tab-content">
                    <h2><i class="fa-solid fa-palette" style="color:#fee75c;"></i> تخصيص نصوص وصور البانل والتكت</h2>
                    <div class="form-group">
                        <label>رابط صورة البانل الخارجي (PANEL_IMAGE):</label>
                        <input type="text" id="panelImage">
                    </div>
                    <div class="form-group">
                        <label>رابط صورة التكت الداخلي (TICKET_IMAGE):</label>
                        <input type="text" id="ticketImage">
                    </div>
                    <div class="form-group">
                        <label>عنوان رسالة البانل (-panel):</label>
                        <input type="text" id="panelTitle">
                    </div>
                    <div class="form-group">
                        <label>نص رسالة البانل الخارجي:</label>
                        <textarea id="panelDescription" rows="3"></textarea>
                    </div>
                    <button type="button" class="btn-save" onclick="saveDesign()"><i class="fa-solid fa-floppy-disk"></i> حفظ التصميم</button>
                </div>

                <!-- Tab 3: Select Menu Categories -->
                <div id="categories" class="tab-content">
                    <h2><i class="fa-solid fa-list-check" style="color:#23a55a;"></i> تخصيص خيارات قائمة فتح التكتات</h2>
                    <div class="form-group">
                        <label>الخيار الأول (اسم - إيموجي - وصف):</label>
                        <input type="text" id="opt1_label" placeholder="اسم القسم">
                        <input type="text" id="opt1_emoji" placeholder="الإيموجي" style="margin-top:5px;">
                        <input type="text" id="opt1_desc" placeholder="الوصف المقتضب" style="margin-top:5px;">
                    </div>
                    <div class="form-group">
                        <label>الخيار الثاني (اسم - إيموجي - وصف):</label>
                        <input type="text" id="opt2_label" placeholder="اسم القسم">
                        <input type="text" id="opt2_emoji" placeholder="الإيموجي" style="margin-top:5px;">
                        <input type="text" id="opt2_desc" placeholder="الوصف المقتضب" style="margin-top:5px;">
                    </div>
                    <div class="form-group">
                        <label>الخيار الثالث (اسم - إيموجي - وصف):</label>
                        <input type="text" id="opt3_label" placeholder="اسم القسم">
                        <input type="text" id="opt3_emoji" placeholder="الإيموجي" style="margin-top:5px;">
                        <input type="text" id="opt3_desc" placeholder="الوصف المقتضب" style="margin-top:5px;">
                    </div>
                    <button type="button" class="btn-save" onclick="saveCategories()"><i class="fa-solid fa-floppy-disk"></i> حفظ الأقسام</button>
                </div>

                <!-- Tab 4: Command Permissions -->
                <div id="permissions" class="tab-content">
                    <h2><i class="fa-solid fa-user-shield" style="color:#eb459e;"></i> صلاحيات الأوامر بالرتب (ID الرتبة المسموحة)</h2>
                    <div class="cmd-grid">
                        <div class="cmd-card"><label>-add</label><input type="text" id="perm_add" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-come</label><input type="text" id="perm_come" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-rename</label><input type="text" id="perm_rename" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-استلام</label><input type="text" id="perm_claim" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-تايم</label><input type="text" id="perm_timeout" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-تحذير</label><input type="text" id="perm_warn" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-اغلاق</label><input type="text" id="perm_close" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-حذف</label><input type="text" id="perm_delete" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-addpoints</label><input type="text" id="perm_addpoints" placeholder="ID الرتبة المسموحة"></div>
                        <div class="cmd-card"><label>-removepoints</label><input type="text" id="perm_removepoints" placeholder="ID الرتبة المسموحة"></div>
                    </div>
                    <button type="button" class="btn-save" onclick="savePermissions()"><i class="fa-solid fa-floppy-disk"></i> حفظ الصلاحيات</button>
                </div>

                <!-- Tab 5: Points & Settings -->
                <div id="points" class="tab-content">
                    <h2><i class="fa-solid fa-trophy" style="color:#f1c40f;"></i> إعدادات النقاط والمهل الزمنية</h2>
                    <div class="form-grid">
                        <div class="form-group">
                            <label>نقاط الاستلام (-استلام):</label>
                            <input type="number" id="claimPoints">
                        </div>
                        <div class="form-group">
                            <label>نقاط التحذير (-تحذير):</label>
                            <input type="number" id="warnPoints">
                        </div>
                        <div class="form-group">
                            <label>نقاط التايم أوت (-تايم):</label>
                            <input type="number" id="timeoutPoints">
                        </div>
                        <div class="form-group">
                            <label>مهلة تغيير اسم التكت (-rename بالدقائق):</label>
                            <input type="number" id="renameCooldown">
                        </div>
                    </div>
                    <button type="button" class="btn-save" onclick="savePoints()"><i class="fa-solid fa-floppy-disk"></i> حفظ إعدادات النقاط والمهل</button>
                </div>

            </div>
        </div>

        <script>
            const currentGuildId = "${guild.id}";

            window.addEventListener('DOMContentLoaded', async () => {
                try {
                    const res = await fetch('/api/settings/' + currentGuildId);
                    const data = await res.json();
                    if (data && !data.error) {
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
                            document.getElementById('opt1_label').value = data.selectOptions[0].label || '';
                            document.getElementById('opt1_emoji').value = data.selectOptions[0].emoji || '';
                            document.getElementById('opt1_desc').value = data.selectOptions[0].description || '';

                            document.getElementById('opt2_label').value = data.selectOptions[1].label || '';
                            document.getElementById('opt2_emoji').value = data.selectOptions[1].emoji || '';
                            document.getElementById('opt2_desc').value = data.selectOptions[1].description || '';

                            document.getElementById('opt3_label').value = data.selectOptions[2].label || '';
                            document.getElementById('opt3_emoji').value = data.selectOptions[2].emoji || '';
                            document.getElementById('opt3_desc').value = data.selectOptions[2].description || '';
                        }

                        if (data.commandPermissions) {
                            const perms = data.commandPermissions;
                            ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                                const el = document.getElementById('perm_' + cmd);
                                if (el && perms[cmd]) el.value = perms[cmd];
                            });
                        }
                    }
                } catch (e) {
                    console.error('Fetch error:', e);
                }
            });

            function openTab(evt, tabName) {
                var i, tabcontent, tablinks;
                tabcontent = document.getElementsByClassName("tab-content");
                for (i = 0; i < tabcontent.length; i++) {
                    tabcontent[i].classList.remove("active");
                }
                tablinks = document.getElementsByClassName("tab-btn");
                for (i = 0; i < tablinks.length; i++) {
                    tablinks[i].classList.remove("active");
                }
                document.getElementById(tabName).classList.add("active");
                evt.currentTarget.classList.add("active");
            }

            async function postPayload(payload, msg) {
                try {
                    const res = await fetch('/api/settings/' + currentGuildId, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(msg);
                    } else {
                        alert('❌ حدث خطأ أثناء الحفظ.');
                    }
                } catch (err) {
                    alert('❌ تعذر الاتصال بالسيرفر.');
                }
            }

            function saveChannels() {
                postPayload({
                    staffRoleId: document.getElementById('staffRoleId').value.trim(),
                    ticketCategoryId: document.getElementById('ticketCategoryId').value.trim(),
                    logChannelId: document.getElementById('logChannelId').value.trim()
                }, '✅ تم حفظ إعدادات الرومات والرتب بنجاح!');
            }

            function saveDesign() {
                postPayload({
                    panelImage: document.getElementById('panelImage').value.trim(),
                    ticketImage: document.getElementById('ticketImage').value.trim(),
                    panelTitle: document.getElementById('panelTitle').value.trim(),
                    panelDescription: document.getElementById('panelDescription').value.trim()
                }, '✅ تم حفظ تصاميم وصور البانل والتكت بنجاح!');
            }

            function saveCategories() {
                const selectOptions = [
                    {
                        label: document.getElementById('opt1_label').value.trim() || 'استفسار',
                        value: 'inquiry',
                        emoji: document.getElementById('opt1_emoji').value.trim() || '❓',
                        description: document.getElementById('opt1_desc').value.trim() || 'للاستفسارات العامة'
                    },
                    {
                        label: document.getElementById('opt2_label').value.trim() || 'شكوى',
                        value: 'complaint',
                        emoji: document.getElementById('opt2_emoji').value.trim() || '⚠️',
                        description: document.getElementById('opt2_desc').value.trim() || 'تقديم شكوى'
                    },
                    {
                        label: document.getElementById('opt3_label').value.trim() || 'مشكلة تقنية',
                        value: 'technical',
                        emoji: document.getElementById('opt3_emoji').value.trim() || '🛠',
                        description: document.getElementById('opt3_desc').value.trim() || 'المشاكل الفنية'
                    }
                ];
                postPayload({ selectOptions }, '✅ تم حفظ أقسام القائمة المخصصة بنجاح!');
            }

            function savePermissions() {
                const commandPermissions = {};
                ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                    commandPermissions[cmd] = document.getElementById('perm_' + cmd).value.trim();
                });
                postPayload({ commandPermissions }, '✅ تم حفظ صلاحيات الأوامر بالرتب بنجاح!');
            }

            function savePoints() {
                postPayload({
                    claimPoints: Number(document.getElementById('claimPoints').value) || 1,
                    warnPoints: Number(document.getElementById('warnPoints').value) || 1,
                    timeoutPoints: Number(document.getElementById('timeoutPoints').value) || 1,
                    renameCooldown: Number(document.getElementById('renameCooldown').value) || 10
                }, '✅ تم حفظ إعدادات النقاط والمهل بنجاح!');
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
