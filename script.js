let currentUser = null;
let settings = null;
let relationshipStartDate = new Date('2021-02-14T20:30:00');
let photos = [];
let activePhotoId = null;

const surpriseMessages = [
  'قبلة سرية مخبأة في الأغنية القادمة.',
  'قابلني حيث يلامس الورد ضوء القمر.',
  'أنت أجمل إشعار من هذا الكون.',
  'مهمة الليلة: نحفظ ذكرى صغيرة للأبد.',
  'لو كان لهذه الصفحة نبض، لكتب اسمك.'
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const fetchOptions = {
    credentials: 'same-origin',
    ...options
  };

  // معالجة ذكية للـ Headers تمنع تعليق رفع الصور والموسيقى
  if (options.body && options.body instanceof FormData) {
    if (fetchOptions.headers) {
      delete fetchOptions.headers['Content-Type'];
    }
  } else {
    fetchOptions.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
  }

  const response = await fetch(path, fetchOptions);
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    data = { error: text || 'Request failed.' };
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('error', isError);
  element.classList.toggle('success', Boolean(message) && !isError);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function applyAuthState(meta = {}) {
  const isLoggedIn = Boolean(currentUser);
  $('#appContent').classList.toggle('hidden', !isLoggedIn);
  $('#sessionPill').classList.toggle('hidden', !isLoggedIn);
  $('#loginForm').classList.toggle('hidden', isLoggedIn);
  $('#currentUserName').textContent = isLoggedIn ? `${currentUser.name} (${currentUser.role === 'admin' ? 'أدمن' : 'مستخدم'})` : '';
  $('#accountCapacity').innerHTML = `عدد الحسابات: <strong>${meta.userCount || 0} من ${meta.maxUsers || 3}</strong>`;
  $$('.admin-only').forEach((element) => element.classList.toggle('hidden', !currentUser || currentUser.role !== 'admin'));
  $$('.upload-form').forEach((element) => element.classList.toggle('hidden', !isLoggedIn));
}

async function loadSession() {
  const meta = await api('/api/auth/me');
  currentUser = meta.user;
  applyAuthState(meta);
  if (currentUser) await loadAllData();
}

async function loadAllData() {
  const [settingsData] = await Promise.all([
    loadSettings(),
    loadPhotos(),
    loadTimeline(),
    loadLetters(),
    loadGuestbook(),
    loadGoals(),
    loadMusic()
  ]);
  if (currentUser.role === 'admin') await Promise.all([loadUsers(), loadAnalytics()]);
  return settingsData;
}

async function loadSettings() {
  settings = await api('/api/settings');
  relationshipStartDate = new Date(settings.relationship_start_date);
  $('#heroQuote').textContent = `“${settings.hero_quote}”`;
  $('#footerQuote').textContent = `“${settings.footer_quote}”`;
  $('#footerStartDate').textContent = `تاريخ بداية العلاقة: ${formatDate(settings.relationship_start_date)} · © 2026 مذكّرة الحب`;
  const messages = settings.daily_messages.length ? settings.daily_messages : ['الحب محفوظ هنا بأمان.'];
  const startOfYear = new Date(new Date().getFullYear(), 0, 0);
  const dayOfYear = Math.floor((new Date() - startOfYear) / 86400000);
  $('#dailyMessage').textContent = messages[dayOfYear % messages.length];
  if (currentUser?.role === 'admin') {
    const form = $('#settingsForm');
    form.relationship_start_date.value = settings.relationship_start_date.slice(0, 16);
    form.hero_quote.value = settings.hero_quote;
    form.footer_quote.value = settings.footer_quote;
    form.daily_messages.value = messages.join('\n');
  }
  return settings;
}

function updateLoveTimer() {
  const now = new Date();
  let diff = Math.max(0, now - relationshipStartDate);
  const second = 1000;
  const minute = second * 60;
  const hour = minute * 60;
  const day = hour * 24;
  const year = day * 365.2425;
  const month = day * 30.436875;
  const values = {
    years: Math.floor(diff / year)
  };
  diff -= values.years * year;
  values.months = Math.floor(diff / month);
  diff -= values.months * month;
  values.days = Math.floor(diff / day);
  diff -= values.days * day;
  values.hours = Math.floor(diff / hour);
  diff -= values.hours * hour;
  values.minutes = Math.floor(diff / minute);
  diff -= values.minutes * minute;
  values.seconds = Math.floor(diff / second);
  Object.entries(values).forEach(([key, value]) => { $(`#${key}`).textContent = value; });
}

async function loadPhotos() {
  photos = await api('/api/photos');
  const grid = $('#galleryGrid');
  if (!photos.length) {
    grid.className = 'gallery-grid empty-state';
    grid.innerHTML = '<p>ارفع أول ذكرى خاصة من لوحة الإدارة.</p>';
    $('#memoryOfDay').textContent = 'ذكرى اليوم ستظهر بعد رفع الصور.';
    return;
  }
  grid.className = 'gallery-grid';
  grid.innerHTML = photos.map((photo) => `
    <article class="memory-card" data-id="${photo.id}">
      <button class="photo" type="button" aria-label="Open ${escapeHtml(photo.title)} preview">
        <img src="${photo.url}" alt="${escapeHtml(photo.title)}">
        <span>${photo.isFavorite ? 'مفضلة' : 'ذكرى'}</span>
      </button>
      <div class="card-row">
        <h3>${escapeHtml(photo.title)}</h3>
        <button class="like-btn ${photo.likedByMe ? 'liked' : ''}" type="button" aria-pressed="${photo.likedByMe}">♥ <span>${photo.likeCount}</span></button>
      </div>
      <p class="muted">${escapeHtml(photo.caption)}</p>
      ${currentUser.role === 'admin' ? `<div class="photo-actions"><button data-delete-photo="${photo.id}" type="button">حذف</button></div>` : ''}
    </article>
  `).join('');
  const dayIndex = new Date().getDate() % photos.length;
  $('#memoryOfDay').textContent = `ذكرى اليوم: “${photos[dayIndex].title}”`;
}

async function openLightbox(photoId) {
  const photo = photos.find((item) => String(item.id) === String(photoId));
  if (!photo) return;
  activePhotoId = photoId;
  $('#lightboxImage').src = photo.url;
  $('#lightboxImage').alt = photo.title;
  $('#lightboxTitle').textContent = photo.title;
  $('#lightboxCaption').textContent = photo.caption;
  await loadComments(photoId);
  const lightbox = $('#lightbox');
  if (typeof lightbox.showModal === 'function') lightbox.showModal();
  else lightbox.setAttribute('open', '');
}

async function loadComments(photoId) {
  const comments = await api(`/api/photos/${photoId}/comments`);
  $('#commentsList').innerHTML = comments.length ? comments.map((comment) => `
    <article class="stack-item"><header><strong>${escapeHtml(comment.author)}</strong><time>${formatDate(comment.createdAt)}</time></header><p>${escapeHtml(comment.body)}</p></article>
  `).join('') : '<p class="muted">لا توجد تعليقات بعد.</p>';
}

async function loadTimeline() {
  const events = await api('/api/timeline');
  $('#timelineList').innerHTML = events.map((event) => `
    <li><time>${escapeHtml(event.eventDate)}</time><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description)}</p>${currentUser.role === 'admin' ? `<button class="danger-btn" data-delete-timeline="${event.id}" type="button">حذف</button>` : ''}</li>
  `).join('');
}

async function loadLetters() {
  const letters = await api('/api/letters');
  const first = letters[0];
  $('#letterPreview').innerHTML = first ? `<strong>${escapeHtml(first.title)},</strong><br>${escapeHtml(first.body)}` : '<strong>لا توجد رسائل بعد.</strong><br>الأدمن يقدر يضيف أول رسالة خاصة.';
  $('#lettersList').innerHTML = letters.map((letter) => `
    <article class="stack-item"><header><strong>${escapeHtml(letter.title)}</strong><time>${formatDate(letter.createdAt)}</time></header><p>${escapeHtml(letter.body)}</p>${currentUser.role === 'admin' ? `<button class="danger-btn" data-delete-letter="${letter.id}" type="button">حذف</button>` : ''}</article>
  `).join('');
}

async function loadGuestbook() {
  const entries = await api('/api/guestbook');
  $('#guestbookList').innerHTML = entries.length ? entries.map((entry) => `
    <article><strong>${escapeHtml(entry.author)}</strong><time>${formatDate(entry.createdAt)}</time><p>${escapeHtml(entry.body)}</p>${currentUser.role === 'admin' ? `<button class="danger-btn" data-delete-guestbook="${entry.id}" type="button">حذف</button>` : ''}</article>
  `).join('') : '<article><p>لا توجد رسائل في دفتر الزوار بعد.</p></article>';
}

async function loadGoals() {
  const goals = await api('/api/goals');
  $('#goalsBoard').innerHTML = goals.map((goal) => `
    <article><span>${goal.progress}%</span><h3>${escapeHtml(goal.title)}</h3><progress value="${goal.progress}" max="100">${goal.progress}%</progress>${currentUser.role === 'admin' ? `<button class="danger-btn" data-delete-goal="${goal.id}" type="button">حذف</button>` : ''}</article>
  `).join('');
}

async function loadMusic() {
  const tracks = await api('/api/music');
  const active = tracks.find((track) => track.isActive) || tracks[0];
  const audio = $('#audioPlayer');
  if (!active) {
    $('#musicStatus').textContent = 'لم يتم رفع أغنية بعد.';
    audio.classList.add('hidden');
    audio.removeAttribute('src');
    return;
  }
  audio.src = active.url;
  audio.classList.remove('hidden');
  $('#musicStatus').textContent = `جاهزة: ${active.title}`;
}

async function tryPlayMusic() {
  const audio = $('#audioPlayer');
  if (!audio.src) return;
  try {
    await audio.play();
    $('.music-card').classList.add('playing');
    $('#playToggle').textContent = 'إيقاف الأغنية';
    $('#musicStatus').textContent = 'الأغنية تعمل تلقائياً بعد الدخول.';
  } catch (_error) {
    $('#musicStatus').textContent = 'الأغنية جاهزة. اضغط تشغيل إذا منع المتصفح التشغيل التلقائي.';
  }
}

async function loadUsers() {
  const data = await api('/api/users');
  $('#usersList').innerHTML = data.users.map((user) => `
    <article class="stack-item" data-user='${escapeHtml(JSON.stringify(user))}'><header><strong>${escapeHtml(user.name)}</strong><span>${user.role === 'admin' ? 'أدمن' : 'مستخدم'}</span></header>${user.role !== 'admin' ? `<button data-edit-user="${user.id}" type="button">تعديل</button> <button class="danger-btn" data-delete-user="${user.id}" type="button">حذف المستخدم</button>` : ''}</article>
  `).join('');
}

async function loadAnalytics() {
  const analytics = await api('/api/admin/analytics');
  $('#analytics').innerHTML = Object.entries(analytics).map(([key, value]) => `<div><strong>${value}</strong><span>${escapeHtml(key)}</span></div>`).join('');
}

function bindStaticInteractions() {
  $('#themeToggle').addEventListener('click', () => {
    const dayMode = document.body.classList.toggle('day-mode');
    $('#themeToggle').textContent = dayMode ? 'الوضع النهاري' : 'الوضع الليلي';
    $('#themeToggle').setAttribute('aria-pressed', dayMode.toString());
  });
  $('#envelope').addEventListener('click', () => {
    const open = $('#envelope').classList.toggle('open');
    $('#envelope').setAttribute('aria-expanded', open.toString());
    $('#envelope .seal').textContent = open ? 'اقرأ' : 'افتح';
  });
  $('#surpriseBtn').addEventListener('click', () => {
    $('#surpriseMessage').textContent = surpriseMessages[Math.floor(Math.random() * surpriseMessages.length)];
  });
  $('#closeLightbox').addEventListener('click', () => $('#lightbox').close());
  $('#lightbox').addEventListener('click', (event) => { if (event.target === $('#lightbox')) $('#lightbox').close(); });
  $('#playToggle').addEventListener('click', async () => {
    const audio = $('#audioPlayer');
    if (!audio.src) return;
    if (audio.paused) {
      await audio.play();
      $('.music-card').classList.add('playing');
      $('#playToggle').textContent = 'إيقاف الأغنية';
      $('#musicStatus').textContent = 'الأغنية تعمل بهدوء رومانسي.';
    } else {
      audio.pause();
      $('.music-card').classList.remove('playing');
      $('#playToggle').textContent = 'تشغيل الأغنية';
      $('#musicStatus').textContent = 'متوقفة الآن.';
    }
  });
}

function bindForms() {
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      currentUser = data.user;
      setMessage($('#loginMessage'), 'مرحباً بعودتك.');
      await loadSession();
      await tryPlayMusic();
    } catch (error) {
      setMessage($('#loginMessage'), error.message, true);
    }
  });
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
  $('#photoForm').addEventListener('submit', async (event) => submitFormData(event, '/api/photos', loadPhotos));
  $('#musicForm').addEventListener('submit', async (event) => submitFormData(event, '/api/music', loadMusic));
  $('#timelineForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/timeline', loadTimeline));
  $('#letterForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/letters', loadLetters));
  $('#guestbookForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/guestbook', loadGuestbook));
  $('#goalForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/goals', loadGoals));
  $('#userForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/users', async () => { await loadUsers(); await loadSession(); }));
  $('#settingsForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/settings', loadSettings, 'PUT'));
  $('#passwordForm').addEventListener('submit', async (event) => submitJsonForm(event, '/api/auth/change-password', () => alert('تم تغيير كلمة المرور.')));
  $('#commentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await api(`/api/photos/${activePhotoId}/comments`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    event.target.reset();
    await loadComments(activePhotoId);
  });
}

async function submitJsonForm(event, path, after, method = 'POST') {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'جاري الحفظ...';
    await api(path, { method, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    await after();
  } catch (error) {
    alert(error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function submitFormData(event, path, after) {
  event.preventDefault();
  const form = event.target;
  const btn = form.querySelector('button[type="submit"]');
  const message = form.querySelector('[data-form-message]');
  const originalText = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'جاري الرفع والنبض...';
    setMessage(message, 'جاري رفع الملف، انتظر قليلاً...');
    await api(path, { method: 'POST', body: new FormData(form) });
    form.reset();
    await after();
    setMessage(message, path.includes('music') ? 'تم رفع الأغنية وتشغيلها في الموقع.' : 'تم رفع الصورة وإضافتها للمعرض.');
  } catch (error) {
    setMessage(message, error.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function bindDelegatedActions() {
  document.addEventListener('click', async (event) => {
    const photoCard = event.target.closest('.memory-card');
    if (event.target.closest('.photo') && photoCard) await openLightbox(photoCard.dataset.id);
    if (event.target.closest('.like-btn') && photoCard) {
      const result = await api(`/api/photos/${photoCard.dataset.id}/like`, { method: 'POST' });
      const button = event.target.closest('.like-btn');
      button.classList.toggle('liked', result.likedByMe);
      button.setAttribute('aria-pressed', result.likedByMe.toString());
      button.querySelector('span').textContent = result.likeCount;
    }
    await handleDelete(event.target, 'deletePhoto', '/api/photos/', loadPhotos);
    await handleDelete(event.target, 'deleteTimeline', '/api/timeline/', loadTimeline);
    await handleDelete(event.target, 'deleteLetter', '/api/letters/', loadLetters);
    await handleDelete(event.target, 'deleteGoal', '/api/goals/', loadGoals);
    await handleDelete(event.target, 'deleteGuestbook', '/api/guestbook/', loadGuestbook);
    await handleDelete(event.target, 'deleteUser', '/api/users/', async () => { await loadUsers(); await loadSession(); });
    if (event.target.dataset?.editUser) await editUser(event.target.closest('.stack-item'));
  });
}

async function editUser(item) {
  const user = JSON.parse(item.dataset.user);
  const name = prompt('الاسم', user.name);
  if (!name) return;
  const password = prompt('كلمة مرور جديدة، 6 حروف فقط. اتركها فارغة لو تبي تخلي القديمة.', '');
  await api(`/api/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name, password }) });
  await loadUsers();
}

async function handleDelete(target, dataName, basePath, after) {
  const id = target.dataset?.[dataName];
  if (!id) return;
  if (!confirm('هل تريد الحذف نهائياً؟')) return;
  await api(`${basePath}${id}`, { method: 'DELETE' });
  await after();
}

function initRevealAnimations() {
  const sections = $$('.reveal');
  const revealAll = () => sections.forEach((section) => section.classList.add('visible'));
  if (!('IntersectionObserver' in window)) return revealAll();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  sections.forEach((section) => observer.observe(section));
  setTimeout(revealAll, 900);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindStaticInteractions();
  bindForms();
  bindDelegatedActions();
  initRevealAnimations();
  setInterval(updateLoveTimer, 1000);
  updateLoveTimer();
  try {
    await loadSession();
  } catch (error) {
    setMessage($('#loginMessage'), error.message, true);
  }
});
