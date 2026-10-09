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
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID || 'PUT_YOUR_DISCORD_USER_ID_HERE';
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
    { label: 'استفسار', value: 'inquiry', emoji: '❓', description: 'للاستفسارات العامة والأسئلة' },
    { label: 'شكوى', value: 'complaint', emoji: '⚠️', description: 'تقديم شكوى إدارية' },
    { label: 'مشكلة تقنية', value: 'technical', emoji: '🛠', description: 'المشاكل الفنية والتقنية' }
];

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
            async function isAuthorizedGuild(req, guildId, forceRefresh = false) {
    const guilds = await getFreshUserGuilds(req, forceRefresh);
    const isOwner = String(req.session.user?.id || '') === OWNER_DISCORD_ID;

    if (isOwner) return true;

    return guilds.some(guild => String(guild.id) === String(guildId));
}

app.get('/', (req, res) => {
    if (req.session?.user) {
        return res.redirect('/dashboard');
    }

    res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(BOT_NAME)} | تسجيل الدخول</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:Arial,sans-serif;background:#101018;color:#fff;display:flex;align-items:center;justify-content:center;padding:20px}
.card{width:100%;max-width:460px;padding:35px;border:1px solid #303044;border-radius:20px;background:#191923;text-align:center;box-shadow:0 20px 60px #0008}
img{width:100px;height:100px;border-radius:50%;object-fit:cover}
h1{margin:20px 0 10px}
p{color:#b8b8c9;line-height:1.8}
a{display:block;margin-top:25px;padding:14px;background:#5865f2;color:#fff;text-decoration:none;border-radius:10px;font-weight:bold}
a:hover{background:#4752c4}
.small{font-size:12px;color:#888}
</style>
</head>
<body>
<div class="card">
<img src="${escapeHtml(BOT_AVATAR)}" alt="Bot">
<h1>لوحة تحكم ${escapeHtml(BOT_NAME)}</h1>
<p>سجّل دخولك باستخدام Discord للتحكم في إعدادات البوت والسيرفرات التي تملك صلاحية إدارتها.</p>
<a href="/login">تسجيل الدخول باستخدام Discord</a>
<p class="small">يلزم السماح بتسجيل الدخول عبر Discord OAuth2.</p>
</div>
</body>
</html>`);
});

app.get('/login', (req, res) => {
    const params = new URLSearchParams({
        client_id: process.env.CLIENT_ID || '',
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds'
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.redirect('/?error=missing_code');
    }

    try {
        const tokenResponse = await axios.post(
            `${API}/oauth2/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID || '',
                client_secret: process.env.CLIENT_SECRET || '',
                grant_type: 'authorization_code',
                code: String(code),
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 15000
            }
        );

        const tokenData = tokenResponse.data;

        const userResponse = await axios.get(`${API}/users/@me`, {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`
            },
            timeout: 15000
        });

        req.session.user = userResponse.data;
        req.session.accessToken = tokenData.access_token;
        req.session.refreshToken = tokenData.refresh_token || null;
        req.session.guilds = null;

        req.session.save(error => {
            if (error) {
                console.error('Session save error:', error.message);
                return res.status(500).send('تعذر حفظ جلسة تسجيل الدخول. حاول مرة أخرى.');
            }

            res.redirect('/dashboard');
        });
    } catch (error) {
        console.error(
            'Discord OAuth error:',
            error.response?.data || error.message
        );

        res.redirect('/?error=oauth_failed');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(error => {
        if (error) {
            console.error('Logout error:', error.message);
        }

        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/api/me', requireLogin, (req, res) => {
    res.json({
        user: {
            id: req.session.user.id,
            username: req.session.user.username,
            global_name: req.session.user.global_name,
            avatar: req.session.user.avatar
        }
    });
});

app.get('/api/guilds', requireLogin, async (req, res) => {
    try {
        const guilds = await getFreshUserGuilds(req, true);

        res.json({
            guilds: guilds.map(guild => ({
                id: guild.id,
                name: guild.name,
                icon: guild.icon,
                permissions: guild.permissions
            }))
        });
    } catch (error) {
        console.error('Guild list error:', error.message);

        res.status(500).json({
            error: 'تعذر تحميل قائمة السيرفرات.'
        });
    }
    app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const guilds = await getFreshUserGuilds(req);

        res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>لوحة التحكم</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Arial,sans-serif;background:#101018;color:#fff}
header{padding:20px 5%;display:flex;align-items:center;justify-content:space-between;background:#191923;border-bottom:1px solid #303044}
.brand{display:flex;align-items:center;gap:12px}
.brand img{width:45px;height:45px;border-radius:50%}
a{color:#fff;text-decoration:none}
.logout{background:#e5484d;padding:10px 15px;border-radius:8px}
main{max-width:1100px;margin:35px auto;padding:0 20px}
h1{margin-bottom:10px}
.subtitle{color:#aaa;line-height:1.7}
.guilds{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px;margin-top:25px}
.guild{background:#191923;border:1px solid #303044;padding:22px;border-radius:15px}
.guild img{width:65px;height:65px;border-radius:50%;object-fit:cover;background:#29293a}
.guild h3{overflow-wrap:anywhere}
.btn{display:block;text-align:center;background:#5865f2;padding:12px;border-radius:9px;margin-top:15px}
.btn:hover{background:#4752c4}
.empty{padding:25px;background:#191923;border-radius:12px;color:#bbb}
</style>
</head>
<body>
<header>
<div class="brand">
<img src="${escapeHtml(req.session.user.avatar ? `https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png` : BOT_AVATAR)}" alt="">
<strong>${escapeHtml(req.session.user.global_name || req.session.user.username)}</strong>
</div>
<a class="logout" href="/logout">تسجيل الخروج</a>
</header>
<main>
<h1>لوحة التحكم</h1>
<p class="subtitle">اختر السيرفر الذي تريد إدارة إعدادات البوت فيه.</p>
<div class="guilds">
${guilds.length ? guilds.map(guild => `
<div class="guild">
<img src="${guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : BOT_AVATAR}" alt="">
<h3>${escapeHtml(guild.name)}</h3>
<p class="subtitle">معرّف السيرفر: ${escapeHtml(guild.id)}</p>
<a class="btn" href="/dashboard/${encodeURIComponent(guild.id)}">إدارة السيرفر</a>
</div>
`).join('') : '<div class="empty">لم يتم العثور على سيرفرات يمكنك إدارتها. تأكد من صلاحيات حسابك.</div>'}
</div>
</main>
</body>
</html>`);
    } catch (error) {
        console.error('Dashboard error:', error.message);
        res.status(500).send('حدث خطأ أثناء تحميل لوحة التحكم. حاول تسجيل الدخول مجدداً.');
    }
});

app.get('/dashboard/:guildId', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).send('معرّف السيرفر غير صحيح.');
        }

        const authorized = await isAuthorizedGuild(req, guildId);

        if (!authorized) {
            return res.status(403).send('ليس لديك صلاحية إدارة هذا السيرفر.');
        }

        const settings = await GuildSettings.findOneAndUpdate(
            { guildId },
            { $setOnInsert: { guildId } },
            { upsert: true, new: true }
        );

        const user = req.session.user;
        const avatar = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : BOT_AVATAR;

        res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إعدادات السيرفر</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Arial,sans-serif;background:#101018;color:#fff}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:18px 5%;background:#191923;border-bottom:1px solid #303044}
header a{color:#c5c5ff;text-decoration:none}
.user{display:flex;align-items:center;gap:10px}
.user img{width:38px;height:38px;border-radius:50%}
main{max-width:1100px;margin:25px auto;padding:0 18px}
.card{background:#191923;border:1px solid #303044;border-radius:14px;padding:22px;margin-bottom:20px}
h1,h2{margin-top:0}
p{color:#aaa;line-height:1.7}
label{display:block;margin:16px 0 7px}
input,textarea,select{width:100%;padding:12px;background:#101018;color:#fff;border:1px solid #3a3a50;border-radius:8px;font:inherit}
textarea{min-height:100px;resize:vertical}
button,.button{border:0;border-radius:8px;padding:12px 17px;background:#5865f2;color:#fff;font:inherit;cursor:pointer;text-decoration:none;display:inline-block;margin-top:15px}
button:hover,.button:hover{background:#4752c4}
.secondary{background:#343447}
.status{margin-top:15px;padding:12px;border-radius:8px;display:none;white-space:pre-wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:15px}
.checkline{display:flex;align-items:center;gap:10px}
.checkline input{width:auto}
.option{border:1px solid #343447;padding:15px;border-radius:10px;margin-top:12px}
</style>
</head>
<body>
<header>
<div><a href="/dashboard">← قائمة السيرفرات</a></div>
<div class="user"><img src="${escapeHtml(avatar)}" alt=""><span>${escapeHtml(user.global_name || user.username)}</span></div>
</header>
<main>
<h1>إعدادات السيرفر</h1>
<p>السيرفر: ${escapeHtml(guildId)}</p>
<div id="status" class="status"></div>

<form id="settingsForm">
<div class="card">
<h2>إعدادات التذاكر</h2>
<div class="grid">
<div><label>البادئة</label><input name="prefix" value="${escapeHtml(settings.prefix)}" maxlength="5" required></div>
<div><label>معرّف رتبة الإدارة</label><input name="staffRoleId" value="${escapeHtml(settings.staffRoleId)}"></div>
<div><label>معرّف كاتيجوري التذاكر</label><input name="ticketCategoryId" value="${escapeHtml(settings.ticketCategoryId)}"></div>
<div><label>معرّف روم السجلات</label><input name="logChannelId" value="${escapeHtml(settings.logChannelId)}"></div>
<div><label>مهلة إعادة التسمية بالدقائق</label><input name="renameCooldown" type="number" min="0" max="1440" value="${settings.renameCooldown}"></div>
</div>
<label>عنوان لوحة التذاكر</label><input name="panelTitle" value="${escapeHtml(settings.panelTitle)}" maxlength="200">
<label>وصف لوحة التذاكر</label><textarea name="panelDescription" maxlength="2000">${escapeHtml(settings.panelDescription)}</textarea>
<label>رابط صورة لوحة التذاكر</label><input name="panelImage" type="url" value="${escapeHtml(settings.panelImage)}">
<label>رابط صورة التذكرة</label><input name="ticketImage" type="url" value="${escapeHtml(settings.ticketImage)}">
</div>

<div class="card">
<h2>إعدادات البوت</h2>
<div class="grid">
<div><label>اسم البوت المعروض</label><input name="botName" value="${escapeHtml(settings.botName)}" maxlength="100"></div>
<div><label>رابط صورة البوت</label><input name="botAvatar" type="url" value="${escapeHtml(settings.botAvatar)}"></div>
<div><label>حالة البوت</label>
<select name="botStatus">
<option value="online" ${settings.botStatus === 'online' ? 'selected' : ''}>متصل</option>
<option value="idle" ${settings.botStatus === 'idle' ? 'selected' : ''}>خامل</option>
<option value="dnd" ${settings.botStatus === 'dnd' ? 'selected' : ''}>عدم الإزعاج</option>
<option value="invisible" ${settings.botStatus === 'invisible' ? 'selected' : ''}>غير ظاهر</option>
</select></div>
<div><label>نوع النشاط</label>
<select name="activityType">
<option value="0" ${Number(settings.activityType) === 0 ? 'selected' : ''}>يلعب</option>
<option value="1" ${Number(settings.activityType) === 1 ? 'selected' : ''}>يبث</option>
<option value="2" ${Number(settings.activityType) === 2 ? 'selected' : ''}>يستمع</option>
<option value="3" ${Number(settings.activityType) === 3 ? 'selected' : ''}>يشاهد</option>
<option value="5" ${Number(settings.activityType) === 5 ? 'selected' : ''}>يتنافس</option>
</select></div>
</div>
<label>نص النشاط</label><input name="activityText" value="${escapeHtml(settings.activityText)}" maxlength="128">
</div>

<div class="card">
<h2>النقاط</h2>
<div class="grid">
<div><label>نقاط الاستلام</label><input name="claimPoints" type="number" min="0" max="1000" value="${settings.claimPoints}"></div>
<div><label>نقاط التحذير</label><input name="warnPoints" type="number" min="0" max="1000" value="${settings.warnPoints}"></div>
<div><label>نقاط التايم</label><input name="timeoutPoints" type="number" min="0" max="1000" value="${settings.timeoutPoints}"></div>
</div>
</div>

<div class="card">
<h2>خيارات فتح التذكرة</h2>
<p>اكتب اسم الخيار ومعرّفه ورمزه ووصفه. معرّف الخيار يجب أن يكون فريداً.</p>
<div id="options"></div>
<button type="button" class="secondary" id="addOption">إضافة خيار</button>
</div>

<div class="card">
<button type="submit">حفظ جميع الإعدادات</button>
<a class="button secondary" href="/dashboard">العودة للسيرفرات</a>
</div>
</form>
</main>
<script>
const guildId = ${JSON.stringify(guildId)};
const initialOptions = ${JSON.stringify(Array.isArray(settings.selectOptions) ? settings.selectOptions : defaultOptions)};
const form = document.getElementById('settingsForm');
const statusBox = document.getElementById('status');
const optionsBox = document.getElementById('options');

function showStatus(message, ok) {
    statusBox.style.display = 'block';
    statusBox.style.background = ok ? '#174b35' : '#5a252b';
    statusBox.textContent = message;
}

function addOption(option = {}) {
    const item = document.createElement('div');
    item.className = 'option';
    item.innerHTML = \`
        <label>اسم الخيار</label><input data-key="label" maxlength="100" required>
        <label>المعرّف (بالإنجليزية)</label><input data-key="value" maxlength="100" required>
        <label>الرمز التعبيري</label><input data-key="emoji" maxlength="100">
        <label>الوصف</label><input data-key="description" maxlength="100">
        <button type="button" class="secondary remove">حذف الخيار</button>
    \`;

    for (const key of ['label', 'value', 'emoji', 'description']) {
        item.querySelector('[data-key="' + key + '"]').value = option[key] || '';
    }

    item.querySelector('.remove').addEventListener('click', () => item.remove());
    optionsBox.appendChild(item);
}

initialOptions.forEach(addOption);
document.getElementById('addOption').addEventListener('click', () => addOption());

form.addEventListener('submit', async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(form).entries());

    for (const key of ['renameCooldown', 'claimPoints', 'warnPoints', 'timeoutPoints', 'activityType']) {
        data[key] = Number(data[key]);
    }

    data.selectOptions = Array.from(optionsBox.querySelectorAll('.option')).map(item => {
        const option = {};
        item.querySelectorAll('[data-key]').forEach(input => {
            option[input.dataset.key] = input.value.trim();
        });
        return option;
    });

    try {
        const response = await fetch('/api/guilds/' + encodeURIComponent(guildId) + '/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'تعذر حفظ الإعدادات.');
        }

        showStatus('تم حفظ الإعدادات بنجاح.', true);
    } catch (error) {
        showStatus(error.message || 'حدث خطأ أثناء الحفظ.', false);
    }
});
</script>
</body>
</html>`);
    } catch (error) {
        console.error('Guild settings page error:', error.message);
        res.status(500).send('حدث خطأ أثناء تحميل إعدادات السيرفر.');
    }
});
});
                      app.get('/api/guilds/:guildId/settings', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!await isAuthorizedGuild(req, guildId)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر.' });
        }

        const settings = await GuildSettings.findOneAndUpdate(
            { guildId },
            { $setOnInsert: { guildId } },
            { upsert: true, new: true }
        );

        res.json({ settings: plainSettings(settings) });
    } catch (error) {
        console.error('Get settings error:', error.message);
        res.status(500).json({ error: 'تعذر تحميل الإعدادات.' });
    }
});

app.put('/api/guilds/:guildId/settings', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!await isAuthorizedGuild(req, guildId)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر.' });
        }

        const body = req.body || {};
        const updates = {};

        for (const key of ALLOWED_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(body, key)) {
                updates[key] = body[key];
            }
        }

        if (updates.prefix !== undefined) {
            if (typeof updates.prefix !== 'string' || updates.prefix.length < 1 || updates.prefix.length > 5) {
                return res.status(400).json({ error: 'البادئة يجب أن تكون من 1 إلى 5 أحرف.' });
            }
        }

        for (const key of ['staffRoleId', 'ticketCategoryId', 'logChannelId']) {
            if (updates[key] !== undefined && updates[key] !== '' && !validSnowflake(updates[key])) {
                return res.status(400).json({ error: `معرّف ${key} غير صحيح.` });
            }
        }

        for (const key of ['panelImage', 'ticketImage', 'botAvatar']) {
            if (updates[key] !== undefined && !validUrl(updates[key])) {
                return res.status(400).json({ error: `رابط ${key} غير صحيح.` });
            }
        }

        for (const key of ['panelTitle', 'panelDescription', 'botName', 'activityText']) {
            if (updates[key] !== undefined && typeof updates[key] !== 'string') {
                return res.status(400).json({ error: `قيمة ${key} غير صحيحة.` });
            }
        }

        const numberRules = {
            renameCooldown: [0, 1440],
            claimPoints: [0, 1000],
            warnPoints: [0, 1000],
            timeoutPoints: [0, 1000],
            activityType: [0, 5]
        };

        for (const [key, [min, max]] of Object.entries(numberRules)) {
            if (updates[key] !== undefined) {
                const value = Number(updates[key]);

                if (!Number.isInteger(value) || value < min || value > max) {
                    return res.status(400).json({ error: `قيمة ${key} خارج النطاق المسموح.` });
                }

                updates[key] = value;
            }
        }

        if (updates.botStatus !== undefined) {
            if (!['online', 'idle', 'dnd', 'invisible'].includes(updates.botStatus)) {
                return res.status(400).json({ error: 'حالة البوت غير صحيحة.' });
            }
        }

        if (updates.selectOptions !== undefined) {
            if (!Array.isArray(updates.selectOptions) || updates.selectOptions.length > 25) {
                return res.status(400).json({ error: 'عدد خيارات التذاكر يجب ألا يتجاوز 25.' });
            }

            const values = new Set();

            for (const option of updates.selectOptions) {
                if (!option || typeof option !== 'object') {
                    return res.status(400).json({ error: 'أحد خيارات التذاكر غير صحيح.' });
                }

                for (const key of ['label', 'value', 'emoji', 'description']) {
                    if (option[key] !== undefined && typeof option[key] !== 'string') {
                        return res.status(400).json({ error: `قيمة ${key} في خيارات التذاكر غير صحيحة.` });
                    }
                }

                if (!option.label?.trim() || !option.value?.trim()) {
                    return res.status(400).json({ error: 'اسم ومعرّف كل خيار مطلوبان.' });
                }

                if (option.label.length > 100 || option.value.length > 100 ||
                    (option.emoji || '').length > 100 ||
                    (option.description || '').length > 100) {
                    return res.status(400).json({ error: 'أحد خيارات التذاكر يتجاوز الحد المسموح.' });
                }

                if (values.has(option.value.trim())) {
                    return res.status(400).json({ error: 'لا يمكن تكرار معرّف الخيار.' });
                }

                values.add(option.value.trim());
            }

            updates.selectOptions = updates.selectOptions.map(option => ({
                label: option.label.trim(),
                value: option.value.trim(),
                emoji: (option.emoji || '').trim(),
                description: (option.description || '').trim()
            }));
        }

        if (updates.commandPermissions !== undefined) {
            if (!updates.commandPermissions || typeof updates.commandPermissions !== 'object' ||
                Array.isArray(updates.commandPermissions)) {
                return res.status(400).json({ error: 'إعدادات صلاحيات الأوامر غير صحيحة.' });
            }

            const permissions = {};

            for (const [command, roles] of Object.entries(updates.commandPermissions)) {
                if (!COMMANDS.includes(command) || !Array.isArray(roles)) continue;

                permissions[command] = roles
                    .filter(roleId => typeof roleId === 'string' && validSnowflake(roleId))
                    .slice(0, 25);
            }

            updates.commandPermissions = permissions;
        }

        if (updates.commandAliases !== undefined) {
            if (!updates.commandAliases || typeof updates.commandAliases !== 'object' ||
                Array.isArray(updates.commandAliases)) {
                return res.status(400).json({ error: 'إعدادات أسماء الأوامر غير صحيحة.' });
            }

            const aliases = {};

            for (const [command, names] of Object.entries(updates.commandAliases)) {
                if (!COMMANDS.includes(command) || !Array.isArray(names)) continue;

                aliases[command] = names
                    .filter(name => typeof name === 'string' && name.trim().length > 0 && name.length <= 32)
                    .map(name => name.trim())
                    .slice(0, 10);
            }

            updates.commandAliases = aliases;
        }

        const settings = await GuildSettings.findOneAndUpdate(
            { guildId },
            { $set: updates, $setOnInsert: { guildId } },
            { upsert: true, new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: 'تم حفظ الإعدادات بنجاح.',
            settings: plainSettings(settings)
        });
    } catch (error) {
        console.error('Save settings error:', error.message);
        res.status(500).json({ error: 'حدث خطأ أثناء حفظ الإعدادات.' });
    }
});
                      app.post('/api/guilds/:guildId/test-bot', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!await isAuthorizedGuild(req, guildId)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر.' });
        }

        if (!BOT_TOKEN) {
            return res.status(400).json({ error: 'توكن البوت غير مضبوط في إعدادات الاستضافة.' });
        }

        const response = await axios.get(`${API}/guilds/${guildId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            timeout: 10000
        });

        res.json({
            success: true,
            message: `اتصال البوت ناجح مع السيرفر: ${response.data.name}`
        });
    } catch (error) {
        console.error('Bot test error:', error.response?.data || error.message);

        res.status(500).json({
            error: 'فشل الاتصال بالبوت. تأكد من التوكن وأن البوت موجود داخل السيرفر.'
        });
    }
});

app.get('/api/guilds/:guildId/commands', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!await isAuthorizedGuild(req, guildId)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر.' });
        }

        const settings = await GuildSettings.findOne({ guildId });

        const aliases = settings?.commandAliases instanceof Map
            ? Object.fromEntries(settings.commandAliases)
            : settings?.commandAliases || {};

        res.json({
            commands: COMMANDS.map(command => ({
                key: command,
                name: COMMAND_NAMES[command] || command,
                aliases: aliases[command] || []
            }))
        });
    } catch (error) {
        console.error('Commands error:', error.message);
        res.status(500).json({ error: 'تعذر تحميل قائمة الأوامر.' });
    }
});

app.put('/api/guilds/:guildId/commands', requireLogin, async (req, res) => {
    try {
        const guildId = String(req.params.guildId);

        if (!validSnowflake(guildId)) {
            return res.status(400).json({ error: 'معرّف السيرفر غير صحيح.' });
        }

        if (!await isAuthorizedGuild(req, guildId)) {
            return res.status(403).json({ error: 'ليس لديك صلاحية إدارة هذا السيرفر.' });
        }

        const aliases = req.body?.commandAliases;

        if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
            return res.status(400).json({ error: 'بيانات الأوامر غير صحيحة.' });
        }

        const cleanAliases = {};

        for (const command of COMMANDS) {
            const names = aliases[command];

            if (!Array.isArray(names)) continue;

            cleanAliases[command] = names
                .filter(name =>
                    typeof name === 'string' &&
                    name.trim().length > 0 &&
                    name.length <= 32
                )
                .map(name => name.trim())
                .slice(0, 10);
        }

        const settings = await GuildSettings.findOneAndUpdate(
            { guildId },
            {
                $set: { commandAliases: cleanAliases },
                $setOnInsert: { guildId }
            },
            { upsert: true, new: true }
        );

        res.json({
            success: true,
            message: 'تم حفظ أسماء الأوامر بنجاح.',
            commandAliases: plainSettings(settings).commandAliases
        });
    } catch (error) {
        console.error('Save commands error:', error.message);
        res.status(500).json({ error: 'تعذر حفظ أسماء الأوامر.' });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        time: new Date().toISOString()
    });
});

app.use((req, res) => {
    res.status(404).send('الصفحة غير موجودة.');
});

app.use((error, req, res, next) => {
    console.error('Unhandled application error:', error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        error: 'حدث خطأ داخلي في الموقع.'
    });
});

app.listen(PORT, () => {
    console.log(`Dashboard running on port ${PORT}`);
});
