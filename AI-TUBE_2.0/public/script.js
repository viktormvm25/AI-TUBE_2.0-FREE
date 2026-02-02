const API_URL = '/api';
let currentUser = null;
let deleteVideoId = null;

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function openModal(id) { document.getElementById(id)?.classList.add('active'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

function saveAuth(token, user) {
    if (!token || !user) return;
    user.token = token;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    currentUser = user;
}

function loadAuth() {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    if (token && userStr && userStr !== "undefined") {
        try {
            currentUser = JSON.parse(userStr);
            if (currentUser) currentUser.token = token;
            return true;
        } catch (e) { localStorage.removeItem('user'); }
    }
    return false;
}

function logout(message = null) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;
    showScreen('auth-screen');
    if (message) showToast(message, 'error');
}

async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = options.headers || {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    options.headers = headers;

    try {
        const res = await fetch(API_URL + endpoint, options);
        if (res.status === 401) {
            if (endpoint.includes('/auth/login') || endpoint.includes('/auth/register')) {
                // Pass through
            } else if (endpoint !== '/auth/me') {
                logout('Сессия истекла');
                return null;
            } else {
                logout(null);
                return null;
            }
        }
        if (!res.ok) {
            let errorMsg = 'Ошибка сервера';
            try { const d = await res.json(); errorMsg = d.error || errorMsg; } catch (e) { }
            if (errorMsg === 'Username taken') errorMsg = 'Логин занят';
            throw new Error(errorMsg);
        }
        return res;
    } catch (e) { throw e; }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Deep Linking Check
    const params = new URLSearchParams(window.location.search);
    const videoId = params.get('v');
    if (videoId) {
        setTimeout(() => {
            if (typeof openPlayer === 'function') openPlayer(videoId);
        }, 500);
    }

    initLavaLamp();

    // Check if splash was already shown this session
    const splashShown = sessionStorage.getItem('splashShown');
    const hasAuth = loadAuth();

    if (!splashShown) {
        showSplash();
        sessionStorage.setItem('splashShown', 'true');
        setTimeout(async () => {
            hideSplash();
            if (hasAuth) {
                await checkAuth();
                showScreen('app-layout');
                loadVideoFeed();
            } else {
                showScreen('auth-screen');
            }
        }, 2500);
    } else {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none'; // Force hide

        if (hasAuth) {
            await checkAuth();
            showScreen('app-layout');
            loadVideoFeed();
        } else {
            showScreen('auth-screen');
        }
    }



    setupNavigation();
    setupForms();
    setupFileUploads();
    setupDeleteModal();
    setupShortsScroll();

    const backBtn = document.getElementById('player-back-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            const video = document.getElementById('main-player');
            if (video) { video.pause(); video.src = ""; }
            navigateTo('video-feed');
        };
    }

    const fsBtn = document.getElementById('custom-fullscreen-btn');
    if (fsBtn) {
        fsBtn.onclick = () => {
            const container = document.querySelector('.player-wrapper');
            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(err => console.log(err));
            } else {
                document.exitFullscreen();
            }
        };
    }
});

function showSplash() { document.getElementById('splash-screen')?.classList.remove('hidden'); }
function hideSplash() {
    const s = document.getElementById('splash-screen');
    if (s) { s.classList.add('exit'); setTimeout(() => { s.classList.add('hidden'); s.classList.remove('exit'); }, 800); }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

function showGreeting(name) {
    const overlay = document.getElementById('greeting-overlay');
    const text = document.getElementById('greeting-text');
    if (overlay && text) {
        text.innerText = `Приветствую, ${name}`;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 2500);
    }
}

function navigateTo(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.target === viewId));

    // Hide global header in video player or shorts for cleaner look
    const header = document.querySelector('.app-header');
    if (header) {
        if (viewId === 'video-player-view' || viewId === 'shorts-feed') {
            header.classList.add('hidden');
            document.getElementById('app-layout').style.paddingTop = '0';
        } else {
            header.classList.remove('hidden');
            document.getElementById('app-layout').style.paddingTop = ''; // Restore default
        }
    }

    if (viewId === 'video-feed') loadVideoFeed();
    if (viewId === 'shorts-feed') loadShorts();
    if (viewId === 'my-channel') loadMyChannel();
    if (viewId === 'subscriptions-view') loadSubscriptions();
    if (viewId === 'profile-view') updateUI();
}

function updateUI() {
    if (!currentUser) return;
    if (currentUser.theme === 'neon-purple') document.body.classList.add('theme-purple');
    else document.body.classList.remove('theme-purple');

    if (document.getElementById('profile-name')) document.getElementById('profile-name').innerText = currentUser.name;
    if (document.getElementById('profile-username')) document.getElementById('profile-username').innerText = currentUser.username;
    if (document.getElementById('profile-avatar')) document.getElementById('profile-avatar').src = currentUser.avatarPath || '/assets/avatar-placeholder.svg';

    // Load channel stats for profile
    loadChannelStats();
}

async function loadChannelStats() {
    const container = document.getElementById('channel-stats-content');
    if (!container) return;

    try {
        const res = await apiFetch('/channels/my');
        if (!res) return;
        const ch = await res.json();

        if (!ch) {
            container.innerHTML = '<p class="no-channel-message">Канал не создан. Создайте канал во вкладке "Мой канал"</p>';
            return;
        }

        // Get videos for stats
        const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
        const videos = vRes ? await vRes.json() : [];

        // Calculate total views and likes
        let totalViews = 0;
        let totalLikes = 0;

        for (const v of videos) {
            totalViews += v.views || 0;
            try {
                const dRes = await apiFetch(`/videos/${v.id}/details`);
                if (dRes) {
                    const details = await dRes.json();
                    totalLikes += details.likes || 0;
                }
            } catch (e) { }
        }

        container.innerHTML = `
            <div class="channel-info-row">
                <img src="${ch.avatarPath || '/assets/avatar-placeholder.svg'}" class="channel-avatar-profile" onerror="this.src='/assets/avatar-placeholder.svg'">
                <span class="channel-name-profile">${ch.channelName}</span>
            </div>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-value">${ch.subscribersCount || 0}</span>
                    <span class="stat-label">Подписчиков</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${totalLikes}</span>
                    <span class="stat-label">Лайков</span>
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = '<p class="no-channel-message">Ошибка загрузки</p>';
    }
}

async function login(username, password) {
    try {
        const res = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        if (!res) return;
        const data = await res.json();
        saveAuth(data.token, data.user);
        showGreeting(data.user.name);
        updateUI();
        showScreen('app-layout');
        loadVideoFeed();
    } catch (e) { showToast(e.message, 'error'); }
}

async function register(name, username, password) {
    try {
        const res = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ name, username, password }) });
        if (!res) return;
        const data = await res.json();
        saveAuth(data.token, data.user);
        showGreeting(data.user.name);
        updateUI();
        showScreen('app-layout');
        loadVideoFeed();
    } catch (e) { showToast(e.message, 'error'); }
}

async function checkAuth() {
    try {
        const res = await apiFetch('/auth/me');
        if (res) {
            const user = await res.json();
            saveAuth(localStorage.getItem('token'), user);
            updateUI();
        }
    } catch (e) { }
}

function setupForms() {
    const logForm = document.getElementById('login-form');
    if (logForm) logForm.onsubmit = (e) => {
        e.preventDefault();
        if (!logForm.reportValidity()) return;
        login(document.getElementById('login-username').value.trim(), document.getElementById('login-password').value.trim());
    };

    const regForm = document.getElementById('register-form');
    if (regForm) regForm.onsubmit = (e) => {
        e.preventDefault();
        if (!regForm.reportValidity()) return;
        register(document.getElementById('reg-name').value.trim(), document.getElementById('reg-username').value.trim(), document.getElementById('reg-password').value.trim());
    };

    const upForm = document.getElementById('upload-form');
    if (upForm) upForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const chRes = await apiFetch('/channels/my');
            if (!chRes) return;
            const ch = await chRes.json();
            if (!ch) { showToast('Сначала создайте канал', 'error'); return; }

            const fd = new FormData(e.target);
            fd.append('channelId', ch.id);
            const res = await apiFetch('/videos', { method: 'POST', body: fd });
            if (res) { showToast('Опубликовано!'); closeModal('upload-modal'); e.target.reset(); loadMyChannel(); }
        } catch (e) { showToast(e.message, 'error'); }
    };

    const chForm = document.getElementById('create-channel-form');
    if (chForm) chForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { if (await apiFetch('/channels', { method: 'POST', body: fd })) { showToast('Канал создан'); loadMyChannel(); } }
        catch (e) { showToast(e.message, 'error'); }
    };

    const profForm = document.getElementById('profile-edit-form');
    if (profForm) profForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData();
        const name = document.getElementById('edit-name').value;
        const pass = document.getElementById('edit-pass').value;
        const file = document.getElementById('edit-avatar-file').files[0];
        if (name) fd.append('name', name);
        if (pass) fd.append('password', pass);
        if (file) fd.append('avatar', file);
        try { if (await apiFetch('/users/update', { method: 'POST', body: fd })) { showToast('Обновлено'); checkAuth(); } }
        catch (e) { showToast(e.message, 'error'); }
    };

    document.getElementById('toggle-theme').onclick = async () => {
        if (!currentUser) {
            showToast('Войдите, чтобы сохранять тему', 'error');
            return;
        }
        const newTheme = document.body.classList.contains('theme-purple') ? 'neon-blue' : 'neon-purple';
        document.body.classList.toggle('theme-purple');
        try {
            await apiFetch('/users/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: newTheme }) });
            if (currentUser) {
                currentUser.theme = newTheme;
                localStorage.setItem('user', JSON.stringify(currentUser));
            }
            showToast('Тема сохранена в профиль');
        } catch (e) { showToast('Ошибка сохранения темы', 'error'); }
    };

    const editChForm = document.getElementById('edit-channel-form');
    if (editChForm) editChForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
            if (await apiFetch('/channels/update', { method: 'POST', body: fd })) {
                showToast('Канал обновлен');
                closeModal('edit-channel-modal');
                loadMyChannel();
            }
        } catch (e) { showToast(e.message, 'error'); }
    };

    document.getElementById('delete-acc-btn').onclick = async () => {
        if (confirm('Удалить аккаунт навсегда?')) {
            try {
                await apiFetch('/auth/delete', { method: 'POST' });
                logout('Аккаунт удален');
            } catch (e) { showToast(e.message, 'error'); }
        }
    };

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('active'));
}

function setupNavigation() {
    const toReg = document.getElementById('to-register');
    if (toReg) toReg.onclick = () => { document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };

    const toLog = document.getElementById('to-login');
    if (toLog) toLog.onclick = () => { document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };

    // Search
    const searchInput = document.querySelector('.search-bar input');
    const searchBtn = document.querySelector('.search-bar button');

    const triggerSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) return;
        try {
            const isShortsView = !document.getElementById('shorts-feed').classList.contains('hidden');
            const res = await apiFetch(`/videos?search=${encodeURIComponent(query)}${isShortsView ? '&isShort=true' : '&isShort=false'}`);
            if (!res) return;
            const videos = await res.json();

            if (isShortsView) {
                const container = document.getElementById('shorts-container');
                if (videos.length === 0) {
                    container.innerHTML = `
                        <div class="not-found-msg">
                            <i class="fas fa-search"></i>
                            <p>Ничего не найдено по вашему запросу в Шортсах</p>
                        </div>`;
                } else {
                    renderShortsList(videos);
                }
            } else {
                navigateTo('video-feed');
                const list = document.getElementById('video-list');
                if (videos.length === 0) {
                    list.innerHTML = `
                        <div class="not-found-msg">
                            <i class="fas fa-search"></i>
                            <p>Ничего не найдено по вашему запросу</p>
                        </div>`;
                } else {
                    list.innerHTML = videos.map(v => renderVideoCard(v, false)).join('');
                }
            }
        } catch (e) { }
    };

    if (searchBtn) searchBtn.onclick = triggerSearch;
    if (searchInput) searchInput.onkeydown = (e) => { if (e.key === 'Enter') triggerSearch(); };

    const drawer = document.getElementById('drawer');
    const drawerToggle = document.getElementById('drawer-toggle');
    if (drawerToggle) drawerToggle.onclick = (e) => {
        e.stopPropagation(); // Stop click from bubbling to document
        drawer.classList.toggle('open');
    };

    // Close drawer when clicking anywhere outside
    document.addEventListener('click', (e) => {
        if (drawer.classList.contains('open') && !drawer.contains(e.target) && e.target !== drawerToggle) {
            drawer.classList.remove('open');
        }
    });

    // Keep backdrop logic as well for visual consistency
    const drawerBack = document.getElementById('drawer-backdrop');
    if (drawerBack) drawerBack.onclick = () => drawer.classList.remove('open');

    document.querySelectorAll('.drawer-item').forEach(item => {
        item.onclick = () => {
            navigateTo(item.dataset.target);
            drawer.classList.remove('open');
        }
    });

    const logoutBtn = document.getElementById('logout-btn-settings');
    if (logoutBtn) logoutBtn.onclick = () => logout();

    document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => navigateTo(btn.dataset.target));

    const upBtn = document.getElementById('header-upload-btn');
    if (upBtn) upBtn.onclick = () => checkChannelAndUpload();

    const upHero = document.getElementById('upload-video-hero-btn');
    if (upHero) upHero.onclick = () => openModal('upload-modal');

    const backBtn = document.getElementById('back-feed-btn');
    if (backBtn) backBtn.onclick = () => {
        const video = document.getElementById('main-player');
        if (video) { video.pause(); video.src = ""; }
        navigateTo('video-feed');
    };

    // --- KEYBOARD SHORTCUTS ---
    window.addEventListener('keydown', (e) => {
        // Ignore if typing in an input/textarea
        const activeEl = document.activeElement;
        if (['INPUT', 'TEXTAREA'].includes(activeEl.tagName)) return;

        const isShortsView = !document.getElementById('shorts-feed').classList.contains('hidden');
        const isVideoView = !document.getElementById('video-player-view').classList.contains('hidden');
        const mainVideo = document.getElementById('main-player');
        const shortsContainer = document.getElementById('shorts-container');

        // 1. SPACE: Toggle Play/Pause
        if (e.code === 'Space') {
            e.preventDefault();

            if (isVideoView && mainVideo) {
                if (mainVideo.paused) mainVideo.play().catch(() => { });
                else mainVideo.pause();
                return;
            }

            if (isShortsView) {
                const visibleShort = Array.from(document.querySelectorAll('.short-item')).find(item => {
                    const rect = item.getBoundingClientRect();
                    // When snapped, rect.top should be 0 (if header hidden) or 70 (if header visible).
                    // We check if it's within the top half of the viewport.
                    return rect.top >= -100 && rect.top <= 100;
                });
                if (visibleShort) {
                    const vid = visibleShort.querySelector('video');
                    if (vid) {
                        if (vid.paused) vid.play().catch(() => { });
                        else vid.pause();
                    }
                }
            }
        }

        // 2. ARROWS UP/DOWN: Scroll Shorts
        if (isShortsView && shortsContainer) {
            if (e.code === 'ArrowDown') {
                e.preventDefault();
                shortsContainer.scrollBy({ top: 600, behavior: 'smooth' });
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                shortsContainer.scrollBy({ top: -600, behavior: 'smooth' });
            }
        }

        // 3. ARROWS LEFT/RIGHT: Seek in Video Player
        if (isVideoView && mainVideo) {
            if (e.code === 'ArrowRight') {
                e.preventDefault();
                mainVideo.currentTime = Math.min(mainVideo.duration, mainVideo.currentTime + 5);
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                mainVideo.currentTime = Math.max(0, mainVideo.currentTime - 5);
            }
        }
    });
}

function renderVideoCard(v, isMyChannel = false) {
    const thumb = v.thumbnailPath ? `/uploads/thumbnails/${v.thumbnailPath.split(/[/\\]/).pop()}` : null;
    const thumbHtml = thumb ? `<img src="${thumb}" class="thumb-img">` : `<div class="thumb-placeholder"><i class="fas fa-play"></i></div>`;
    const deleteBtn = isMyChannel ? `<button class="delete-video-btn" onclick="event.stopPropagation(); askDelete('${v.id}')"><i class="fas fa-trash"></i></button>` : '';

    const avaHtml = `<img src="${v.channelAvatar || '/assets/avatar-placeholder.svg'}" style="width:24px;height:24px;border-radius:50%;margin-right:5px;vertical-align:middle;cursor:pointer" onclick="event.stopPropagation(); openChannel('${v.ownerChannelId}')">`;

    return `
        <div class="video-card" onclick="openPlayer('${v.id}')">
            ${deleteBtn}
            <div style="aspect-ratio:16/9; overflow:hidden;">${thumbHtml}</div>
            <div class="video-meta">
                <h4>${v.title}</h4>
                <small>${avaHtml} ${v.channelName || ''}</small>
            </div>
        </div>`;
}

window.askDelete = (id) => { deleteVideoId = id; openModal('confirm-modal'); };
window.openChannel = async (channelId) => {
    try {
        const res = await apiFetch(`/channels/${channelId}`);
        if (!res) return;
        const ch = await res.json();

        navigateTo('other-channel-view');
        document.getElementById('oc-name').innerText = ch.channelName;
        document.getElementById('oc-tag').innerText = ch.channelTag;
        document.getElementById('oc-avatar').src = ch.avatarPath;
        document.getElementById('oc-subs-count').innerText = `${ch.subscribersCount} подписчиков`;

        const subBtn = document.getElementById('oc-sub-btn');
        if (currentUser && ch.ownerUserId === currentUser.id) {
            subBtn.style.display = 'none';
        } else {
            subBtn.style.display = 'block';
            subBtn.textContent = ch.isSubscribed ? 'Вы подписаны' : 'Подписаться';
            if (ch.isSubscribed) subBtn.classList.add('neon-btn-secondary');
            else subBtn.classList.remove('neon-btn-secondary');

            subBtn.onclick = async () => {
                const res = await apiFetch('/subscriptions/toggle', { method: 'POST', body: JSON.stringify({ channelId: ch.id }) });
                if (res) openChannel(channelId);
            };
        }

        const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
        const vids = await vRes.json();
        document.getElementById('oc-videos-list').innerHTML = vids.map(v => renderVideoCard(v, false)).join('');
    } catch (e) { showToast(e.message, 'error'); }
};

async function loadVideoFeed() {
    try {
        const res = await apiFetch('/videos?isShort=false');
        if (!res) return;
        const videos = await res.json();
        document.getElementById('video-list').innerHTML = videos.map(v => renderVideoCard(v, false)).join('');
    } catch (e) { }
}

async function loadSubscriptions() {
    try {
        const res = await apiFetch('/subscriptions');
        if (!res) return;
        const subs = await res.json();
        const container = document.getElementById('subscriptions-list');
        if (subs.length === 0) container.innerHTML = '<p style="color:#777;grid-column:1/-1;text-align:center">Нет подписок</p>';
        else {
            container.innerHTML = subs.map(s => `
                <div class="profile-card" style="padding:20px;cursor:pointer" onclick="openChannel('${s.id}')">
                    <img src="${s.avatarPath}" style="width:60px;height:60px;border-radius:50%;margin-bottom:10px">
                    <h3>${s.channelName}</h3>
                    <small>${s.subscribersCount} подписчиков</small>
                </div>
            `).join('');
        }
    } catch (e) { }
}

async function loadMyChannel() {
    try {
        const res = await apiFetch('/channels/my');
        if (!res) return;
        const ch = await res.json();
        if (!ch) {
            document.getElementById('create-channel-ui').classList.remove('hidden');
            document.getElementById('channel-view-ui').classList.add('hidden');
        } else {
            document.getElementById('create-channel-ui').classList.add('hidden');
            document.getElementById('channel-view-ui').classList.remove('hidden');
            document.getElementById('ch-view-name').innerText = ch.channelName;
            document.getElementById('ch-view-tag').innerText = ch.channelTag;
            window.currentChannelId = ch.id;

            // Restore Edit button functionality
            const editBtn = document.getElementById('edit-channel-hero-btn');
            if (editBtn) {
                editBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    document.getElementById('edit-ch-name').value = ch.channelName;
                    document.getElementById('edit-ch-tag').value = ch.channelTag;
                    openModal('edit-channel-modal');
                };
            }

            loadChannelVideos('videos'); // Default tab
        }
    } catch (e) {
        console.error(e);
        showToast('Ошибка загрузки канала', 'error');
    }
}

window.switchChannelTab = (type) => {
    document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`ch-tab-${type}`).classList.add('active');
    loadChannelVideos(type);
};

async function loadChannelVideos(type) {
    if (!window.currentChannelId) return;
    try {
        const isShort = type === 'shorts';
        const vRes = await apiFetch(`/videos?channelId=${window.currentChannelId}&isShort=${isShort}`);
        if (vRes) {
            const vids = await vRes.json();
            const list = document.getElementById('ch-videos-list');
            if (vids.length === 0) {
                list.innerHTML = `
                    <div class="not-found-msg">
                        <i class="fas fa-video-slash"></i>
                        <p>${isShort ? 'Шортсы не найдены' : 'Видео не найдены'}</p>
                    </div>`;
            } else {
                list.innerHTML = vids.map(v => renderVideoCard(v, true)).join('');
            }
        }
    } catch (e) { }
}

async function renderShortsList(videos) {
    const container = document.getElementById('shorts-container');
    container.innerHTML = '';

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const vid = entry.target.querySelector('video');
            if (entry.isIntersecting) {
                document.querySelectorAll('.short-video').forEach(v => { if (v !== vid) { v.pause(); v.currentTime = 0; } });
                vid.parentElement.style.opacity = '1';
                vid.controls = false;
                vid.play().catch(() => {
                    vid.muted = true;
                    vid.play();
                });
            } else {
                vid.pause();
            }
        });
    }, { threshold: 0.6 });

    for (const v of videos) {
        const dRes = await apiFetch(`/videos/${v.id}/details`);
        const details = await dRes.json();

        const el = document.createElement('div');
        el.className = 'short-item';
        el.innerHTML = `
            <div style="width:100%;height:100%;position:relative" class="short-video-container">
                <video id="vid-${v.id}" src="/api/stream/${v.filename}" class="short-video" loop playsinline></video>
            </div>
            <div class="short-overlay">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
                    <div class="avatar-frame avatar-sm" onclick="event.stopPropagation(); window.openChannel('${v.ownerChannelId}')" style="cursor:pointer">
                        <img src="${v.channelAvatar}" class="avatar-img">
                    </div>
                    <span style="font-weight:bold;cursor:pointer;text-shadow:0 0 5px #000" onclick="event.stopPropagation(); window.openChannel('${v.ownerChannelId}')">${v.channelName}</span>
                    ${(currentUser && currentUser.id !== v.ownerUserId) ?
                `<button id="s-sub-${v.id}" class="neon-btn-lg ${details.isSubscribed ? 'subscribed' : ''}"
                            onclick="event.stopPropagation(); toggleShortSub('${v.ownerChannelId}', 's-sub-${v.id}')" 
                            style="margin-left:10px; font-size: 0.8rem; padding: 5px 15px; height:auto; border-radius:12px;
                            ${details.isSubscribed ? 'border-color:#25D366;color:#25D366;box-shadow:0 0 10px #25D366;background:rgba(37,211,102,0.1)' : ''}">
                            ${details.isSubscribed ? 'Вы подписаны' : 'Подписаться'}
                        </button>` : ''}
                </div>

                <div class="short-desc-container">
                     <h3 style="margin-bottom:5px;text-shadow:0 0 5px #000">${v.title}</h3>
                     ${v.description ? `
                         <div id="desc-${v.id}" class="short-desc" onclick="event.stopPropagation()">
                             ${v.description}
                         </div>
                         ${v.description.length > 30 ? `<span class="desc-more-btn" onclick="event.stopPropagation(); toggleShortDesc('${v.id}')">Ещё</span>` : ''}
                     ` : ''}
                </div>
            </div>
            <div class="short-controls">
                <div class="short-btn ${details.userReaction === 'like' ? 'active' : ''}" onclick="event.stopPropagation(); toggleShortLike('${v.id}', this)">
                    <i class="fas fa-heart"></i>
                </div>
                <span class="short-count" id="s-likes-${v.id}">${details.likes}</span>
                <div class="short-btn" onclick="event.stopPropagation(); toggleShortComments('${v.id}')">
                    <i class="fas fa-comment"></i>
                </div>
                <span class="short-count">${details.comments.length}</span>
                <div class="short-btn" onclick="event.stopPropagation(); shareVideo('${v.id}')">
                    <i class="fas fa-share"></i>
                </div>
                <span class="short-count">Share</span>
            </div>
            <div id="s-comments-${v.id}" class="short-comments-panel" 
                 onwheel="event.stopImmediatePropagation()" 
                 ontouchstart="event.stopImmediatePropagation()" 
                 ontouchmove="event.stopImmediatePropagation()" 
                 onclick="event.stopImmediatePropagation()">
                <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <span>Комментарии</span>
                    <i class="fas fa-times" onclick="toggleShortComments('${v.id}')" style="cursor:pointer;font-size:1.2rem;"></i>
                </div>
                <div class="panel-input">
                    <input type="text" class="neon-input" placeholder="Написать..." id="s-input-${v.id}" style="margin:0" onkeydown="if(event.key==='Enter') sendShortComment('${v.id}')">
                    <button class="neon-btn-secondary" onclick="sendShortComment('${v.id}')"><i class="fas fa-paper-plane"></i></button>
                </div>
                <div class="panel-body" id="s-comments-list-${v.id}">
                    ${details.comments.length ? details.comments.map(c => `
                        <div class="comment-item">
                            <div class="comment-content">
                                <span class="comment-author">${c.username}</span>
                                <p class="comment-text">${c.text}</p>
                            </div>
                        </div>
                    `).join('') : '<p class="text-center" style="color:#777;padding:20px">Нет комментариев</p>'}
                </div>
            </div>`;
        const vid = el.querySelector('video');
        attachPauseFX(el, vid);
        container.appendChild(el);
        observer.observe(el);
    }
}

async function loadShorts() {
    try {
        const res = await apiFetch('/videos?isShort=true');
        if (!res) return;
        const videos = await res.json();
        renderShortsList(videos);
    } catch (e) { }
}

function setupShortsScroll() {
    window.scrollShorts = (dir) => {
        const container = document.getElementById('shorts-container');
        container.scrollBy({ top: dir * 600, behavior: 'smooth' });
    };
}

// Shorts logic
window.toggleShortDesc = (id) => {
    const desc = document.getElementById(`desc-${id}`);
    const btn = desc.nextElementSibling;
    if (desc.classList.contains('expanded')) {
        desc.classList.remove('expanded');
        if (btn) btn.textContent = 'Ещё';
    } else {
        desc.classList.add('expanded');
        if (btn) btn.textContent = 'Скрыть';
    }
};

window.toggleShortPlay = (id) => {
    const v = document.getElementById(`vid-${id}`);
    const icon = document.getElementById(`play-icon-${id}`);

    // Ensure native controls are off
    v.controls = false;

    if (v.paused) {
        v.play().catch(e => console.log('Play failed:', e));
        if (icon) icon.style.display = 'none';
        v.parentElement.style.opacity = '1';
    } else {
        v.pause();
        if (icon) icon.style.display = 'block';
    }
};

// Shorts Subs
window.toggleShortSub = async (channelId, btnId) => {
    try {
        const btn = document.getElementById(btnId);
        const res = await apiFetch('/subscriptions/toggle', { method: 'POST', body: JSON.stringify({ channelId }) });
        if (!res) return;
        const data = await res.json();
        if (data.subscribed) {
            btn.classList.add('subscribed');
            btn.textContent = 'Вы подписаны';
            btn.style.borderColor = '#25D366';
            btn.style.color = '#25D366';
            btn.style.boxShadow = '0 0 10px #25D366';
            btn.style.background = 'rgba(37,211,102,0.1)';
        } else {
            btn.classList.remove('subscribed');
            btn.textContent = 'Подписаться';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.style.boxShadow = '';
            btn.style.background = '';
        }
        if (window.openChannel && document.getElementById('oc-sub-btn')) {
            // Optional: Update UI if channel page is open, but do NOT redirect
            // window.openChannel(channelId); 
            const ocBtn = document.getElementById('oc-sub-btn');
            if (ocBtn) {
                if (data.subscribed) {
                    ocBtn.innerText = 'Вы подписаны';
                    ocBtn.classList.add('neon-btn-secondary');
                } else {
                    ocBtn.innerText = 'Подписаться';
                    ocBtn.classList.remove('neon-btn-secondary');
                }
            }
        }
    } catch (e) { }
};

window.shareVideo = (videoId) => {
    const url = `${window.location.origin}/?v=${videoId}`;
    const modal = document.getElementById('share-modal');
    if (!modal) {
        // Fallback if modal is missing for some reason
        navigator.clipboard.writeText(url).then(() => showToast('Ссылка скопирована!'));
        return;
    }

    modal.classList.add('active');

    const wa = document.getElementById('share-wa');
    if (wa) wa.onclick = () => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent('Смотри это видео на AITUBE: ' + url)}`, '_blank');

    const tg = document.getElementById('share-tg');
    if (tg) tg.onclick = () => window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Смотри это видео на AITUBE')}`, '_blank');

    const copy = document.getElementById('share-copy');
    if (copy) {
        copy.onclick = async () => {
            try {
                await navigator.clipboard.writeText(url);
                showToast('Ссылка скопирована!', 'success');
                modal.classList.remove('active');
            } catch (err) {
                // Extreme fallback: show the link in a prompt
                window.prompt('Ваш браузер заблокировал копирование. Скопируйте ссылку вручную:', url);
                modal.classList.remove('active');
            }
        };
    }

    const cls = modal.querySelector('.close-modal');
    if (cls) cls.onclick = () => modal.classList.remove('active');

    // Close when clicking outside
    const closeModalHandler = (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
            window.removeEventListener('click', closeModalHandler);
        }
    };
    window.addEventListener('click', closeModalHandler);
};








window.toggleShortLike = async (vidId, btn) => {
    try {
        await apiFetch('/interact/like', { method: 'POST', body: JSON.stringify({ videoId: vidId, type: 'like' }) });
        btn.classList.toggle('active');
        const countEl = document.getElementById(`s-likes-${vidId}`);
        let count = parseInt(countEl.innerText);
        countEl.innerText = btn.classList.contains('active') ? count + 1 : Math.max(0, count - 1);
    } catch (e) { }
};

window.toggleShortComments = (vidId) => { document.getElementById(`s-comments-${vidId}`).classList.toggle('open'); };

window.sendShortComment = async (vidId) => {
    const input = document.getElementById(`s-input-${vidId}`);
    const text = input.value.trim();
    if (!text) return;
    try {
        await apiFetch('/interact/comment', { method: 'POST', body: JSON.stringify({ videoId: vidId, text }) });
        input.value = '';
        const list = document.getElementById(`s-comments-list-${vidId}`);
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.innerHTML = `
            <div class="comment-content">
                <span class="comment-author">Я</span>
                <p class="comment-text">${text}</p>
            </div>`;
        list.prepend(div);
    } catch (e) { showToast(e.message, 'error'); }
};

async function openPlayer(id) {
    navigateTo('video-player-view');
    const allRes = await apiFetch('/videos');
    const all = await allRes.json();
    const v = all.find(x => x.id === id);
    if (v) {
        const pContainer = document.querySelector('.player-wrapper');
        const p = document.getElementById('main-player');

        p.src = `/api/stream/${v.filename}`;
        attachPauseFX(pContainer, p);
        p.play().catch(() => { });

        document.getElementById('vp-title').innerText = v.title;

        // Setup Description
        const descEl = document.getElementById('vp-desc');
        const toggleBtn = document.getElementById('desc-toggle-btn');

        descEl.innerText = v.description || 'Нет описания';
        descEl.classList.remove('hidden');
        descEl.classList.add('collapsed');

        // Connect channel info
        const ava = document.getElementById('vp-channel-avatar');
        ava.src = v.channelAvatar || '/assets/avatar-placeholder.svg';
        document.getElementById('vp-channel-link').onclick = () => openChannel(v.ownerChannelId);

        // Remove old title click listener (if any)
        document.getElementById('vp-title').onclick = null;

        // Verify overflow for "Show more" button
        toggleBtn.style.display = 'none';
        toggleBtn.onclick = null;

        setTimeout(() => {
            // Check if content overflows. Use a more robust check.
            if (descEl.scrollHeight > 60) { // 60px is approx 3 lines with padding
                toggleBtn.style.display = 'flex';
                toggleBtn.innerHTML = 'Развернуть <i class="fas fa-chevron-down"></i>';

                toggleBtn.onclick = () => {
                    const isCollapsed = descEl.classList.contains('collapsed');
                    if (isCollapsed) {
                        descEl.classList.remove('collapsed');
                        toggleBtn.innerHTML = 'Свернуть <i class="fas fa-chevron-up"></i>';
                    } else {
                        descEl.classList.add('collapsed');
                        toggleBtn.innerHTML = 'Развернуть <i class="fas fa-chevron-down"></i>';
                    }
                };
            }
        }, 50);

        loadInteractions(id);
    }
}

async function checkChannelAndUpload() {
    try {
        const res = await apiFetch('/channels/my');
        if (!res) return;
        const ch = await res.json();
        if (!ch) { showToast('Создайте канал', 'error'); navigateTo('my-channel'); }
        else openModal('upload-modal');
    } catch (e) { }
}

async function loadInteractions(videoId) {
    try {
        const res = await apiFetch(`/videos/${videoId}/details`);
        if (!res) return;
        const data = await res.json();
        document.getElementById('likes-count').innerText = data.likes;
        document.getElementById('vp-subs-count').innerText = `${data.subscribersCount} подп.`;

        const likeBtn = document.getElementById('like-btn');
        likeBtn.style.color = data.userReaction === 'like' ? 'var(--primary)' : '#fff';
        likeBtn.onclick = async () => {
            try { await apiFetch('/interact/like', { method: 'POST', body: JSON.stringify({ videoId, type: data.userReaction === 'like' ? 'none' : 'like' }) }); loadInteractions(videoId); }
            catch (e) { }
        };

        const shareBtn = document.getElementById('share-btn');
        if (shareBtn) shareBtn.onclick = () => shareVideo(videoId);

        const subBtn = document.getElementById('sub-btn');
        subBtn.innerText = data.isSubscribed ? 'Вы подписаны' : 'Подписаться';
        subBtn.onclick = async () => {
            const vRes = await apiFetch('/videos');
            const vids = await vRes.json();
            const v = vids.find(x => x.id === videoId);
            if (v) {
                await apiFetch('/subscriptions/toggle', { method: 'POST', body: JSON.stringify({ channelId: v.ownerChannelId }) });
                loadInteractions(videoId);
            }
        };

        const commList = document.getElementById('comments-list');
        commList.innerHTML = data.comments.length ? data.comments.map(c => `
            <div class="comment-item">
                <div class="comment-content">
                    <span class="comment-author">${c.username}</span>
                    <p class="comment-text">${c.text}</p>
                </div>
            </div>`).join('') : '<p class="text-center" style="color:#777">Нет комментариев</p>';

        const sendBtn = document.getElementById('send-comment');
        const commInput = document.getElementById('comment-text');

        const submitComment = async () => {
            const txt = commInput.value.trim();
            if (txt) {
                await apiFetch('/interact/comment', { method: 'POST', body: JSON.stringify({ videoId, text: txt }) });
                commInput.value = '';
                loadInteractions(videoId);
            }
        };

        sendBtn.onclick = submitComment;
        commInput.onkeydown = (e) => {
            if (e.key === 'Enter') submitComment();
        };
    } catch (e) { }
}

function setupFileUploads() {
    const vInput = document.getElementById('video-file-input');
    if (vInput) vInput.onchange = (e) => { document.getElementById('video-file-display').innerText = e.target.files[0]?.name || ''; };
    const tInput = document.getElementById('thumb-file-input');
    const tPrev = document.getElementById('thumb-preview-img');
    if (tInput && tPrev) tInput.onchange = (e) => {
        const file = e.target.files[0];
        document.getElementById('thumb-file-display').innerText = file?.name || '';
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => { tPrev.src = ev.target.result; tPrev.classList.remove('hidden'); };
            reader.readAsDataURL(file);
        } else { tPrev.classList.add('hidden'); }
    };
    const aInput = document.getElementById('edit-avatar-file');
    if (aInput) aInput.onchange = (e) => { document.getElementById('avatar-preview-name').innerText = e.target.files[0]?.name || ''; };

    const chAInput = document.getElementById('edit-ch-avatar-input');
    if (chAInput) chAInput.onchange = (e) => { document.getElementById('edit-ch-avatar-display').innerText = e.target.files[0]?.name || ''; };
}

function setupDeleteModal() {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-cancel').onclick = () => modal.classList.remove('active');
    document.getElementById('confirm-ok').onclick = async () => {
        if (!deleteVideoId) return;
        try {
            await apiFetch(`/videos/${deleteVideoId}`, { method: 'DELETE' });
            showToast('Видео удалено');
            modal.classList.remove('active');
            loadMyChannel();
        } catch (e) { showToast(e.message, 'error'); }
    };
}

function initLavaLamp() {
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isReduced) return;
    const zones = document.querySelectorAll('.lava-zone');
    zones.forEach(z => {
        z.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const b = document.createElement('div');
            b.className = 'lava-bubble ' + (Math.random() > 0.4 ? 'pill' : '');
            const s = Math.floor(Math.random() * 60) + 30;
            b.style.width = `${s}px`; b.style.height = b.classList.contains('pill') ? `${s * 1.6}px` : `${s}px`;
            b.style.left = `${Math.floor(Math.random() * 80) + 10}%`;
            b.style.setProperty('--duration', `${Math.floor(Math.random() * 15) + 15}s`);
            b.style.setProperty('--delay', `${Math.floor(Math.random() * -30)}s`);
            b.style.setProperty('--opacity', (Math.random() * 0.3) + 0.2);
            z.appendChild(b);
        }
    });
}

// --- SIMPLE PAUSE OVERLAY ---
function createSimplePauseOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'simple-pause-overlay';
    overlay.innerHTML = '<i class="fas fa-pause"></i>';
    return overlay;
}

function attachPauseFX(container, video) {
    const existing = container.querySelector('.simple-pause-overlay');
    if (existing) existing.remove();
    const overlay = createSimplePauseOverlay();
    container.appendChild(overlay);

    const toggle = (e) => {
        if (e) {
            // Respect native controls click
            if (e.target.tagName === 'VIDEO' && e.target.controls) return;
            if (['BUTTON', 'INPUT', 'TEXTAREA', 'A'].includes(e.target.tagName)) return;
            if (e.target.closest('.short-controls') || e.target.closest('.short-comments-panel')) return;
        }

        if (video.paused) {
            video.play().catch(err => console.log('Play err:', err));
        } else {
            video.pause();
        }
    };

    container.onclick = toggle;

    video.onplay = () => overlay.classList.remove('visible');
    video.onpause = () => overlay.classList.add('visible');

    if (video.paused) overlay.classList.add('visible');
    else overlay.classList.remove('visible');
}
