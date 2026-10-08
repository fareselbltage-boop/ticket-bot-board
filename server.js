require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// تحديد الرابط التلقائي
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://ticket-bot-board.vercel.app/api/auth/callback';

// اسم وصورة البوت الافتراضية
const BOT_NAME = process.env.BOT_NAME || 'Empire Ticket Bot';
const BOT_AVATAR = process.env.BOT_AVATAR || 'https://cdn.discordapp.com/embed/avatars/0.png';

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-empire-12345',
    resave: false,
    saveUninitialized: false
}));

app.use(express.json());

// رابط تسجيل الدخول عبر ديسكورد
app.get('/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// استقبال العودة من ديسكورد
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

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.user = userResponse.data;
        // جلب السيرفرات التي يمتلك فيها العضو صلاحية الأدمن أو إدارة السيرفر
        req.session.guilds = guildsResponse.data.filter(g => (parseInt(g.permissions) & 0x8) === 0x8 || (parseInt(g.permissions) & 0x20) === 0x20);

        res.redirect('/dashboard');
    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

// الصفحة الرئيسية المشوقة (قبل تسجيل الدخول)
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
            body {
                background: #0b0e14;
                color: #ffffff;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                position: relative;
                overflow-x: hidden;
            }
            .bg-glow {
                position: absolute;
                width: 400px;
                height: 400px;
                background: radial-gradient(circle, rgba(88,101,242,0.3) 0%, rgba(0,0,0,0) 70%);
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 0;
            }
            .card {
                background: rgba(22, 27, 34, 0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 40px 30px;
                max-width: 480px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 40px rgba(0,0,0,0.6);
                z-index: 1;
                transition: transform 0.3s ease;
            }
            .card:hover { transform: translateY(-5px); }
            .bot-avatar-wrapper {
                position: relative;
                display: inline-block;
                margin-bottom: 20px;
            }
            .bot-avatar {
                width: 100px;
                height: 100px;
                border-radius: 50%;
                border: 3px solid #5865F2;
                box-shadow: 0 0 20px rgba(88,101,242,0.5);
                object-fit: cover;
            }
            .online-badge {
                position: absolute;
                bottom: 5px;
                right: 5px;
                width: 20px;
                height: 20px;
                background-color: #23a55a;
                border: 3px solid #161b22;
                border-radius: 50%;
            }
            h1 { font-size: 26px; font-weight: 800; margin-bottom: 10px; color: #fff; }
            p { font-size: 15px; color: #949ba4; margin-bottom: 30px; line-height: 1.6; }
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
                box-shadow: 0 12px 25px rgba(88,101,242,0.6);
                transform: translateY(-2px);
            }
            .features {
                margin-top: 25px;
                display: flex;
                justify-content: space-around;
                border-top: 1px solid rgba(255,255,255,0.08);
                padding-top: 20px;
                color: #b5bac1;
                font-size: 13px;
            }
            .feature-item { display: flex; align-items: center; gap: 6px; }
        </style>
    </head>
    <body>
        <div class="bg-glow"></div>
        <div class="card">
            <div class="bot-avatar-wrapper">
                <img src="${BOT_AVATAR}" alt="Bot Avatar" class="bot-avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div class="online-badge"></div>
            </div>
            <h1>${BOT_NAME}</h1>
            <p>مرحباً بك! لإدارة واستعراض إعدادات البوت وسيرفراتك، يرجى تسجيل الدخول بحساب ديسكورد الخاص بك.</p>
            <a href="/login" class="btn-login">
                <i class="fa-brands fa-discord"></i> تسجيل الدخول بواسطة Discord
            </a>
            <div class="features">
                <div class="feature-item"><i class="fa-solid fa-bolt" style="color:#fee75c;"></i> سرعة أداء</div>
                <div class="feature-item"><i class="fa-solid fa-shield-halved" style="color:#23a55a;"></i> حماية واستقرار</div>
                <div class="feature-item"><i class="fa-solid fa-sliders" style="color:#5865f2;"></i> تحكم كامل</div>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// صفحة اللوحة (Dashboard بعد تسجيل الدخول)
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const user = req.session.user;
    const guilds = req.session.guilds;

    const userAvatar = user.avatar 
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`;

    let guildsCardsHtml = '';
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
            
            /* Navbar */
            .navbar {
                background: #161b22;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                padding: 15px 30px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }
            .user-profile { display: flex; align-items: center; gap: 12px; }
            .user-avatar { width: 45px; height: 45px; border-radius: 50%; border: 2px solid #5865f2; }
            .user-name { font-size: 16px; font-weight: 700; }
            .btn-logout {
                background: rgba(237, 66, 69, 0.15);
                color: #ed4245;
                padding: 8px 16px;
                border-radius: 8px;
                text-decoration: none;
                font-size: 14px;
                font-weight: 600;
                transition: 0.3s;
                border: 1px solid rgba(237, 66, 69, 0.3);
            }
            .btn-logout:hover { background: #ed4245; color: #fff; }

            /* Main Content */
            .container { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
            .page-title { font-size: 24px; font-weight: 800; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; }
            .page-title i { color: #5865f2; }

            /* Guilds Grid */
            .guilds-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
                gap: 20px;
            }
            .guild-card {
                background: #181e29;
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 16px;
                padding: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
                transition: all 0.3s ease;
            }
            .guild-card:hover {
                border-color: #5865f2;
                transform: translateY(-4px);
                box-shadow: 0 10px 25px rgba(88,101,242,0.2);
            }
            .guild-icon { width: 70px; height: 70px; border-radius: 20px; margin-bottom: 12px; object-fit: cover; }
            .guild-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
            .guild-id { font-size: 12px; color: #80848e; margin-bottom: 18px; }
            .btn-manage {
                width: 100%;
                background: rgba(88,101,242,0.15);
                color: #5865f2;
                border: 1px solid rgba(88,101,242,0.4);
                padding: 10px;
                border-radius: 10px;
                text-decoration: none;
                font-weight: 700;
                font-size: 14px;
                transition: 0.3s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
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
            <h2 class="page-title"><i class="fa-solid fa-server"></i> اختر السيرفر لإدارة بوت التكتات</h2>
            <div class="guilds-grid">
                ${guildsCardsHtml}
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// تسجيل الخروج
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// تصدير التطبيق لملاءمة Vercel
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
