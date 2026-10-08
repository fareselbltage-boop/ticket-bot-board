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
const BOT_TOKEN = process.env.TOKEN; // توكن البوت

const BOT_NAME = process.env.BOT_NAME || 'Empire Ticket Bot';
const BOT_AVATAR = process.env.BOT_AVATAR || 'https://i.postimg.cc/8P2L5vX4/1000020307.jpg';

// الاتصال بـ MongoDB
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('MongoDB Connected in Dashboard'))
        .catch(err => console.error('MongoDB Error:', err));
}

// تعريف موديل GuildSettings
const GuildSettings = mongoose.models.GuildSettings || mongoose.model('GuildSettings', new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  staffRoleId: { type: String, default: '1555478928708337775' },
  ticketCategoryId: { type: String, default: '1555176022352208012' },
  logChannelId: { type: String, default: '1555488444182962216' },
  panelImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
  ticketImage: { type: String, default: 'https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg' },
  panelTitle: { type: String, default: '🎫 LIGHT Support | الدعم الفني' },
  panelDescription: { type: String, default: 'مرحباً بك في نظام الدعم الفني الخاص بسيرفر LIGHT.' }
}, { timestamps: true }));

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إعداد الجلسة
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

// API لجلب الإعدادات
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

// API لحفظ الإعدادات
app.post('/api/settings/:guildId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'غير مصرح' });

    try {
        const guildId = String(req.params.guildId);
        const updateData = {
            staffRoleId: req.body.staffRoleId,
            ticketCategoryId: req.body.ticketCategoryId,
            logChannelId: req.body.logChannelId,
            panelImage: req.body.panelImage,
            ticketImage: req.body.ticketImage,
            panelTitle: req.body.panelTitle,
            panelDescription: req.body.panelDescription
        };

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

// تسجيل الدخول عبر ديسكورد
app.get('/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// استقبال العودة وتصفية السيرفرات التي يتواجد بها البوت فقط
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

        // جلب بيانات المستخدم
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // جلب سيرفرات المستخدم
        const userGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // جلب سيرفرات البوت
        let botGuildIds = new Set();
        try {
            const botGuildsResponse = await axios.get('https://discord.com/api/users/@me/guilds?limit=200', {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            });
            botGuildIds = new Set(botGuildsResponse.data.map(g => String(g.id)));
        } catch (botErr) {
            console.error('Bot Guilds Fetch Error:', botErr.response ? botErr.response.data : botErr.message);
        }

        // تصفية السيرفرات: المستخدم إداري + البوت موجود في السيرفر
        const validGuilds = userGuildsResponse.data.filter(g => {
            const isManager = (parseInt(g.permissions) & 0x8) === 0x8 || (parseInt(g.permissions) & 0x20) === 0x20;
            const botInGuild = botGuildIds.has(String(g.id));
            return isManager && botInGuild;
        });

        req.session.user = userResponse.data;
        req.session.guilds = validGuilds;

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Auth Callback Error:', error.response ? error.response.data : error.message);
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

// الصفحة الرئيسية
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');

    const html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BOT_NAME} - لوحة التحكم الاحترافية</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { background: #0b0e14; color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; }
            .card { background: rgba(22, 27, 34, 0.85); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 40px 30px; max-width: 480px; width: 90%; text-align: center; }
            .bot-avatar { width: 100px; height: 100px; border-radius: 50%; border: 3px solid #5865F2; margin-bottom: 20px; }
            .btn-login { display: inline-flex; align-items: center; justify-content: center; gap: 12px; width: 100%; background: #5865F2; color: #fff; padding: 14px 28px; font-size: 16px; font-weight: 700; border-radius: 12px; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${BOT_AVATAR}" alt="Bot Avatar" class="bot-avatar">
            <h1>${BOT_NAME}</h1>
            <p style="margin: 15px 0 25px; color: #949ba4;">مرحباً بك! يرجى تسجيل الدخول بحساب ديسكورد لإدارة سيرفراتك.</p>
            <a href="/login" class="btn-login"><i class="fa-brands fa-discord"></i> تسجيل الدخول بواسطة Discord</a>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// قائمة السيرفرات
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const user = req.session.user;
    const guilds = req.session.guilds || [];

    const userAvatar = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

    let guildsCardsHtml = '';

    if (guilds.length === 0) {
        guildsCardsHtml = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: #181e29; border-radius: 16px; border: 1px solid rgba(255,255,255,0.07);">
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
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { background: #0f1219; color: #ffffff; min-height: 100vh; padding-bottom: 50px; }
            .navbar { background: #161b22; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .user-profile { display: flex; align-items: center; gap: 12px; }
            .user-avatar { width: 45px; height: 45px; border-radius: 50%; border: 2px solid #5865f2; }
            .btn-logout { background: rgba(237, 66, 69, 0.15); color: #ed4245; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-weight: 600; }
            .container { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
            .page-title { font-size: 24px; font-weight: 800; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; }
            .guilds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
            .guild-card { background: #181e29; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; }
            .guild-icon { width: 70px; height: 70px; border-radius: 20px; margin-bottom: 12px; object-fit: cover; }
            .guild-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
            .guild-id { font-size: 12px; color: #80848e; margin-bottom: 18px; }
            .btn-manage { width: 100%; background: rgba(88,101,242,0.15); color: #5865f2; border: 1px solid rgba(88,101,242,0.4); padding: 10px; border-radius: 10px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
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
    const guild = (req.session.guilds || []).find(g => String(g.id) === guildId);

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
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Cairo', sans-serif; }
            body { background: #0f1219; color: #ffffff; min-height: 100vh; display: flex; flex-direction: column; }
            .navbar { background: #161b22; border-bottom: 1px solid rgba(255,255,255,0.08); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
            .btn-back { color: #5865f2; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
            .main-layout { display: flex; flex: 1; max-width: 1200px; width: 100%; margin: 30px auto; gap: 25px; padding: 0 20px; }
            .sidebar { width: 270px; background: #181e29; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 15px; display: flex; flex-direction: column; gap: 8px; height: fit-content; }
            .tab-btn { background: transparent; border: none; color: #949ba4; padding: 12px 16px; border-radius: 10px; cursor: pointer; text-align: right; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 12px; }
            .tab-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .tab-btn.active { background: #5865f2; color: #fff; }
            .content-panel { flex: 1; background: #181e29; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 30px; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }
            h2 { font-size: 20px; font-weight: 800; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; display: flex; align-items: center; gap: 10px; }
            .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: 600; color: #b5bac1; font-size: 14px; }
            input, textarea { width: 100%; padding: 12px; background: #0b0e14; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 14px; outline: none; }
            input:focus, textarea:focus { border-color: #5865f2; }
            .btn-save { background: #5865f2; color: #fff; border: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; cursor: pointer; transition: 0.3s; margin-top: 10px; }
            .btn-save:hover { background: #4752c4; }
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
                    <button type="button" class="btn-save" onclick="saveSettings('${guild.id}')"><i class="fa-solid fa-floppy-disk"></i> حفظ التغييرات</button>
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
                    <button type="button" class="btn-save" onclick="saveSettings('${guild.id}')"><i class="fa-solid fa-floppy-disk"></i> حفظ التصميم</button>
                </div>
            </div>
        </div>

        <script>
            const currentGuildId = "${guild.id}";

            // جلب البيانات المخزنة وتعبئتها فور فتح الصفحة
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

            async function saveSettings(gId) {
                const payload = {
                    staffRoleId: document.getElementById('staffRoleId').value.trim(),
                    ticketCategoryId: document.getElementById('ticketCategoryId').value.trim(),
                    logChannelId: document.getElementById('logChannelId').value.trim(),
                    panelImage: document.getElementById('panelImage').value.trim(),
                    ticketImage: document.getElementById('ticketImage').value.trim(),
                    panelTitle: document.getElementById('panelTitle').value.trim(),
                    panelDescription: document.getElementById('panelDescription').value.trim()
                };

                try {
                    const res = await fetch('/api/settings/' + gId, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert('✅ تم حفظ التعديلات في MongoDB بنجاح! وستنعكس فوراً على البوت.');
                    } else {
                        alert('❌ حدث خطأ أثناء الحفظ: ' + (result.error || 'خطأ غير معروف'));
                    }
                } catch (err) {
                    alert('❌ تعذر الاتصال بالسيرفر.');
                }
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
