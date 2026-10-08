require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const REDIRECT_URI = process.env.REDIRECT_URI || 'https://ticket-bot-board.vercel.app/api/auth/callback';
const MONGO_URI = process.env.MONGO_URI;

const BOT_NAME = process.env.BOT_NAME || 'Empire Ticket Bot';
const BOT_AVATAR = process.env.BOT_AVATAR || 'https://i.postimg.cc/8P2L5vX4/1000020307.jpg';

// السماح بالعمل عبر Proxy الخاص بـ Vercel لضمان استقرار وتأكيد الـ Cookies
app.set('trust proxy', 1);

// إعداد الجلسة وحفظها مستمرة في MongoDB لمدة 30 يوم
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-empire-12345',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI || 'mongodb://localhost:27017/ticketbot',
        ttl: 30 * 24 * 60 * 60 // صلاحية الجلسة: 30 يوم
    }),
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 يوم بالمللي ثانية
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
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
        req.session.guilds = guildsResponse.data.filter(g => (parseInt(g.permissions) & 0x8) === 0x8 || (parseInt(g.permissions) & 0x20) === 0x20);

        res.redirect('/dashboard');
    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.send('حدث خطأ أثناء تسجيل الدخول.');
    }
});

// الصفحة الرئيسية (تحويل تلقائي إلى Dashboard إذا كان مسجلاً)
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
                <img src="${BOT_AVATAR}" alt="Bot Avatar" class="bot-avatar">
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

// صفحة اللوحة الرئيسية (عرض السيرفرات)
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
            .container { max-width: 1100px; margin: 40px auto; padding: 0 20px; }
            .page-title { font-size: 24px; font-weight: 800; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; }
            .page-title i { color: #5865f2; }
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

// صفحة الإعدادات الشاملة للسيرفر
app.get('/dashboard/:guildId', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const guildId = req.params.guildId;
    const guild = req.session.guilds.find(g => g.id === guildId);

    if (!guild) {
        return res.send('لا تملك صلاحيات لإدارة هذا السيرفر أو أن السيرفر غير موجود.');
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
            
            .navbar {
                background: #161b22;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                padding: 15px 30px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .btn-back {
                color: #5865f2;
                text-decoration: none;
                font-weight: 700;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }

            .main-layout {
                display: flex;
                flex: 1;
                max-width: 1200px;
                width: 100%;
                margin: 30px auto;
                gap: 25px;
                padding: 0 20px;
            }

            /* Sidebar Tabs */
            .sidebar {
                width: 270px;
                background: #181e29;
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 16px;
                padding: 15px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                height: fit-content;
            }
            .tab-btn {
                background: transparent;
                border: none;
                color: #949ba4;
                padding: 12px 16px;
                border-radius: 10px;
                cursor: pointer;
                text-align: right;
                font-size: 15px;
                font-weight: 700;
                display: flex;
                align-items: center;
                gap: 12px;
                transition: all 0.3s ease;
            }
            .tab-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .tab-btn.active { background: #5865f2; color: #fff; }

            /* Content Panel */
            .content-panel {
                flex: 1;
                background: #181e29;
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 16px;
                padding: 30px;
            }
            .tab-content { display: none; }
            .tab-content.active { display: block; }

            h2 { font-size: 20px; font-weight: 800; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; display: flex; align-items: center; gap: 10px; }
            
            .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
            .form-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: 600; color: #b5bac1; font-size: 14px; }
            input, select, textarea {
                width: 100%;
                padding: 12px;
                background: #0b0e14;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px;
                color: #fff;
                font-size: 14px;
                outline: none;
            }
            input:focus, select:focus, textarea:focus { border-color: #5865f2; }

            .btn-save {
                background: #5865f2;
                color: #fff;
                border: none;
                padding: 12px 28px;
                border-radius: 8px;
                font-weight: 700;
                cursor: pointer;
                transition: 0.3s;
                margin-top: 10px;
            }
            .btn-save:hover { background: #4752c4; }

            .cmd-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
            .cmd-item { background: #0b0e14; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; }
            .cmd-name { font-weight: 700; color: #5865f2; }
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
                    <form>
                        <div class="form-grid">
                            <div class="form-group">
                                <label>رتبة الإدارة الرئيسية (STAFF_ROLE_ID):</label>
                                <input type="text" value="1555478928708337775" placeholder="أدخل ID الرتبة">
                            </div>
                            <div class="form-group">
                                <label>كاتيجوري التكتات (TICKET_CATEGORY_ID):</label>
                                <input type="text" value="1555176022352208012" placeholder="أدخل ID الكاتيجوري">
                            </div>
                            <div class="form-group">
                                <label>روم السجلات (LOG_CHANNEL_ID):</label>
                                <input type="text" value="1555488444182962216" placeholder="أدخل ID الروم">
                            </div>
                        </div>
                        <button type="button" class="btn-save" onclick="saveAlert()"><i class="fa-solid fa-floppy-disk"></i> حفظ التغييرات</button>
                    </form>
                </div>

                <!-- Tab 2: Panel & Ticket Design -->
                <div id="design" class="tab-content">
                    <h2><i class="fa-solid fa-palette" style="color:#fee75c;"></i> تخصيص نصوص وصور البانل والتكت</h2>
                    <form>
                        <div class="form-group">
                            <label>رابط صورة البانل الخارجي (PANEL_IMAGE):</label>
                            <input type="text" value="https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg">
                        </div>
                        <div class="form-group">
                            <label>رابط صورة التكت الداخلي (TICKET_IMAGE):</label>
                            <input type="text" value="https://i.postimg.cc/j5x6JgQH/Untitled900-20260927182744.jpg">
                        </div>
                        <div class="form-group">
                            <label>عنوان رسالة البانل (-panel):</label>
                            <input type="text" value="🎫 LIGHT Support | الدعم الفني">
                        </div>
                        <div class="form-group">
                            <label>نص رسالة البانل الخارجي:</label>
                            <textarea rows="3">مرحباً بك في نظام الدعم الفني الخاص بسيرفر LIGHT.\n\nاضغط على الزر بالأسفل لفتح تذكرة وتواصل مع فريق الدعم.</textarea>
                        </div>
                        <button type="button" class="btn-save" onclick="saveAlert()"><i class="fa-solid fa-floppy-disk"></i> حفظ التصميم</button>
                    </form>
                </div>

                <!-- Tab 3: Select Menu Categories -->
                <div id="categories" class="tab-content">
                    <h2><i class="fa-solid fa-list-check" style="color:#23a55a;"></i> تخصيص خيارات قائمة فتح التكتات</h2>
                    <form>
                        <div class="form-group">
                            <label>الخيار الأول (استفسار):</label>
                            <input type="text" value="❓ | استفسار">
                        </div>
                        <div class="form-group">
                            <label>الخيار الثاني (شكوى):</label>
                            <input type="text" value="⚠️ | شكوى">
                        </div>
                        <div class="form-group">
                            <label>الخيار الثالث (مشكلة تقنية):</label>
                            <input type="text" value="🛠 | مشكلة تقنية">
                        </div>
                        <button type="button" class="btn-save" onclick="saveAlert()"><i class="fa-solid fa-floppy-disk"></i> حفظ الأقسام</button>
                    </form>
                </div>

                <!-- Tab 4: Command Permissions -->
                <div id="permissions" class="tab-content">
                    <h2><i class="fa-solid fa-user-shield" style="color:#eb459e;"></i> الأوامر المدارة وصلاحياتها (-set)</h2>
                    <p style="color:#949ba4; font-size:13px; margin-bottom:15px;">قائمة الأوامر التي يمكنك إدارة صلاحياتها مباشرة للرتب بالموقع:</p>
                    <div class="cmd-list">
                        <div class="cmd-item"><span class="cmd-name">-add</span><span>إضافة عضو</span></div>
                        <div class="cmd-item"><span class="cmd-name">-come</span><span>منشن عضو</span></div>
                        <div class="cmd-item"><span class="cmd-name">-rename</span><span>تغيير الاسم</span></div>
                        <div class="cmd-item"><span class="cmd-name">-استلام</span><span>توثيق ونقاط</span></div>
                        <div class="cmd-item"><span class="cmd-name">-تايم</span><span>تايم أوت</span></div>
                        <div class="cmd-item"><span class="cmd-name">-تحذير</span><span>تحذير للعضو</span></div>
                        <div class="cmd-item"><span class="cmd-name">-اغلاق</span><span>إغلاق التكت</span></div>
                        <div class="cmd-item"><span class="cmd-name">-حذف</span><span>حذف التكت</span></div>
                        <div class="cmd-item"><span class="cmd-name">-addpoints</span><span>إضافة نقاط</span></div>
                        <div class="cmd-item"><span class="cmd-name">-removepoints</span><span>خصم نقاط</span></div>
                    </div>
                </div>

                <!-- Tab 5: Points & Settings -->
                <div id="points" class="tab-content">
                    <h2><i class="fa-solid fa-trophy" style="color:#f1c40f;"></i> إعدادات النقاط والمهل الزمنية</h2>
                    <form>
                        <div class="form-grid">
                            <div class="form-group">
                                <label>عدد النقاط الممنوحة عند الاستلام/التحذير/التايم:</label>
                                <input type="number" value="1">
                            </div>
                            <div class="form-group">
                                <label>مهلة تغيير اسم التكت (-rename Cooldown بالدقائق):</label>
                                <input type="number" value="10">
                            </div>
                        </div>
                        <button type="button" class="btn-save" onclick="saveAlert()"><i class="fa-solid fa-floppy-disk"></i> حفظ إعدادات النقاط</button>
                    </form>
                </div>

            </div>
        </div>

        <script>
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

            function saveAlert() {
                alert('تم التجهيز بنجاح! سنربط حفظ هذه الإعدادات الآن بقاعدة البيانات MongoDB لتقوم بتنفيذها وتحديث البوت فوراً.');
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// تسجيل الخروج (يمسح الجلسة تماماً)
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
