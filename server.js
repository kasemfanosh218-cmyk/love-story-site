const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2; // دمج مكتبة كلاوديناري للرفع السحابي المجاني

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnvFile(path.join(__dirname, '..', '..', '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || ROOT;
const DATA_DIR = process.env.DATA_DIR || path.join(PERSISTENT_DIR, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PERSISTENT_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'database.json');
const MAX_USERS = 3;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CLOUD_FETCH_TIMEOUT_MS = 8000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// إعداد Cloudinary من خلال متغيرات البيئة
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET,
    timeout: 30000
  });
}

function getSessionSecret() {
  // الاعتماد على متغير البيئة لضمان ثباته عند النوم والتنشيط
  return process.env.SESSION_SECRET || 'moonlit_fallback_secret_key_fixed_2026';
}

function defaultData() {
  return {
    nextIds: { users: 1, photos: 1, comments: 1, timeline: 1, letters: 1, music: 1, guestbook: 1, goals: 1 },
    users: [],
    sessions: {}, // إضافة كائن لحفظ الجلسات سحابياً داخل قاعدة البيانات
    settings: {
      relationship_start_date: '2021-02-14T20:30',
      hero_quote: 'في كل ثانية هادئة، تختارنا حكايتنا من جديد.',
      footer_quote: 'الحب الذي نحفظه بيننا قادر أن يضيء سماء كاملة.',
      daily_messages: [
        'اليوم يأتي الحب بهدوء، لكنه يملأ المكان كله.',
        'كل ساعة عادية تصبح ذكرى جميلة عندما تكون لنا.',
        'القمر يحتفظ الليلة بمكان خاص لحكايتنا.',
        'سأجدك في كل حديقة وتحت كل سماء.',
        'بعض الوعود لا تحتاج صوتاً عالياً، يكفي أنها تضيء.'
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

let db = defaultData();

async function loadDatabase() {
  if (!process.env.CLOUDINARY_CLOUD_NAME) {
    console.log("⚠️ Cloudinary غير معرف، يتم تحميل قاعدة البيانات المحلية...");
    if (!fs.existsSync(DB_PATH)) return defaultData();
    return { ...defaultData(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  }
  
  try {
    // تعديل الرابط ليتجنب مشاكل الكاش والتخزين المؤقت أثناء الجلب
    const url = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/v1/moonlit_database.json?t=${Date.now()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error("الملف غير موجود في السحاب");
    const data = await response.json();
    console.log("✅ تم تحميل قاعدة البيانات بنجاح من سحابة Cloudinary");
    return { ...defaultData(), ...data };
  } catch (error) {
    console.log("ℹ️ قاعدة البيانات السحابية غير موجودة بعد أو فشل جلبها، سيتم تحميل الاحتياط المحلي أو الافتراضي.");
    if (fs.existsSync(DB_PATH)) {
      return { ...defaultData(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
    }
    return defaultData();
  }
}

async function saveDatabase() {
  // تأمين وجود الحقل لمنع الأخطاء
  if (!db.sessions) db.sessions = {};
  
  // حفظ محلي احتياطي دائماً
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    try {
      const jsonStr = JSON.stringify(db, null, 2);
      await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
          resource_type: "raw",
          public_id: "moonlit_database.json",
          overwrite: true,
          invalidate: true
        }, (err, res) => {
          if (err) reject(err); else resolve(res);
        });
      
        stream.end(Buffer.from(jsonStr));
      });
      console.log("☁️ تم مزامنة وحفظ قاعدة البيانات سحابياً على Cloudinary");
    } catch (error) {
      console.error("❌ فشل رفع قاعدة البيانات إلى Cloudinary:", error);
    }
  }
}

// بناء متجر جلسات مخصص (Custom Session Store) يحفظ البيانات داخل الـ db السحابي مباشرة
const CustomCloudStore = function(session) {
  const Store = session.Store;
  function CloudStore() { Store.call(this); }
  Object.setPrototypeOf(CloudStore.prototype, Store.prototype);

  CloudStore.prototype.get = function(sid, callback) {
    if (!db.sessions) db.sessions = {};
    const sess = db.sessions[sid];
    if (!sess) return callback(null, null);
    return callback(null, JSON.parse(sess));
  };

  CloudStore.prototype.set = async function(sid, sess, callback) {
    if (!db.sessions) db.sessions = {};
    db.sessions[sid] = JSON.stringify(sess);
    await saveDatabase();
    return callback(null);
  };

  CloudStore.prototype.destroy = async function(sid, callback) {
    if (db.sessions && db.sessions[sid]) {
      delete db.sessions[sid];
      await saveDatabase();
    }
    return callback(null);
  };
  return CloudStore;
};

const CloudStoreInstance = CustomCloudStore(session);

async function seedDatabase() {
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
  await saveDatabase();
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

const MAX_PHOTO_SIZE = 15 * 1024 * 1024;
const MAX_MUSIC_SIZE = 100 * 1024 * 1024;

// إعداد التخزين في الذاكرة للرفع المباشر مع حدود مناسبة للصور والأغاني.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('الملف المختار ليس صورة مدعومة.'));
    cb(null, true);
  }
});

const musicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MUSIC_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('audio/')) return cb(new Error('الملف المختار ليس أغنية أو ملف صوت مدعوم.'));
    cb(null, true);
  }
});

function saveLocalUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase() || '.bin';
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return { filename, url: `/uploads/${filename}` };
}

async function uploadToCloudinary(file, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, res) => {
      if (err) reject(err); else resolve(res);
    });
    stream.end(file.buffer);
  });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// تفعيل المتجر السحابي الجديد لحفظ الجلسات
app.use(session({
  store: new CloudStoreInstance(),
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

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  if (!bcrypt.compareSync(String(req.body.currentPassword || ''), req.user.passwordHash)) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length !== 6) return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 حروف بالضبط.' });
  req.user.passwordHash = bcrypt.hashSync(newPassword, 12);
  req.user.updatedAt = new Date().toISOString();
  await saveDatabase();
  res.json({ ok: true });
});

app.get('/api/settings', requireAuth, (_req, res) => res.json(db.settings));
app.put('/api/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    db.settings = {
      relationship_start_date: assertText(req.body.relationship_start_date, 'Relationship start date', 80),
      hero_quote: assertText(req.body.hero_quote, 'Hero quote', 500),
      footer_quote: assertText(req.body.footer_quote, 'Footer quote', 500),
      daily_messages: String(req.body.daily_messages || '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 50)
    };
    await saveDatabase();
    res.json(db.settings);
  } catch (error) { sendError(res, error); }
});

app.get('/api/users', requireAuth, requireAdmin, (_req, res) => res.json({ users: db.users.map(publicUser), maxUsers: MAX_USERS }));

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (db.users.length >= MAX_USERS) return res.status(400).json({ error: 'هذا الموقع الخاص يسمح بثلاثة حسابات فقط.' });
    const name = assertText(req.body.name, 'الاسم', 120);
    if (db.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'هذا الاسم مستخدم بالفعل.' });
    const password = String(req.body.password || '');
    if (password.length !== 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 حروف بالضبط.' });
    const user = { id: nextId('users'), name, email: `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}@local.user`, passwordHash: bcrypt.hashSync(password, 12), role: 'user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.users.push(user);
    await saveDatabase();
    res.status(201).json({ user: publicUser(user) });
  } catch (error) { sendError(res, error); }
});

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
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
    await saveDatabase();
    res.json({ user: publicUser(user) });
  } catch (error) { sendError(res, error); }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.role === 'admin') return res.status(400).json({ error: 'The admin owner account cannot be deleted.' });
  db.users = db.users.filter((item) => item.id !== user.id);
  db.photoLikes = db.photoLikes.filter((like) => like.userId !== user.id);
  db.comments = db.comments.filter((comment) => comment.userId !== user.id);
  db.guestbook = db.guestbook.filter((entry) => entry.userId !== user.id);
  await saveDatabase();
  res.json({ ok: true });
});

function serializePhoto(photo, userId) {
  return {
    id: photo.id,
    title: photo.title,
    caption: photo.caption,
    url: photo.url || `/uploads/${photo.filename}`,
    isFavorite: Boolean(photo.isFavorite),
    createdAt: photo.createdAt,
    uploadedBy: findUser(photo.uploadedBy)?.name || 'Unknown',
    likeCount: db.photoLikes.filter((like) => like.photoId === photo.id).length,
    likedByMe: db.photoLikes.some((like) => like.photoId === photo.id && like.userId === userId)
  };
}

app.get('/api/photos', requireAuth, (req, res) => res.json([...db.photos].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((photo) => serializePhoto(photo, req.user.id))));

app.post('/api/photos', requireAuth, photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختيار الصورة مطلوب.' });
    
    let fileUrl = '';
    let filename = null;
    let cloudinaryPublicId = null;

    if (process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const result = await uploadToCloudinary(req.file, { resource_type: 'image', folder: 'moonlit_uploads' });
        fileUrl = result.secure_url;
        cloudinaryPublicId = result.public_id;
      } catch (error) {
        console.error('Cloudinary photo upload failed, saving locally:', error.message || error);
      }
    }

    if (!fileUrl) {
      const local = saveLocalUpload(req.file);
      fileUrl = local.url;
      filename = local.filename;
    }

    const photo = { 
      id: nextId('photos'), 
      title: assertText(req.body.title, 'Title', 160), 
      caption: String(req.body.caption || '').trim().slice(0, 1000), 
      url: fileUrl, 
      filename,
      cloudinary_public_id: cloudinaryPublicId,
      isFavorite: req.body.isFavorite === 'true' || req.body.isFavorite === 'on', 
      uploadedBy: req.user.id, 
      createdAt: new Date().toISOString() 
    };
    db.photos.push(photo);
    await saveDatabase();
    res.status(201).json(serializePhoto(photo, req.user.id));
  } catch (error) { sendError(res, error); }
});

app.delete('/api/photos/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const photo = db.photos.find((item) => item.id === Number(req.params.id));
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });
    
    db.photos = db.photos.filter((item) => item.id !== photo.id);
    db.photoLikes = db.photoLikes.filter((like) => like.photoId !== photo.id);
    db.comments = db.comments.filter((comment) => comment.photoId !== photo.id);
    
    if (photo.cloudinary_public_id && process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        await cloudinary.uploader.destroy(photo.cloudinary_public_id);
      } catch (cErr) {
        console.error("⚠️ فشل حذف الصورة من Cloudinary:", cErr);
      }
    } else if (photo.filename) {
      fs.rm(path.join(UPLOAD_DIR, photo.filename), { force: true }, () => {});
    }
    
    await saveDatabase();
    res.json({ ok: true });
  } catch (error) { sendError(res, error); }
});

app.post('/api/photos/:id/like', requireAuth, async (req, res) => {
  const photoId = Number(req.params.id);
  const exists = db.photoLikes.some((like) => like.photoId === photoId && like.userId === req.user.id);
  db.photoLikes = exists ? db.photoLikes.filter((like) => !(like.photoId === photoId && like.userId === req.user.id)) : [...db.photoLikes, { photoId, userId: req.user.id, createdAt: new Date().toISOString() }];
  await saveDatabase();
  res.json({ likedByMe: !exists, likeCount: db.photoLikes.filter((like) => like.photoId === photoId).length });
});

app.get('/api/photos/:id/comments', requireAuth, (req, res) => {
  const photoId = Number(req.params.id);
  res.json(db.comments.filter((comment) => comment.photoId === photoId).map((comment) => ({ id: comment.id, body: comment.body, createdAt: comment.createdAt, author: findUser(comment.userId)?.name || 'Unknown' })));
});

app.post('/api/photos/:id/comments', requireAuth, async (req, res) => {
  try {
    db.comments.push({ id: nextId('comments'), photoId: Number(req.params.id), userId: req.user.id, body: assertText(req.body.body, 'Comment', 1000), createdAt: new Date().toISOString() });
    await saveDatabase();
    res.status(201).json({ ok: true });
  } catch (error) { sendError(res, error); }
});

app.get('/api/timeline', requireAuth, (_req, res) => res.json([...db.timeline].sort((a, b) => a.sortOrder - b.sortOrder)));

app.post('/api/timeline', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = { id: nextId('timeline'), title: assertText(req.body.title, 'Title', 160), eventDate: assertText(req.body.eventDate, 'Date', 80), description: assertText(req.body.description, 'Description', 1200), sortOrder: Number(req.body.sortOrder || 0) };
    db.timeline.push(item);
    await saveDatabase();
    res.status(201).json(item);
  } catch (error) { sendError(res, error); }
});

app.delete('/api/timeline/:id', requireAuth, requireAdmin, async (req, res) => { db.timeline = db.timeline.filter((item) => item.id !== Number(req.params.id)); await saveDatabase(); res.json({ ok: true }); });

app.get('/api/letters', requireAuth, (_req, res) => res.json([...db.letters].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));

app.post('/api/letters', requireAuth, requireAdmin, async (req, res) => {
  try {
    const letter = { id: nextId('letters'), title: assertText(req.body.title, 'Title', 160), body: assertText(req.body.body, 'Letter', 6000), createdAt: new Date().toISOString() };
    db.letters.push(letter);
    await saveDatabase();
    res.status(201).json(letter);
  } catch (error) { sendError(res, error); }
});

app.delete('/api/letters/:id', requireAuth, requireAdmin, async (req, res) => { db.letters = db.letters.filter((item) => item.id !== Number(req.params.id)); await saveDatabase(); res.json({ ok: true }); });

app.get('/api/guestbook', requireAuth, (_req, res) => res.json([...db.guestbook].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((entry) => ({ id: entry.id, body: entry.body, createdAt: entry.createdAt, author: findUser(entry.userId)?.name || 'Unknown' }))));

app.post('/api/guestbook', requireAuth, async (req, res) => {
  try {
    db.guestbook.push({ id: nextId('guestbook'), userId: req.user.id, body: assertText(req.body.body, 'Message', 1000), createdAt: new Date().toISOString() });
    await saveDatabase();
    res.status(201).json({ ok: true });
  } catch (error) { sendError(res, error); }
});

app.delete('/api/guestbook/:id', requireAuth, requireAdmin, async (req, res) => {
  db.guestbook = db.guestbook.filter((entry) => entry.id !== Number(req.params.id));
  await saveDatabase();
  res.json({ ok: true });
});

app.get('/api/goals', requireAuth, (_req, res) => res.json(db.goals));

app.post('/api/goals', requireAuth, requireAdmin, async (req, res) => {
  try {
    const goal = { id: nextId('goals'), title: assertText(req.body.title, 'Title', 160), progress: Math.max(0, Math.min(100, Number(req.body.progress || 0))) };
    db.goals.push(goal);
    await saveDatabase();
    res.status(201).json(goal);
  } catch (error) { sendError(res, error); }
});

app.delete('/api/goals/:id', requireAuth, requireAdmin, async (req, res) => { db.goals = db.goals.filter((item) => item.id !== Number(req.params.id)); await saveDatabase(); res.json({ ok: true }); });

app.get('/api/music', requireAuth, (_req, res) => res.json(db.music.map((track) => ({ ...track, url: track.url || `/uploads/${track.filename}` }))));

app.post('/api/music', requireAuth, musicUpload.single('music'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'اختيار الأغنية مطلوب.' });
    
    let fileUrl = '';
    let filename = null;
    let cloudinaryPublicId = null;

    if (process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const result = await uploadToCloudinary(req.file, { resource_type: 'video', folder: 'moonlit_uploads' });
        fileUrl = result.secure_url;
        cloudinaryPublicId = result.public_id;
      } catch (error) {
        console.error('Cloudinary music upload failed, saving locally:', error.message || error);
      }
    }

    if (!fileUrl) {
      const local = saveLocalUpload(req.file);
      fileUrl = local.url;
      filename = local.filename;
    }

    db.music.forEach((track) => { track.isActive = false; });
    const track = { 
      id: nextId('music'), 
      title: assertText(req.body.title, 'Title', 160), 
      url: fileUrl, 
      filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      cloudinary_public_id: cloudinaryPublicId,
      isActive: true, 
      uploadedBy: req.user.id, 
      createdAt: new Date().toISOString() 
    };
    db.music.push(track);
    await saveDatabase();
    res.status(201).json(track);
  } catch (error) { sendError(res, error); }
});

app.get('/api/admin/analytics', requireAuth, requireAdmin, (_req, res) => res.json({ users: db.users.length, photos: db.photos.length, comments: db.comments.length, guestbook: db.guestbook.length, likes: db.photoLikes.length }));

app.get('/api/admin/backup', requireAuth, requireAdmin, (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="moonlit-backup.json"');
  res.json({ exportedAt: new Date().toISOString(), database: db });
});

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'هذا الإجراء غير مدعوم أو غير موجود على السيرفر.' });
});

app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    const limitMb = Math.round((err.field === 'music' ? MAX_MUSIC_SIZE : MAX_PHOTO_SIZE) / 1024 / 1024);
    return res.status(413).json({ error: `حجم الملف كبير. الحد الأقصى ${limitMb}MB.` });
  }
  const status = err.status || err.statusCode || 400;
  res.status(status).json({ error: err.message || 'حدث خطأ غير متوقع في معالجة البيانات.' });
});

async function startServer() {
  db = await loadDatabase();
  await seedDatabase();
  
  app.listen(PORT, () => {
    console.log(`Moonlit Love Diary running at http://localhost:${PORT}`);
    console.log('Default first-run admin: admin / 123456');
  });
}

startServer();
