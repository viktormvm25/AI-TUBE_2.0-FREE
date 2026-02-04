const express = require('express');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
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
const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
const DIRS = [
    DATA_DIR,
    ASSETS_DIR
];

DIRS.forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

const secretPath = path.join(DATA_DIR, 'jwt_secret.txt');
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, uuidv4());

// --- 2. Database ---
const db = new sqlite3.Database(path.join(DATA_DIR, 'db.sqlite'));

// Настройка SQLite для лучшей производительности и предотвращения блокировок
db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA busy_timeout = 10000'); // 10 секунд ожидания при блокировке

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

// Async DB Wrapper
const dbAsync = {
    get: (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))),
    all: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))),
    run: (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { err ? reject(err) : resolve(this); }))
};

// --- 3. Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Cache Control Middleware for API GET requests
app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.startsWith('/api/')) {
        // Don't cache user-specific or frequently changing data
        const noCachePaths = ['/api/auth/me', '/api/channels/my', '/api/videos'];
        if (noCachePaths.some(p => req.path.startsWith(p))) {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
            res.set('Cache-Control', 'public, max-age=300'); // 5 min for other API
        }
    }
    next();
});

const s3 = new S3Client({
    region: 'ru-7',
    endpoint: 'https://s3.ru-7.storage.selcloud.ru',
    credentials: {
        accessKeyId: '5fa94fbcd4f848139b7dd9ca6b471ced',
        secretAccessKey: 'beb8abc8d744468bbb6878d104129cc3'
    },
    forcePathStyle: true
});

const S3_BUCKET = 'aitube-videos';
const S3_URL = 'https://aitube-videos.s3.ru-7.storage.selcloud.ru';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

async function uploadToS3(file, folder) {
    const filename = uuidv4() + path.extname(file.originalname);
    const key = `${folder}/${filename}`;
    await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
        // ACL removed (not supported by Selectel S3 with current setup)
    }));
    return filename;
}

const urlCache = new Map();

async function getPublicUrl(key) {
    if (!key) return null;
    if (key.startsWith('http')) return key;
    if (key.startsWith('/assets')) return key;
    if (key.startsWith('/uploads/')) key = key.replace('/uploads/', '');

    // Check cache
    if (urlCache.has(key)) {
        const { url, expires } = urlCache.get(key);
        if (Date.now() < expires) return url;
    }

    try {
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            ResponseCacheControl: 'max-age=3600' // Tell browser to cache this for 1 hour
        });
        const url = await getSignedUrl(s3, command, { expiresIn: 86400 }); // 24 hours

        // Cache for 15 minutes (to allow rotation but speed up frequent access)
        urlCache.set(key, { url, expires: Date.now() + 15 * 60 * 1000 });

        return url;
    } catch (e) {
        console.error('Sign URL Error:', e);
        return key;
    }
}

async function deleteFromS3(folder, filename) {
    if (!filename) return;
    try {
        await s3.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: `${folder}/${filename}`
        }));
    } catch (e) {
        console.error('S3 Delete Error:', e);
    }
}



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

app.get('/api/auth/me', authenticate, async (req, res) => {
    try {
        const user = await dbAsync.get('SELECT id, name, username, avatarPath, language, theme FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
        if (!user.avatarPath) user.avatarPath = '/assets/avatar-placeholder.svg';
        else user.avatarPath = await getPublicUrl(user.avatarPath);
        res.json(user);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/users/update', authenticate, upload.single('avatar'), async (req, res) => {
    const { name, password, theme } = req.body;
    if (name) {
        console.log(`[ACTION] Изменение имени пользователя: userId=${req.userId}, name=${name}`);
        db.run('UPDATE users SET name = ? WHERE id = ?', [name, req.userId]);
    }
    if (theme) {
        console.log(`[ACTION] Изменение темы: userId=${req.userId}, theme=${theme}`);
        db.run('UPDATE users SET theme = ? WHERE id = ?', [theme, req.userId]);
    }

    // Аватарка пользователя
    if (req.file) {
        console.log(`[ACTION] Загрузка аватара пользователя: userId=${req.userId}, file=${req.file.originalname}`);
        const filename = await uploadToS3(req.file, 'avatars');
        db.run('UPDATE users SET avatarPath = ? WHERE id = ?', [`avatars/${filename}`, req.userId]);
    }

    if (password) {
        console.log(`[ACTION] Изменение пароля: userId=${req.userId}`);
        const hash = await bcrypt.hash(password, 10);
        db.run('UPDATE users SET passwordHash = ? WHERE id = ?', [hash, req.userId]);
    }
    res.json({ success: true });
});

app.post('/api/auth/delete', authenticate, (req, res) => {
    const userId = req.userId;

    // 1. Get user details to find avatar
    db.get('SELECT avatarPath FROM users WHERE id = ?', [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

        // 2. Get channel details
        db.get('SELECT id, avatarPath FROM channels WHERE ownerUserId = ?', [userId], (err, channel) => {
            const filesToDelete = [];

            // Add user avatar if not placeholder -- S3 deletion handled by parsing URL or filename
            const deleteS3File = (url) => {
                if (!url) return;
                const parts = url.split('/');
                const filename = parts[parts.length - 1];
                const folder = parts[parts.length - 2];
                if (folder === 'avatars' || folder === 'videos' || folder === 'thumbnails') {
                    deleteFromS3(folder, filename);
                }
            };

            deleteS3File(user.avatarPath);

            const performFinalDeletion = () => {
                db.serialize(() => {
                    // Delete sessions, likes, comments by user
                    db.run('DELETE FROM sessions WHERE userId = ?', [userId]);
                    db.run('DELETE FROM likes WHERE userId = ?', [userId]);
                    db.run('DELETE FROM comments WHERE userId = ?', [userId]);

                    // Delete subscriptions (both directions)
                    db.run('DELETE FROM subscriptions WHERE subscriberUserId = ?', [userId]);
                    if (channel) db.run('DELETE FROM subscriptions WHERE targetChannelId = ?', [channel.id]);

                    if (channel) {
                        // Delete interactions on channel's videos
                        db.run('DELETE FROM likes WHERE videoId IN (SELECT id FROM videos WHERE ownerChannelId = ?)', [channel.id]);
                        db.run('DELETE FROM comments WHERE videoId IN (SELECT id FROM videos WHERE ownerChannelId = ?)', [channel.id]);
                        // Delete videos and channel
                        db.run('DELETE FROM videos WHERE ownerChannelId = ?', [channel.id]);
                        db.run('DELETE FROM channels WHERE id = ?', [channel.id]);
                    }

                    // Delete the user itself
                    db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
                        if (err) return res.status(500).json({ error: 'Ошибка при удалении' });

                        // Physically delete files - S3 handled above
                        res.json({ success: true });
                    });
                });
            };

            if (channel) {
                deleteS3File(channel.avatarPath);

                // Get all videos to delete their files
                db.all('SELECT filename, thumbnailPath FROM videos WHERE ownerChannelId = ?', [channel.id], (err, videos) => {
                    if (videos) {
                        videos.forEach(v => {
                            deleteFromS3('videos', v.filename);
                            deleteS3File(v.thumbnailPath);
                        });
                    }
                    performFinalDeletion();
                });
            } else {
                performFinalDeletion();
            }
        });
    });
});

app.get('/api/channels/my', authenticate, async (req, res) => {
    try {
        const ch = await dbAsync.get('SELECT * FROM channels WHERE ownerUserId = ?', [req.userId]);
        if (!ch) return res.json(null);
        if (!ch.avatarPath) ch.avatarPath = '/assets/avatar-placeholder.svg';
        else ch.avatarPath = await getPublicUrl(ch.avatarPath);

        const r = await dbAsync.get('SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?', [ch.id]);
        ch.subscribersCount = r ? r.cnt : 0;
        res.json(ch);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/channels/:id', authenticate, async (req, res) => {
    try {
        const ch = await dbAsync.get('SELECT * FROM channels WHERE id = ?', [req.params.id]);
        if (!ch) return res.status(404).json({ error: 'Канал не найден' });
        if (!ch.avatarPath) ch.avatarPath = '/assets/avatar-placeholder.svg';
        else ch.avatarPath = await getPublicUrl(ch.avatarPath);

        const r = await dbAsync.get('SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?', [ch.id]);
        ch.subscribersCount = r ? r.cnt : 0;
        const r2 = await dbAsync.get('SELECT 1 FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, ch.id]);
        ch.isSubscribed = !!r2;
        res.json(ch);
    } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/channels', authenticate, upload.single('avatar'), (req, res) => {
    const { name, tag } = req.body;
    if (!name || !tag) return res.status(400).json({ error: 'Имя и тег обязательны' });

    // First check if user already has a channel
    db.get('SELECT id FROM channels WHERE ownerUserId = ?', [req.userId], (err, existing) => {
        if (existing) {
            console.log('[DEBUG] User already has channel:', existing.id);
            return res.status(409).json({ error: 'У вас уже есть канал' });
        }

        // Check if tag is taken
        db.get('SELECT id FROM channels WHERE channelTag = ?', [tag], (err, tagExists) => {
            if (tagExists) {
                console.log('[DEBUG] Tag already taken:', tag);
                return res.status(409).json({ error: 'Тег @' + tag + ' уже занят' });
            }

            const id = uuidv4();
            db.run('INSERT INTO channels (id, ownerUserId, channelName, channelTag, avatarPath, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
                [id, req.userId, name, tag, `/assets/avatar-placeholder.svg`, Date.now()], (err) => {
                    if (err) {
                        console.error('[DEBUG] Channel creation error:', err.message);
                        return res.status(500).json({ error: 'Ошибка создания канала' });
                    }
                    console.log('[DEBUG] Channel created:', id);
                    res.json({ success: true, id });
                });
        });
    });
});

app.post('/api/channels/update', authenticate, upload.single('avatar'), async (req, res) => {
    const { name, tag } = req.body;
    db.get('SELECT * FROM channels WHERE ownerUserId = ?', [req.userId], async (err, ch) => {
        if (!ch) return res.status(404).json({ error: 'Канал не найден' });

        const updates = [];
        const params = [];
        let oldAvatarKey = ch.avatarPath; // Store old avatar key for cache invalidation

        if (name) { updates.push('channelName = ?'); params.push(name); }
        if (tag) { updates.push('channelTag = ?'); params.push(tag); }

        // Аватарка канала
        if (req.file) {
            console.log('[DEBUG] Avatar file received:', req.file.originalname);
            const filename = await uploadToS3(req.file, 'avatars');
            const newAvatarKey = `avatars/${filename}`;
            updates.push('avatarPath = ?');
            params.push(newAvatarKey);

            // Clear old avatar from URL cache
            if (oldAvatarKey && urlCache.has(oldAvatarKey)) {
                urlCache.delete(oldAvatarKey);
                console.log('[DEBUG] Cleared cache for old avatar:', oldAvatarKey);
            }
        }

        if (updates.length === 0) return res.json({ success: true });

        params.push(ch.id);

        const sql = `UPDATE channels SET ${updates.join(', ')} WHERE id = ?`;
        db.run(sql, params, function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Тег занят' });
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            console.log('[DEBUG] Channel updated successfully');
            res.json({ success: true });
        });
    });
});

app.post('/api/subscriptions/toggle', authenticate, (req, res) => {
    const { channelId } = req.body;
    if (!channelId) return res.status(400).json({ error: 'Нет channelId' });
    db.get('SELECT ownerUserId FROM channels WHERE id = ?', [channelId], (err, ch) => {
        if (!ch) return res.status(404).json({ error: 'Канал не найден' });
        if (ch.ownerUserId === req.userId) return res.status(400).json({ error: 'Нельзя подписаться на себя' });

        db.get('SELECT * FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, channelId], (err, row) => {
            if (row) {
                console.log(`[ACTION] Отписка: userId=${req.userId}, channelId=${channelId}`);
                db.run('DELETE FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?', [req.userId, channelId], () => res.json({ subscribed: false }));
            } else {
                console.log(`[ACTION] Подписка: userId=${req.userId}, channelId=${channelId}`);
                db.run('INSERT INTO subscriptions (subscriberUserId, targetChannelId, createdAt) VALUES (?, ?, ?)', [req.userId, channelId, Date.now()], () => res.json({ subscribed: true }));
            }
        });
    });
});

app.get('/api/subscriptions', authenticate, async (req, res) => {
    const sql = `SELECT c.*, (SELECT count(*) FROM subscriptions WHERE targetChannelId = c.id) as subscribersCount FROM subscriptions s JOIN channels c ON s.targetChannelId = c.id WHERE s.subscriberUserId = ?`;
    try {
        const rows = await dbAsync.all(sql, [req.userId]);
        if (rows) {
            for (const r of rows) {
                if (!r.avatarPath) r.avatarPath = '/assets/avatar-placeholder.svg';
                else r.avatarPath = await getPublicUrl(r.avatarPath);
            }
        }
        res.json(rows || []);
    } catch (e) { res.json([]); }
});



const uploadFields = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
app.post('/api/videos', authenticate, uploadFields, async (req, res) => {
    console.log('Загрузка видео началась:', { userId: req.userId, title: req.body.title });

    const { title, description, isShort, channelId } = req.body;
    if (!req.files || !req.files['video']) {
        console.log('Ошибка: видео файл не получен');
        return res.status(400).json({ error: 'Видео обязательно' });
    }

    const id = uuidv4();
    const isShortVal = (isShort === 'true' || isShort === 'on' || isShort === true) ? 1 : 0;

    // Видео
    const videoFilename = await uploadToS3(req.files['video'][0], 'videos');

    // Обложка
    let thumbnailPath = null;
    if (req.files['thumbnail']) {
        const thumbFilename = await uploadToS3(req.files['thumbnail'][0], 'thumbnails');
        thumbnailPath = `thumbnails/${thumbFilename}`;
    }

    console.log('Сохранение видео в БД:', { id, channelId, videoFilename });

    db.run('INSERT INTO videos (id, ownerChannelId, title, description, filename, thumbnailPath, isShort, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, channelId, title, description, videoFilename, thumbnailPath, isShortVal, Date.now()],
        (err) => {
            if (err) {
                console.error('Ошибка при сохранении видео:', err);
                return res.status(500).json({ error: err.message });
            }
            console.log('Видео успешно загружено:', id);
            res.json({ success: true });
        });
});

app.delete('/api/videos/:id', authenticate, (req, res) => {
    const videoId = req.params.id;
    db.get(`SELECT v.*, c.ownerUserId FROM videos v JOIN channels c ON v.ownerChannelId = c.id WHERE v.id = ?`, [videoId], (err, video) => {
        if (!video) return res.status(404).json({ error: 'Не найдено' });
        if (video.ownerUserId !== req.userId) return res.status(403).json({ error: 'Не ваше видео' });
        if (!video) return res.status(404).json({ error: 'Не найдено' });
        if (video.ownerUserId !== req.userId) return res.status(403).json({ error: 'Не ваше видео' });

        deleteFromS3('videos', video.filename);

        if (video.thumbnailPath) {
            const parts = video.thumbnailPath.split('/');
            const tName = parts[parts.length - 1];
            deleteFromS3('thumbnails', tName);
        }
        db.serialize(() => {
            db.run('DELETE FROM likes WHERE videoId = ?', [videoId]);
            db.run('DELETE FROM comments WHERE videoId = ?', [videoId]);
            db.run('DELETE FROM videos WHERE id = ?', [videoId], () => res.json({ success: true }));
        });
    });
});

app.get('/api/videos', async (req, res) => {
    const { isShort, search, channelId } = req.query;
    let sql = `SELECT v.*, c.channelName, c.channelTag, c.avatarPath as channelAvatar, c.ownerUserId, c.id as channelId FROM videos v JOIN channels c ON v.ownerChannelId = c.id`;
    const params = [], conds = [];
    if (isShort !== undefined) { conds.push('v.isShort = ?'); params.push(isShort === 'true' ? 1 : 0); }
    if (channelId) { conds.push('v.ownerChannelId = ?'); params.push(channelId); }
    if (search) { conds.push('(v.title LIKE ? OR c.channelName LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY v.createdAt DESC';

    try {
        const rows = await dbAsync.all(sql, params);
        if (rows) {
            // Process each video asynchronously
            await Promise.all(rows.map(async (r) => {
                if (!r.channelAvatar) r.channelAvatar = '/assets/avatar-placeholder.svg';
                else r.channelAvatar = await getPublicUrl(r.channelAvatar);

                // Video URL
                r.videoUrl = await getPublicUrl('videos/' + r.filename);

                // Thumbnail
                if (r.thumbnailPath) r.thumbnailPath = await getPublicUrl(r.thumbnailPath);
            }));
        }
        res.json(rows || []);
    } catch (e) {
        console.error(e);
        res.status(500).json([]);
    }
});



app.get('/api/videos/:id/details', authenticate, async (req, res) => {
    const videoId = req.params.id;
    const data = { likes: 0, userReaction: null, comments: [], isSubscribed: false, subscribersCount: 0 };

    try {
        const r = await dbAsync.get('SELECT count(*) as likes FROM likes WHERE videoId = ? AND type="like"', [videoId]);
        if (r) data.likes = r.likes;

        const r2 = await dbAsync.get('SELECT type FROM likes WHERE videoId = ? AND userId = ?', [videoId, req.userId]);
        if (r2) data.userReaction = r2.type;

        const cmts = await dbAsync.all(`SELECT c.id, c.text, c.createdAt, u.username, u.name, u.avatarPath FROM comments c JOIN users u ON c.userId = u.id WHERE c.videoId = ? ORDER BY c.createdAt DESC`, [videoId]);
        if (cmts) {
            await Promise.all(cmts.map(async (c) => {
                if (c.avatarPath) c.avatarPath = await getPublicUrl(c.avatarPath);
                else c.avatarPath = '/assets/avatar-placeholder.svg';
            }));
            data.comments = cmts;
        }

        const vRow = await dbAsync.get(`SELECT ownerChannelId FROM videos WHERE id = ?`, [videoId]);
        if (vRow) {
            const chId = vRow.ownerChannelId;
            const r3 = await dbAsync.get(`SELECT count(*) as cnt FROM subscriptions WHERE targetChannelId = ?`, [chId]);
            data.subscribersCount = r3 ? r3.cnt : 0;
            const r4 = await dbAsync.get(`SELECT 1 FROM subscriptions WHERE subscriberUserId = ? AND targetChannelId = ?`, [req.userId, chId]);
            data.isSubscribed = !!r4;
        }
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json(data);
    }
});

app.post('/api/interact/like', authenticate, (req, res) => {
    const { videoId, type } = req.body;
    console.log(`[ACTION] Лайк/Дизлайк: userId=${req.userId}, videoId=${videoId}, type=${type}`);
    db.run('DELETE FROM likes WHERE userId = ? AND videoId = ?', [req.userId, videoId], () => {
        if (type !== 'none') db.run('INSERT INTO likes (userId, videoId, type) VALUES (?, ?, ?)', [req.userId, videoId, type]);
        res.json({ success: true });
    });
});

app.post('/api/interact/comment', authenticate, (req, res) => {
    const { videoId, text } = req.body;
    if (!videoId || !text) return res.status(400).json({ error: 'Нет данных' });
    console.log(`[ACTION] Новый комментарий: userId=${req.userId}, videoId=${videoId}, text="${String(text).trim().substring(0, 50)}..."`);
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

// Cleanup orphan videos (videos with missing S3 files)
async function cleanupOrphanVideos() {
    console.log('Starting orphan video cleanup...');
    try {
        const videos = await dbAsync.all('SELECT id, filename FROM videos');
        if (!videos) return;

        for (const v of videos) {
            try {
                // Try to get the object - if it fails, delete from DB
                await s3.send(new HeadObjectCommand({
                    Bucket: S3_BUCKET,
                    Key: 'videos/' + v.filename
                }));
            } catch (err) {
                if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
                    console.log('Deleting orphan video:', v.id);
                    db.serialize(() => {
                        db.run('DELETE FROM likes WHERE videoId = ?', [v.id]);
                        db.run('DELETE FROM comments WHERE videoId = ?', [v.id]);
                        db.run('DELETE FROM videos WHERE id = ?', [v.id]);
                    });
                }
            }
        }
        console.log('Orphan cleanup complete');
    } catch (e) {
        console.error('Cleanup error:', e);
    }
}

// Import HeadObjectCommand for checking if object exists
const { HeadObjectCommand } = require('@aws-sdk/client-s3');

app.listen(3000, '127.0.0.1', () => {
    console.log('Server running on port 3000');
    // Run cleanup on startup
    cleanupOrphanVideos();
});