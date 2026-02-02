const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// === SSL/HTTPS Configuration ===
const SSL_KEY_PATH = path.join(__dirname, 'ssl', 'privkey.pem');
const SSL_CERT_PATH = path.join(__dirname, 'ssl', 'fullchain.pem');
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

// --- 1. Init Dirs ---
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
const DIRS = [
    DATA_DIR,
    UPLOADS_DIR,
    path.join(UPLOADS_DIR, 'avatars'),
    path.join(UPLOADS_DIR, 'videos'),
    path.join(UPLOADS_DIR, 'thumbnails'),
    ASSETS_DIR
];

DIRS.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

const secretPath = path.join(DATA_DIR, 'jwt_secret.txt');
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, uuidv4());

// --- 2. Database ---
const db = new sqlite3.Database(path.join(DATA_DIR, 'db.sqlite'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, username TEXT UNIQUE, passwordHash TEXT, avatarPath TEXT, language TEXT DEFAULT 'RU', theme TEXT DEFAULT 'neon-blue', createdAt INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT, createdAt INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, ownerUserId TEXT, channelName TEXT, channelTag TEXT UNIQUE, avatarPath TEXT, createdAt INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, ownerChannelId TEXT, title TEXT, description TEXT, filename TEXT, thumbnailPath TEXT, isShort INTEGER, views INTEGER DEFAULT 0, createdAt INTEGER)`);
    db.all("PRAGMA table_info(videos)", (err, cols) => { if (!cols.some(c => c.name === 'thumbnailPath')) db.run("ALTER TABLE videos ADD COLUMN thumbnailPath TEXT"); });
    db.all("PRAGMA table_info(users)", (err, cols) => { if (!cols.some(c => c.name === 'theme')) db.run("ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'neon-blue'"); });
    db.run(`CREATE TABLE IF NOT EXISTS likes (userId TEXT, videoId TEXT, type TEXT, PRIMARY KEY (userId, videoId))`);
    db.run(`CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, videoId TEXT, userId TEXT, text TEXT, createdAt INTEGER)`);
    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (subscriberUserId TEXT, targetChannelId TEXT, createdAt INTEGER, PRIMARY KEY (subscriberUserId, targetChannelId))`);
});

// --- 3. Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'video') cb(null, path.join(UPLOADS_DIR, 'videos'));
        else if (file.fieldname === 'thumbnail') cb(null, path.join(UPLOADS_DIR, 'thumbnails'));
        else if (file.fieldname === 'avatar') cb(null, path.join(UPLOADS_DIR, 'avatars'));
    },
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, true) });

const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Недействительный токен' });
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    db.get('SELECT userId FROM sessions WHERE token = ?', [token], (err, row) => {
        if (err || !row) return res.status(401).json({ error: 'Недействительный токен' });
        req.userId = row.userId;
        next();
    });
};

// --- Routes ---
app.post('/api/auth/register', async (req, res) => {
    const { name, username, password } = req.body;
    const n = String(name || '').trim();
    const u = String(username || '').trim();
    const p = String(password || '').trim();

    if (!n || !u || !p) return res.status(400).json({ error: 'Заполните все поля' });
    try {
        const hash = await bcrypt.hash(p, 10);
        const id = uuidv4();
        const avatarPath = '/assets/avatar-placeholder.svg';
        db.run('INSERT INTO users (id, name, username, passwordHash, avatarPath, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, n, u, hash, avatarPath, Date.now()], function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Логин занят' });
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                const token = uuidv4();
                db.run('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, id, Date.now()], () => {
                    res.json({ success: true, token, user: { id, name: n, username: u, avatarPath, theme: 'neon-blue' } });
                });
            });
    } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const u = String(username || '').trim();
    const p = String(password || '').trim();

    if (!u || !p) return res.status(400).json({ error: 'Заполните логин и пароль' });

    db.get('SELECT * FROM users WHERE username = ?', [u], async (err, user) => {
        if (!user) return res.status(401).json({ error: 'Неверные данные' });
        const match = await bcrypt.compare(p, user.passwordHash);
        if (!match) return res.status(401).json({ error: 'Неверные данные' });
        const token = uuidv4();
        db.run('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, user.id, Date.now()], () => {
            res.json({
                success: true, token, user: {
                    id: user.id, name: user.name, username: user.username,
                    avatarPath: user.avatarPath || '/assets/avatar-placeholder.svg', theme: user.theme
                }
            });
        });
    });
});

app.get('/api/auth/me', authenticate, (req, res) => {
    db.get('SELECT id, name, username, avatarPath, language, theme FROM users WHERE id = ?', [req.userId], (err, user) => {
        if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
        if (!user.avatarPath) user.avatarPath = '/assets/avatar-placeholder.svg';
        res.json(user);
    });
});

app.post('/api/users/update', authenticate, upload.single('avatar'), async (req, res) => {
    const { name, password, theme } = req.body;
    if (name) db.run('UPDATE users SET name = ? WHERE id = ?', [name, req.userId]);
    if (theme) db.run('UPDATE users SET theme = ? WHERE id = ?', [theme, req.userId]);
    if (req.file) db.run('UPDATE users SET avatarPath = ? WHERE id = ?', [`/uploads/avatars/${req.file.filename}`, req.userId]);
    if (password) {
        const hash = await bcrypt.hash(password, 10);
        db.run('UPDATE users SET passwordHash = ? WHERE id = ?', [hash, req.userId]);
    }
    res.json({ success: true });
});

app.post('/api/auth/delete', authenticate, (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.userId]);
    db.run('DELETE FROM sessions WHERE userId = ?', [req.userId]);
    res.json({ success: true });
});

app.get('/api/channels/my', authenticate, (req, res) => {
    db.get('SELECT * FROM channels WHERE ownerUserId = ?', [req.userId], (err, ch) => {
        if (!ch) return res.json(null);
        if (!ch.avatarPath) ch.avatarPath = '/assets/avatar-placeholder.svg';
        db.get('SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?', [ch.id], (e, r) => {
            ch.subscribersCount = r ? r.cnt : 0;
            res.json(ch);
        });
    });
});

app.get('/api/channels/:id', authenticate, (req, res) => {
    db.get('SELECT * FROM channels WHERE id = ?', [req.params.id], (err, ch) => {
        if (!ch) return res.status(404).json({ error: 'Канал не найден' });
        if (!ch.avatarPath) ch.avatarPath = '/assets/avatar-placeholder.svg';
        db.get('SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?', [ch.id], (e, r) => {
            ch.subscribersCount = r ? r.cnt : 0;
            db.get('SELECT 1 FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, ch.id], (e2, r2) => {
                ch.isSubscribed = !!r2;
                res.json(ch);
            });
        });
    });
});

app.post('/api/channels', authenticate, upload.single('avatar'), (req, res) => {
    const { name, tag } = req.body;
    const id = uuidv4();
    db.run('INSERT INTO channels (id, ownerUserId, channelName, channelTag, avatarPath, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [id, req.userId, name, tag, '/assets/avatar-placeholder.svg', Date.now()], (err) => {
            if (err) return res.status(409).json({ error: 'Тег занят' });
            res.json({ success: true, id });
        });
});

app.post('/api/subscriptions/toggle', authenticate, (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'Нет channelId' });
    db.get('SELECT * FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, channelId], (err, row) => {
        if (row) {
            db.run('DELETE FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, channelId], () => res.json({ subscribed: false }));
        } else {
            db.run('INSERT INTO subscriptions (subscriberUserId, targetChannelId, createdAt) VALUES (?, ?, ?)', [req.userId, channelId, Date.now()], () => res.json({ subscribed: true }));
        }
    });
});

app.get('/api/subscriptions', authenticate, (req, res) => {
    const sql = `SELECT c.*, (SELECT count(*) FROM subscriptions WHERE targetChannelId = c.id) as subscribersCount FROM subscriptions s JOIN channels c ON s.targetChannelId = c.id WHERE s.subscriberUserId = ?`;
    db.all(sql, [req.userId], (err, rows) => {
        if (rows) rows.forEach(r => { if (!r.avatarPath) r.avatarPath = '/assets/avatar-placeholder.svg'; });
        res.json(rows || []);
    });
});

const uploadFields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
app.post('/api/videos', authenticate, uploadFields, (req, res) => {
    const { title, description, isShort, channelId } = req.body;
    if (!req.files || !req.files['video']) return res.status(400).json({ error: 'Видео обязательно' });
    const id = uuidv4();
    const isShortVal = (isShort === 'true' || isShort === 'on' || isShort === true) ? 1 : 0;
    const videoFile = req.files['video'][0].filename;
    const thumbnailPath = req.files['thumbnail'] ? `/uploads/thumbnails/${req.files['thumbnail'][0].filename}` : null;

    db.run('INSERT INTO videos (id, ownerChannelId, title, description, filename, thumbnailPath, isShort, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, channelId, title, description, videoFile, thumbnailPath, isShortVal, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.delete('/api/videos/:id', authenticate, (req, res) => {
    const videoId = req.params.id;
    db.get(`SELECT v.*, c.ownerUserId FROM videos v JOIN channels c ON v.ownerChannelId = c.id WHERE v.id = ?`, [videoId], (err, video) => {
        if (!video) return res.status(404).json({ error: 'Не найдено' });
        if (video.ownerUserId !== req.userId) return res.status(403).json({ error: 'Не ваше видео' });
        if (fs.existsSync(path.join(UPLOADS_DIR, 'videos', video.filename))) fs.unlinkSync(path.join(UPLOADS_DIR, 'videos', video.filename));
        if (video.thumbnailPath) {
            const tPath = path.join(UPLOADS_DIR, 'thumbnails', path.basename(video.thumbnailPath));
            if (fs.existsSync(tPath)) fs.unlinkSync(tPath);
        }
        db.serialize(() => {
            db.run('DELETE FROM likes WHERE videoId = ?', [videoId]);
            db.run('DELETE FROM comments WHERE videoId = ?', [videoId]);
            db.run('DELETE FROM videos WHERE id = ?', [videoId], () => res.json({ success: true }));
        });
    });
});

app.get('/api/videos', (req, res) => {
    const { isShort, search, channelId } = req.query;
    let sql = `SELECT v.*, c.channelName, c.channelTag, c.avatarPath as channelAvatar, c.ownerUserId, c.id as channelId FROM videos v JOIN channels c ON v.ownerChannelId = c.id`;
    const params = [], conds = [];
    if (isShort !== undefined) { conds.push('v.isShort = ?'); params.push(isShort === 'true' ? 1 : 0); }
    if (channelId) { conds.push('v.ownerChannelId = ?'); params.push(channelId); }
    if (search) { conds.push('(v.title LIKE ? OR c.channelName LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY v.createdAt DESC';
    db.all(sql, params, (err, rows) => {
        if (rows) rows.forEach(r => { if (!r.channelAvatar) r.channelAvatar = '/assets/avatar-placeholder.svg'; });
        res.json(rows || []);
    });
});

app.get('/api/stream/:filename', (req, res) => {
    const p = path.join(UPLOADS_DIR, 'videos', req.params.filename);
    if (!fs.existsSync(p)) return res.status(404).end();
    const stat = fs.statSync(p);
    const fileSize = stat.size;
    const range = req.headers.range;
    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(p, { start, end });
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': 'video/mp4' });
        file.pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
        fs.createReadStream(p).pipe(res);
    }
});

app.get('/api/videos/:id/details', authenticate, (req, res) => {
    const videoId = req.params.id;
    const data = { likes: 0, userReaction: null, comments: [], isSubscribed: false, subscribersCount: 0 };
    db.get('SELECT count(*) as likes FROM likes WHERE videoId = ? AND type="like"', [videoId], (err, r) => {
        if (r) data.likes = r.likes;
        db.get('SELECT type FROM likes WHERE videoId = ? AND userId = ?', [videoId, req.userId], (err, r2) => {
            if (r2) data.userReaction = r2.type;
            db.all(`SELECT c.id, c.text, c.createdAt, u.username, u.name FROM comments c JOIN users u ON c.userId = u.id WHERE c.videoId = ? ORDER BY c.createdAt DESC`, [videoId], (err, cmts) => {
                data.comments = cmts || [];
                db.get(`SELECT ownerChannelId FROM videos WHERE id = ?`, [videoId], (e, vRow) => {
                    if (vRow) {
                        const chId = vRow.ownerChannelId;
                        db.get(`SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?`, [chId], (e3, r3) => {
                            data.subscribersCount = r3 ? r3.cnt : 0;
                            db.get(`SELECT 1 FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?`, [req.userId, chId], (e4, r4) => {
                                data.isSubscribed = !!r4;
                                res.json(data);
                            });
                        });
                    } else { res.json(data); }
                });
            });
        });
    });
});

app.post('/api/interact/like', authenticate, (req, res) => {
    const { videoId, type } = req.body;
    db.run('DELETE FROM likes WHERE userId = ? AND videoId = ?', [req.userId, videoId], () => {
        if (type !== 'none') db.run('INSERT INTO likes (userId, videoId, type) VALUES (?, ?, ?)', [req.userId, videoId, type]);
        res.json({ success: true });
    });
});

app.post('/api/interact/comment', authenticate, (req, res) => {
    const { videoId, text } = req.body;
    if (!videoId || !text) return res.status(400).json({ error: 'Нет данных' });
    db.run('INSERT INTO comments (id, videoId, userId, text, createdAt) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), videoId, req.userId, String(text).trim(), Date.now()], (err) => {
            if (err) return res.status(500).json({ error: 'Ошибка' });
            res.json({ success: true });
        });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Ошибка загрузки файла' });
    res.status(500).json({ error: err.message });
});

app.listen(8080, '0.0.0.0', () => console.log('Server running on port 8080'));

// === HTTPS/HTTP Server Startup ===
// Создайте папку 'ssl' и положите туда файлы:
// - private.key (приватный ключ)
// - certificate.crt (сертификат)
// 
// Для создания самоподписанного сертификата (для тестирования):
// openssl req -x509 -newkey rsa:4096 -keyout ssl/privkey.pem -out ssl/fullchain.pem -days 365 -nodes
//
// Для production используйте Let's Encrypt (certbot)

const sslDir = path.join(__dirname, 'ssl');
if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
}

function startServer() {
    // Проверяем наличие SSL сертификатов
    if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        try {
            const sslOptions = {
                key: fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH)
            };

            // Запуск HTTPS сервера на порту 443
            https.createServer(sslOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
                console.log(`🔒 HTTPS Server running on https://localhost:${HTTPS_PORT}`);
            });

        } catch (e) {
            console.error('❌ Ошибка SSL сертификатов:', e.message);
            startHttpFallback();
        }
    } else {
        console.log('⚠️  SSL сертификаты не найдены в папке ssl/');
        startHttpFallback();
    }
}

function startHttpFallback() {
    // Запуск HTTP сервера на порту 80
    http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
        console.log(`🌐 HTTP Server running on http://localhost:${HTTP_PORT}`);
    });
}

// Запуск сервера
startServer();