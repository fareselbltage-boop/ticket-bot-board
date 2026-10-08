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

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// منع التخزين المؤقت نهائياً لتحديث البيانات فوراً عند عمل Refresh
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
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

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

        if (req.session.guilds && Array.isArray(req.session.guilds)) {
            const gIndex = req.session.guilds.findIndex(g => String(g.id) === guildId);
            if (gIndex !== -1 && updateData.botName) {
                req.session.guilds[gIndex].name = updateData.botName;
            }
        }

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

        await getFreshUserGuilds(req);

        res.redirect('/dashboard');
    } catch (error) {
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
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; position: relative; overflow: hidden; background-color: #030508; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.25) blur(6px); transform: scale(1.08); }
            .card { background: rgba(9, 13, 20, 0.82); backdrop-filter: blur(28px); border: 1px solid rgba(114, 137, 218, 0.2); border-radius: 32px; padding: 50px 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 35px 70px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.15); animation: floatCard 0.8s ease-out; }
            @keyframes floatCard { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .bot-avatar { width: 125px; height: 125px; border-radius: 50%; border: 4px solid #5865F2; margin-bottom: 22px; object-fit: cover; box-shadow: 0 0 30px rgba(88,101,242,0.6); }
            h1 { font-size: 32px; font-weight: 900; margin-bottom: 12px; color: #fff; letter-spacing: 0.5px; }
            p { margin: 15px 0 35px; color: #b5bac1; font-size: 15px; line-height: 1.7; }
            .btn-login { display: inline-flex; align-items: center; justify-content: center; gap: 12px; width: 100%; background: linear-gradient(135deg, #5865F2, #4752C4); color: #fff; padding: 16px 28px; font-size: 16px; font-weight: 800; border-radius: 16px; text-decoration: none; transition: all 0.3s ease; box-shadow: 0 10px 25px rgba(88,101,242,0.4); }
            .btn-login:hover { transform: translateY(-3px); box-shadow: 0 18px 35px rgba(88,101,242,0.65); background: linear-gradient(135deg, #6772ff, #515ee0); }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${BOT_AVATAR}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" alt="Bot Avatar" class="bot-avatar">
            <h1>${BOT_NAME}</h1>
            <p>مرحباً بك في لوحة تحكم البوت الاحترافية. سجّل الدخول بحساب ديسكورد للوصول الكامل وإدارة سيرفراتك بكل سهولة.</p>
            <a href="${req.session.user ? '/dashboard' : '/login'}" class="btn-login">
                <i class="fa-brands fa-discord fa-lg"></i> ${req.session.user ? 'الانتقال للوحة التحكم' : 'تسجيل الدخول بواسطة Discord'}
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
    } catch (e) {
        guilds = req.session.guilds || [];
    }

    const user = req.session.user;
    const userAvatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;

    let guildsCardsHtml = '';
    if (guilds.length === 0) {
        guildsCardsHtml = `<div style="grid-column: 1 / -1; text-align: center; padding: 60px; background: rgba(12, 16, 24, 0.8); border-radius: 24px; border: 1px solid rgba(255,255,255,0.06);"><h3 style="color: #949ba4; font-size: 18px;">لا توجد سيرفرات متاحة أو لا تمتلك صلاحيات الإدارة فيها</h3></div>`;
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
                    <a href="/dashboard/${guild.id}" class="btn-manage"><i class="fa-solid fa-sliders"></i> إدارة الإعدادات</a>
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
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; background-color: #030508; position: relative; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.22) blur(5px); }
            .navbar { background: rgba(9, 13, 20, 0.85); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 20px 40px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
            .user-profile { display: flex; align-items: center; gap: 14px; font-weight: 800; font-size: 16px; }
            .user-avatar { width: 48px; height: 48px; border-radius: 50%; border: 2px solid #5865f2; box-shadow: 0 0 15px rgba(88,101,242,0.4); }
            .btn-logout { background: rgba(237, 66, 69, 0.15); color: #ed4245; border: 1px solid rgba(237, 66, 69, 0.3); padding: 10px 20px; border-radius: 12px; text-decoration: none; font-weight: 700; transition: all 0.3s; }
            .btn-logout:hover { background: rgba(237, 66, 69, 0.35); color: #fff; }
            .container { max-width: 1200px; margin: 45px auto; padding: 0 25px; }
            .page-title { font-size: 26px; font-weight: 900; margin-bottom: 30px; display: flex; align-items: center; gap: 12px; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
            .guilds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 25px; }
            .guild-card { background: rgba(11, 16, 25, 0.85); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 28px; display: flex; flex-direction: column; align-items: center; text-align: center; transition: all 0.35s ease; box-shadow: 0 15px 35px rgba(0,0,0,0.5); }
            .guild-card:hover { transform: translateY(-6px); border-color: rgba(88,101,242,0.5); box-shadow: 0 22px 45px rgba(88,101,242,0.25); }
            .guild-icon { width: 85px; height: 85px; border-radius: 24px; margin-bottom: 18px; object-fit: cover; border: 2px solid rgba(255,255,255,0.12); box-shadow: 0 8px 20px rgba(0,0,0,0.5); }
            .guild-name { font-size: 20px; font-weight: 800; margin-bottom: 6px; color: #fff; }
            .guild-id { font-size: 13px; color: #949ba4; margin-bottom: 22px; font-family: monospace; }
            .btn-manage { width: 100%; background: linear-gradient(135deg, rgba(88,101,242,0.25), rgba(88,101,242,0.1)); border: 1px solid rgba(88,101,242,0.4); color: #7983f5; padding: 12px; border-radius: 14px; text-decoration: none; font-weight: 800; transition: all 0.3s; }
            .btn-manage:hover { background: #5865f2; color: #fff; box-shadow: 0 8px 20px rgba(88,101,242,0.45); }
        </style>
    </head>
    <body>
        <div class="navbar">
            <div class="user-profile"><img src="${userAvatar}" class="user-avatar"><span>أهلاً بك، ${user.username} 👋</span></div>
            <a href="/logout" class="btn-logout"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</a>
        </div>
        <div class="container">
            <div class="page-title"><i class="fa-solid fa-server" style="color:#5865f2;"></i> اختر السيرفر لإدارة البوت</div>
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
    
    let guilds = [];
    try {
        guilds = await getFreshUserGuilds(req);
    } catch (e) {
        guilds = req.session.guilds || [];
    }

    const guild = guilds.find(g => String(g.id) === guildId);
    if (!guild) return res.send('❌ لا تملك صلاحيات لإدارة هذا السيرفر.');

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>إعدادات ${guild.name} | ${BOT_NAME}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; background-color: #030508; position: relative; }
            body::before { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: url('${SITE_BG}') no-repeat center center/cover; z-index: -1; filter: brightness(0.22) blur(5px); }
            .navbar { background: rgba(9, 13, 20, 0.85); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.08); padding: 20px 40px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
            .btn-back { color: #7983f5; text-decoration: none; font-weight: 800; display: inline-flex; align-items: center; gap: 8px; background: rgba(88,101,242,0.12); padding: 9px 18px; border-radius: 12px; border: 1px solid rgba(88,101,242,0.25); transition: 0.3s; }
            .btn-back:hover { background: rgba(88,101,242,0.28); color: #fff; }
            .server-badge { font-weight: 800; font-size: 16px; color: #fff; background: rgba(255,255,255,0.06); padding: 9px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 10px; }
            .main-layout { display: flex; flex: 1; max-width: 1250px; width: 100%; margin: 40px auto; gap: 30px; padding: 0 25px; }
            .sidebar { width: 285px; background: rgba(11, 16, 25, 0.85); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 22px; display: flex; flex-direction: column; gap: 10px; height: fit-content; box-shadow: 0 15px 35px rgba(0,0,0,0.5); }
            .tab-btn { background: transparent; border: none; color: #949ba4; padding: 14px 18px; border-radius: 14px; cursor: pointer; text-align: right; font-weight: 800; font-size: 15px; display: flex; align-items: center; gap: 14px; transition: all 0.3s ease; }
            .tab-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .tab-btn.active { background: linear-gradient(135deg, #5865F2, #4752C4); color: #fff; box-shadow: 0 8px 20px rgba(88,101,242,0.45); }
            .content-panel { flex: 1; background: rgba(11, 16, 25, 0.85); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 40px; box-shadow: 0 20px 45px rgba(0,0,0,0.65); }
            .tab-content { display: none; animation: fadeIn 0.4s ease; }
            .tab-content.active { display: block; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            h2 { font-size: 22px; font-weight: 900; margin-bottom: 25px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 15px; color: #fff; display: flex; align-items: center; gap: 12px; }
            .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 22px; }
            .form-group { margin-bottom: 22px; }
            label { display: block; margin-bottom: 8px; font-weight: 700; color: #b5bac1; font-size: 14px; }
            input, select, textarea { width: 100%; padding: 14px 16px; background: rgba(6, 9, 14, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; color: #fff; font-size: 14px; transition: all 0.3s; }
            input:focus, select:focus, textarea:focus { border-color: #5865f2; outline: none; box-shadow: 0 0 0 3px rgba(88,101,242,0.25); background: rgba(6, 9, 14, 0.95); }
            select[multiple] { height: 140px; }
            select option { background: #0c1018; padding: 10px; color: #fff; }
            .btn-save { background: linear-gradient(135deg, #5865F2, #4752C4); color: #fff; border: none; padding: 15px 35px; border-radius: 14px; font-weight: 900; font-size: 16px; cursor: pointer; margin-top: 15px; transition: all 0.3s; box-shadow: 0 8px 22px rgba(88,101,242,0.4); }
            .btn-save:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(88,101,242,0.6); }
            .cmd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
            .cmd-card { background: rgba(6, 9, 14, 0.7); border: 1px solid rgba(255,255,255,0.06); padding: 20px; border-radius: 16px; transition: 0.3s; }
            .cmd-card:hover { border-color: rgba(88,101,242,0.35); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
            .cmd-card label { color: #7983f5; font-weight: 800; font-size: 15px; display: block; margin-bottom: 10px; }
            .hint { font-size: 12px; color: #949ba4; margin-top: 6px; }
            /* تصميم قسم الصلاحيات المطور */
            .perm-select-container { display: flex; flex-direction: column; gap: 8px; }
            .perm-select-container select { width: 100%; border-radius: 12px; background: rgba(4, 7, 11, 0.9); }
        </style>
    </head>
    <body>
        <div class="navbar">
            <a href="/dashboard" class="btn-back"><i class="fa-solid fa-arrow-right"></i> العودة للسيرفرات</a>
            <div class="server-badge"><i class="fa-brands fa-discord" style="color: #5865f2;"></i> ${guild.name}</div>
        </div>
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
                    <h2><i class="fa-solid fa-robot" style="color:#5865f2;"></i> إعدادات حالة واسم وصورة وبانر البوت</h2>
                    <div class="form-grid">
                        <div class="form-group"><label>اسم البوت (Bot Name):</label><input type="text" id="botName"></div>
                        <div class="form-group"><label>رابط صورة البوت (Avatar URL):</label><input type="text" id="botAvatar"></div>
                        <div class="form-group" style="grid-column: 1 / -1;"><label>رابط بانر البوت (Banner URL):</label><input type="text" id="botBanner"></div>
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
                            <label>نص النشاط / الحالة (Activity Text):</label><input type="text" id="activityText">
                        </div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveBotSettings()">حفظ إعدادات البوت</button>
                </div>
                <div id="channels" class="tab-content">
                    <h2><i class="fa-solid fa-hashtag" style="color:#5865f2;"></i> إعدادات الرومات والرتب الذكية</h2>
                    <div class="form-grid">
                        <div class="form-group"><label>رتبة الإدارة الرئيسية:</label><select id="staffRoleId" class="single-role-select"><option value="">جاري جلب الرتب...</option></select></div>
                        <div class="form-group"><label>كاتيجوري التكتات:</label><input type="text" id="ticketCategoryId"></div>
                        <div class="form-group"><label>روم السجلات:</label><input type="text" id="logChannelId"></div>
                    </div>
                    <button type="button" class="btn-save" onclick="saveChannels()">حفظ التغييرات</button>
                </div>
                <div id="design" class="tab-content">
                    <h2><i class="fa-solid fa-palette" style="color:#5865f2;"></i> تخصيص نصوص وصور البانل والتكت</h2>
                    <div class="form-group"><label>صورة البانل:</label><input type="text" id="panelImage"></div>
                    <div class="form-group"><label>صورة التكت الداخلي:</label><input type="text" id="ticketImage"></div>
                    <div class="form-group"><label>عنوان البانل:</label><input type="text" id="panelTitle"></div>
                    <div class="form-group"><label>نص البانل:</label><textarea id="panelDescription" rows="4"></textarea></div>
                    <button type="button" class="btn-save" onclick="saveDesign()">حفظ التصميم</button>
                </div>
                <div id="categories" class="tab-content">
                    <h2><i class="fa-solid fa-list-check" style="color:#5865f2;"></i> قائمة فتح التكتات</h2>
                    <div class="form-group"><label>الخيار الأول:</label><input type="text" id="opt1_label" placeholder="العنوان"><input type="text" id="opt1_emoji" placeholder="الإيموجي" style="margin-top:8px;"><input type="text" id="opt1_desc" placeholder="الوصف" style="margin-top:8px;"></div>
                    <div class="form-group"><label>الخيار الثاني:</label><input type="text" id="opt2_label" placeholder="العنوان"><input type="text" id="opt2_emoji" placeholder="الإيموجي" style="margin-top:8px;"><input type="text" id="opt2_desc" placeholder="الوصف" style="margin-top:8px;"></div>
                    <div class="form-group"><label>الخيار الثالث:</label><input type="text" id="opt3_label" placeholder="العنوان"><input type="text" id="opt3_emoji" placeholder="الإيموجي" style="margin-top:8px;"><input type="text" id="opt3_desc" placeholder="الوصف" style="margin-top:8px;"></div>
                    <button type="button" class="btn-save" onclick="saveCategories()">حفظ الأقسام</button>
                </div>
                <div id="cmdnames" class="tab-content">
                    <h2><i class="fa-solid fa-terminal" style="color:#5865f2;"></i> تخصيص الأوامر والبادئة</h2>
                    <div class="form-group"><label>البادئة (Prefix):</label><input type="text" id="prefix" style="max-width: 250px;"></div>
                    <div class="cmd-grid" style="margin-top: 15px;">
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
                <div id="permissions" class="tab-content">
                    <h2><i class="fa-solid fa-user-shield" style="color:#5865f2;"></i> صلاحيات الأوامر حسب الرتب</h2>
                    <p style="color: #b5bac1; font-size: 13px; margin-bottom: 20px;">قم باختيار الرتبة المسموح لها باستخدام كل أمر (اضغط Ctrl للاختيار المتعدد):</p>
                    <div class="cmd-grid">
                        <div class="cmd-card">
                            <label>أمر add</label>
                            <div class="perm-select-container"><select id="perm_add" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر come</label>
                            <div class="perm-select-container"><select id="perm_come" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر rename</label>
                            <div class="perm-select-container"><select id="perm_rename" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر claim</label>
                            <div class="perm-select-container"><select id="perm_claim" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر timeout</label>
                            <div class="perm-select-container"><select id="perm_timeout" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر warn</label>
                            <div class="perm-select-container"><select id="perm_warn" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر close</label>
                            <div class="perm-select-container"><select id="perm_close" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر delete</label>
                            <div class="perm-select-container"><select id="perm_delete" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر addpoints</label>
                            <div class="perm-select-container"><select id="perm_addpoints" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                        <div class="cmd-card">
                            <label>أمر removepoints</label>
                            <div class="perm-select-container"><select id="perm_removepoints" class="multi-role-select" multiple></select></div>
                            <div class="hint">اتركه فارغاً للجميع</div>
                        </div>
                    </div>
                    <button type="button" class="btn-save" onclick="savePermissions()">حفظ الصلاحيات</button>
                </div>
                <div id="points" class="tab-content">
                    <h2><i class="fa-solid fa-trophy" style="color:#5865f2;"></i> النقاط والمهل</h2>
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

            async function loadRoles() {
                try {
                    const res = await fetch('/api/roles/' + currentGuildId + '?_t=' + Date.now());
                    serverRoles = await res.json();
                    
                    const staffSelect = document.getElementById('staffRoleId');
                    if(staffSelect) {
                        staffSelect.innerHTML = '<option value="">-- اختر رتبة الإدارة --</option>';
                        serverRoles.forEach(role => {
                            const opt = document.createElement('option');
                            opt.value = role.id;
                            opt.textContent = '🛡️ ' + role.name;
                            staffSelect.appendChild(opt);
                        });
                    }

                    const multiSelects = document.querySelectorAll('.multi-role-select');
                    multiSelects.forEach(select => {
                        select.innerHTML = '';
                        serverRoles.forEach(role => {
                            const opt = document.createElement('option');
                            opt.value = role.id;
                            opt.textContent = '🛡️ ' + role.name;
                            select.appendChild(opt);
                        });
                    });
                } catch (err) { console.error('Error loading roles:', err); }
            }

            window.addEventListener('DOMContentLoaded', async () => {
                await loadRoles();
                try {
                    const res = await fetch('/api/settings/' + currentGuildId + '?_t=' + Date.now());
                    const data = await res.json();
                    if (data && !data.error) {
                        if (data.botName !== undefined) document.getElementById('botName').value = data.botName;
                        if (data.botAvatar !== undefined) document.getElementById('botAvatar').value = data.botAvatar;
                        if (data.botBanner !== undefined) document.getElementById('botBanner').value = data.botBanner;
                        if (data.botStatus !== undefined) document.getElementById('botStatus').value = data.botStatus;
                        if (data.activityType !== undefined) document.getElementById('activityType').value = data.activityType;
                        if (data.activityText !== undefined) document.getElementById('activityText').value = data.activityText;

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
                                if (el && data.commandAliases.get ? data.commandAliases.get(cmd) : data.commandAliases[cmd]) {
                                    el.value = data.commandAliases.get ? data.commandAliases.get(cmd) : data.commandAliases[cmd];
                                }
                            });
                        }
                        if (data.commandPermissions) {
                            ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                                const el = document.getElementById('perm_' + cmd);
                                const allowedRoles = data.commandPermissions.get ? data.commandPermissions.get(cmd) : data.commandPermissions[cmd];
                                if (el && Array.isArray(allowedRoles)) {
                                    Array.from(el.options).forEach(opt => {
                                        if (allowedRoles.includes(opt.value)) opt.selected = true;
                                    });
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
                    botBanner: document.getElementById('botBanner').value.trim(),
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
                ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                    commandAliases[cmd] = document.getElementById('alias_' + cmd).value.trim() || cmd;
                });
                const prefix = document.getElementById('prefix').value.trim() || '-';
                postPayload({ prefix, commandAliases }, '✅ تم الحفظ بنجاح!');
            }
            function savePermissions() {
                const commandPermissions = {};
                ['add', 'come', 'rename', 'claim', 'timeout', 'warn', 'close', 'delete', 'addpoints', 'removepoints'].forEach(cmd => {
                    const select = document.getElementById('perm_' + cmd);
                    const selectedRoles = Array.from(select.selectedOptions).map(opt => opt.value);
                    commandPermissions[cmd] = selectedRoles;
                });
                postPayload({ commandPermissions }, '✅ تم حفظ الصلاحيات بنجاح!');
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
