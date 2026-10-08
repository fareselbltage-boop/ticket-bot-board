require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// تحديد الرابط التلقائي في حال لم يقرأ Vercel المتغير
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://ticket-bot-board.vercel.app/api/auth/callback';

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false
}));

app.use(express.json());

// رابط تسجيل الدخول عبر ديسكورد
app.get('/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(discordAuthUrl);
});

// استقبال العودة من ديسكورد بعد موافقة العضو
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

// صفحة اللوحة
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    let html = `<div style="font-family: Arial, sans-serif; padding: 20px;">`;
    html += `<h1>أهلاً بك ${req.session.user.username} 👋</h1>`;
    html += `<h3>السيرفرات التي تديرها وتستطيع التحكم ببوت التكتات فيها:</h3><ul>`;
    
    req.session.guilds.forEach(guild => {
        html += `<li style="margin-bottom: 10px;"><b>${guild.name}</b> (ID: ${guild.id}) - <a href="/dashboard/${guild.id}">إعدادات البوت</a></li>`;
    });
    
    html += `</ul><br><a href="/logout">تسجيل الخروج</a></div>`;
    res.send(html);
});

// تسجيل الخروج
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/', (req, res) => {
    res.send('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h1>لوحة تحكم بوت التكتات 🚀</h1><a href="/login"><button style="padding:12px 24px; font-size:16px; cursor:pointer;">تسجيل الدخول بالديسكورد</button></a></div>');
});

// تصدير التطبيق من أجل Vercel
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
