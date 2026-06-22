const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || ROOT;
const DATA_DIR = process.env.DATA_DIR || path.join(PERSISTENT_DIR, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PERSISTENT_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const SECRET_PATH = path.join(DATA_DIR, 'session-secret.txt');
const MAX_USERS = 3;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_PATH)) return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret);
  return secret;
}

function defaultData() {
  return {
    nextIds: { users: 1, photos: 1, comments: 1, timeline: 1, letters: 1, music: 1, guestbook: 1, goals: 1 },
    users: [],
    settings: {
      relationship_start_date: '2021-02-14T20:30',
      hero_quote: 'In every quiet second, our story keeps choosing us again.',
      footer_quote: 'A love kept private can still light an entire sky.',
      daily_messages: [
        'Today, love arrives quietly and still fills the whole room.',
        'Every ordinary hour becomes ceremonial when it belongs to us.',
        'The moon kept a seat for our story tonight.',
        'I would find you in every garden, under every sky.',
        'Some promises do not need volume; they glow.'
      ]
    },
    photos: [],
    photoLikes: [],
    comments: [],
    timeline: [
      { id: 1, title: 'First Meeting', eventDate: '2021-02-14', description: 'A glance across a crowded evening that made the room feel suddenly quiet.', sortOrder: 1 },
      { id: 2, title: 'First Conversation', eventDate: '2021-02-20', description: 'Hours vanished into laughter, secrets, and the first hint of forever.', sortOrder: 2 },
      { id: 3, title: 'First Date', eventDate: '2021-03-12', description: 'Warm lights, rose petals, and hands that almost touched before they did.', sortOrder: 3 },
      { id: 4, title: 'Special Memories', eventDate: 'Every season', description: 'Letters, photos, music, and ordinary days turned into keepsakes.', sortOrder: 4 },
      { id: 5, title: 'Future Dreams', eventDate: 'Tomorrow', description: 'A home full of music, travel, celebrations, and soft morning rituals.', sortOrder: 5 }
    ],
    letters: [{ id: 1, title: 'My favorite chapter', body: 'Thank you for making ordinary days feel handwritten in gold.', createdAt: new Date().toISOString() }],
    music: [],
    guestbook: [],
    goals: [
      { id: 1, title: 'Save for the rose-garden trip', progress: 72 },
      { id: 2, title: 'Create our anniversary album', progress: 45 },
      { id: 3, title: 'Write one hundred tiny letters', progress: 88 }
    ]
  };
}

let db = loadDatabase();
seedDatabase();

function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) return defaultData();
  return { ...defaultData(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
}

function saveDatabase() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function seedDatabase() {
  db.nextIds = { ...defaultData().nextIds, ...(db.nextIds || {}) };
  db.nextIds.timeline = Math.max(db.nextIds.timeline || 1, ...db.timeline.map((item) => item.id + 1), 6);
  db.nextIds.letters = Math.max(db.nextIds.letters || 1, ...db.letters.map((item) => item.id + 1), 2);
  db.nextIds.goals = Math.max(db.nextIds.goals || 1, ...db.goals.map((item) => item.id + 1), 4);
  if (!db.users.length) {
    db.users.push({
      id: nextId('users'),
      name: process.env.ADMIN_NAME || 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@local.user',
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || '123456', 12),
      role: 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  migrateArabicDefaults();
  saveDatabase();
}

function migrateArabicDefaults() {
  const oldHero = 'In every quiet second, our story keeps choosing us again.';
  const oldFooter = 'A love kept private can still light an entire sky.';
  const oldAdmin = db.users.find((user) => user.role === 'admin' && user.name === 'Admin Owner' && user.email === 'admin@moonlit.local');
  if (oldAdmin) {
    oldAdmin.name = 'admin';
    if (bcrypt.compareSync('ChangeMe123!', oldAdmin.passwordHash)) oldAdmin.passwordHash = bcrypt.hashSync('123456', 12);
  }
  if (db.settings.hero_quote === oldHero) db.settings.hero_quote = 'في كل ثانية هادئة، تختارنا حكايتنا من جديد.';
  if (db.settings.footer_quote === oldFooter) db.settings.footer_quote = 'الحب الذي نحفظه بيننا قادر أن يضيء سماء كاملة.';
  if (db.settings.daily_messages?.includes('Today, love arrives quietly and still fills the whole room.')) {
    db.settings.daily_messages = [
      'اليوم يأتي الحب بهدوء، لكنه يملأ المكان كله.',
      'كل ساعة عادية تصبح ذكرى جميلة عندما تكون لنا.',
      'القمر يحتفظ الليلة بمكان خاص لحكايتنا.',
      'سأجدك في كل حديقة وتحت كل سماء.',
      'بعض الوعود لا تحتاج صوتاً عالياً، يكفي أنها تضيء.'
    ];
  }
}

function nextId(key) {
  const value = db.nextIds[key] || 1;
  db.nextIds[key] = value + 1;
  return value;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role, createdAt: user.createdAt };
}

function findUser(id) {
  return db.users.find((user) => user.id === Number(id));
}

function requireAuth(req, res, next) {
  const user = findUser(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

function assertText(value, label, max = 4000) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

function sendError(res, error, status = 400) {
  res.status(status).json({ error: error.message || String(error) });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new FileStore({ path: path.join(DATA_DIR, 'sessions'), retries: 1, logFn: () => {} }),
  secret: getSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 1000 * 60 * 60 * 24 * 14 }
}));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(ROOT));

app.get('/api/auth/me', (req, res) => {
  res.json({ user: publicUser(findUser(req.session.userId)), maxUsers: MAX_USERS, userCount: db.users.length });
});

app.post('/api/auth/login', (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase();
  const user = db.users.find((item) => item.name.toLowerCase() === name);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'الاسم أو كلمة المرور غير صحيحة.' });
  req.session.regenerate((error) => {
    if (error) return sendError(res, error, 500);
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.currentPassword || ''), req.user.passwordHash)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length !== 6) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 حروف بالضبط.' });
  req.user.passwordHash = bcrypt.hashSync(newPassword, 12);
  req.user.updatedAt = new Date().toISOString();
  saveDatabase();
  res.json({ ok: true });
});

app.get('/api/settings', requireAuth, (_req, res) => res.json(db.settings));
app.put('/api/settings', requireAuth, requireAdmin, (req, res) => {
  try {
    db.settings = {
      relationship_start_date: assertText(req.body.relationship_start_date, 'Relationship start date', 80),
      hero_quote: assertText(req.body.hero_quote, 'Hero quote', 500),
      footer_quote: assertText(req.body.footer_quote, 'Footer quote', 500),
      daily_messages: String(req.body.daily_messages || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 50)
    };
    saveDatabase();
    res.json(db.settings);
  } catch (error) { sendError(res, error); }
});

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => res.json({ users: db.users.map(publicUser), maxUsers: MAX_USERS }));
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  try {
    if (db.users.length >= MAX_USERS) return res.status(400).json({ error: 'هذا الموقع الخاص يسمح بثلاثة حسابات فقط.' });
    const name = assertText(req.body.name, 'الاسم', 120);
    if (db.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'هذا الاسم مستخدم بالفعل.' });
    const password = String(req.body.password || '');
    if (password.length !== 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 حروف بالضبط.' });
    const user = { id: nextId('users'), name, email: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@local.user`, passwordHash: bcrypt.hashSync(password, 12), role: 'user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.users.push(user);
    saveDatabase();
    res.status(201).json({ user: publicUser(user) });
  } catch (error) { sendError(res, error); }
});
app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const user = findUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.role === 'admin' && user.id !== req.user.id) return res.status(400).json({ error: 'Admin owner account cannot be edited here.' });
    const name = assertText(req.body.name, 'الاسم', 120);
    if (db.users.some((item) => item.id !== user.id && item.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'هذا الاسم مستخدم بالفعل.' });
    user.name = name;
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length !== 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 حروف بالضبط.' });
      user.passwordHash = bcrypt.hashSync(password, 12);
    }
    user.updatedAt = new Date().toISOString();
    saveDatabase();
    res.json({ user: publicUser(user) });
  } catch (error) { sendError(res, error); }
});
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') return res.status(400).json({ error: 'The admin owner account cannot be deleted.' });
  db.users = db.users.filter((item) => item.id !== user.id);
  db.photoLikes = db.photoLikes.filter((like) => like.userId !== user.id);
  db.comments = db.comments.filter((comment) => comment.userId !== user.id);
  db.guestbook = db.guestbook.filter((entry) => entry.userId !== user.id);
  saveDatabase();
  res.json({ ok: true });
});

function serializePhoto(photo, userId) {
  return {
    id: photo.id,
    title: photo.title,
    caption: photo.caption,
    url: `/uploads/${photo.filename}`,
    isFavorite: Boolean(photo.isFavorite),
    createdAt: photo.createdAt,
    uploadedBy: findUser(photo.uploadedBy)?.name || 'Unknown',
    likeCount: db.photoLikes.filter((like) => like.photoId === photo.id).length,
    likedByMe: db.photoLikes.some((like) => like.photoId === photo.id && like.userId === userId)
  };
}

app.get('/api/photos', requireAuth, (req, res) => res.json([...db.photos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((photo) => serializePhoto(photo, req.user.id))));
app.post('/api/photos', requireAuth, requireAdmin, upload.single('photo'), (req, res) => {
  try {
    if (!req.file || !req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Image upload is required.' });
    const photo = { id: nextId('photos'), title: assertText(req.body.title, 'Title', 160), caption: String(req.body.caption || '').trim().slice(0, 1000), filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, isFavorite: req.body.isFavorite === 'true' || req.body.isFavorite === 'on', uploadedBy: req.user.id, createdAt: new Date().toISOString() };
    db.photos.push(photo);
    saveDatabase();
    res.status(201).json(serializePhoto(photo, req.user.id));
  } catch (error) { sendError(res, error); }
});
app.delete('/api/photos/:id', requireAuth, requireAdmin, (req, res) => {
  const photo = db.photos.find((item) => item.id === Number(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  db.photos = db.photos.filter((item) => item.id !== photo.id);
  db.photoLikes = db.photoLikes.filter((like) => like.photoId !== photo.id);
  db.comments = db.comments.filter((comment) => comment.photoId !== photo.id);
  fs.rm(path.join(UPLOAD_DIR, photo.filename), { force: true }, () => {});
  saveDatabase();
  res.json({ ok: true });
});
app.post('/api/photos/:id/like', requireAuth, (req, res) => {
  const photoId = Number(req.params.id);
  const exists = db.photoLikes.some((like) => like.photoId === photoId && like.userId === req.user.id);
  db.photoLikes = exists ? db.photoLikes.filter((like) => !(like.photoId === photoId && like.userId === req.user.id)) : [...db.photoLikes, { photoId, userId: req.user.id, createdAt: new Date().toISOString() }];
  saveDatabase();
  res.json({ likedByMe: !exists, likeCount: db.photoLikes.filter((like) => like.photoId === photoId).length });
});
app.get('/api/photos/:id/comments', requireAuth, (req, res) => {
  const photoId = Number(req.params.id);
  res.json(db.comments.filter((comment) => comment.photoId === photoId).map((comment) => ({ id: comment.id, body: comment.body, createdAt: comment.createdAt, author: findUser(comment.userId)?.name || 'Unknown' })));
});
app.post('/api/photos/:id/comments', requireAuth, (req, res) => {
  try {
    db.comments.push({ id: nextId('comments'), photoId: Number(req.params.id), userId: req.user.id, body: assertText(req.body.body, 'Comment', 1000), createdAt: new Date().toISOString() });
    saveDatabase();
    res.status(201).json({ ok: true });
  } catch (error) { sendError(res, error); }
});

app.get('/api/timeline', requireAuth, (_req, res) => res.json([...db.timeline].sort((a, b) => a.sortOrder - b.sortOrder)));
app.post('/api/timeline', requireAuth, requireAdmin, (req, res) => {
  try {
    const item = { id: nextId('timeline'), title: assertText(req.body.title, 'Title', 160), eventDate: assertText(req.body.eventDate, 'Date', 80), description: assertText(req.body.description, 'Description', 1200), sortOrder: Number(req.body.sortOrder || 0) };
    db.timeline.push(item);
    saveDatabase();
    res.status(201).json(item);
  } catch (error) { sendError(res, error); }
});
app.delete('/api/timeline/:id', requireAuth, requireAdmin, (req, res) => { db.timeline = db.timeline.filter((item) => item.id !== Number(req.params.id)); saveDatabase(); res.json({ ok: true }); });

app.get('/api/letters', requireAuth, (_req, res) => res.json([...db.letters].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
app.post('/api/letters', requireAuth, requireAdmin, (req, res) => {
  try {
    const letter = { id: nextId('letters'), title: assertText(req.body.title, 'Title', 160), body: assertText(req.body.body, 'Letter', 6000), createdAt: new Date().toISOString() };
    db.letters.push(letter);
    saveDatabase();
    res.status(201).json(letter);
  } catch (error) { sendError(res, error); }
});
app.delete('/api/letters/:id', requireAuth, requireAdmin, (req, res) => { db.letters = db.letters.filter((item) => item.id !== Number(req.params.id)); saveDatabase(); res.json({ ok: true }); });

app.get('/api/guestbook', requireAuth, (_req, res) => res.json([...db.guestbook].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry) => ({ id: entry.id, body: entry.body, createdAt: entry.createdAt, author: findUser(entry.userId)?.name || 'Unknown' }))));
app.post('/api/guestbook', requireAuth, (req, res) => {
  try {
    db.guestbook.push({ id: nextId('guestbook'), userId: req.user.id, body: assertText(req.body.body, 'Message', 1000), createdAt: new Date().toISOString() });
    saveDatabase();
    res.status(201).json({ ok: true });
  } catch (error) { sendError(res, error); }
});

app.get('/api/goals', requireAuth, (_req, res) => res.json(db.goals));
app.post('/api/goals', requireAuth, requireAdmin, (req, res) => {
  try {
    const goal = { id: nextId('goals'), title: assertText(req.body.title, 'Title', 160), progress: Math.max(0, Math.min(100, Number(req.body.progress || 0))) };
    db.goals.push(goal);
    saveDatabase();
    res.status(201).json(goal);
  } catch (error) { sendError(res, error); }
});
app.delete('/api/goals/:id', requireAuth, requireAdmin, (req, res) => { db.goals = db.goals.filter((item) => item.id !== Number(req.params.id)); saveDatabase(); res.json({ ok: true }); });

app.get('/api/music', requireAuth, (_req, res) => res.json(db.music.map((track) => ({ ...track, url: `/uploads/${track.filename}` }))));
app.post('/api/music', requireAuth, requireAdmin, upload.single('music'), (req, res) => {
  try {
    if (!req.file || !req.file.mimetype.startsWith('audio/')) return res.status(400).json({ error: 'Audio upload is required.' });
    db.music.forEach((track) => { track.isActive = false; });
    const track = { id: nextId('music'), title: assertText(req.body.title, 'Title', 160), filename: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, isActive: true, uploadedBy: req.user.id, createdAt: new Date().toISOString() };
    db.music.push(track);
    saveDatabase();
    res.status(201).json(track);
  } catch (error) { sendError(res, error); }
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, (_req, res) => res.json({ users: db.users.length, photos: db.photos.length, comments: db.comments.length, guestbook: db.guestbook.length, likes: db.photoLikes.length }));
app.get('/api/admin/backup', requireAuth, requireAdmin, (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="moonlit-backup.json"');
  res.json({ exportedAt: new Date().toISOString(), database: db });
});

// منع روابط الـ API غير الموجودة من إرجاع كود HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'هذا الإجراء غير مدعوم أو غير موجود على السيرفر.' });
});

app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// مصيدة الأخطاء العامة - تمنع كراش السيرفر وترجع رسائل خطأ نظيفة للـ Frontend
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  const status = err.status || err.statusCode || 400;
  res.status(status).json({ error: err.message || 'حدث خطأ غير متوقع في معالجة البيانات.' });
});

app.listen(PORT, () => {
  console.log(`Moonlit Love Diary running at http://localhost:${PORT}`);
  console.log('Default first-run admin: admin / 123456');
});