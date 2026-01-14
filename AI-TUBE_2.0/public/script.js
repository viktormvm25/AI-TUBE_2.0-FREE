const API_URL = '/api';
let currentUser = null;
let deleteVideoId = null;

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
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
            if(currentUser) currentUser.token = token;
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
            try { const d = await res.json(); errorMsg = d.error || errorMsg; } catch (e) {}
            if(errorMsg === 'Username taken') errorMsg = 'Логин занят';
            throw new Error(errorMsg);
        }
        return res;
    } catch (e) { throw e; }
}

document.addEventListener('DOMContentLoaded', async () => {
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
            if(video) { video.pause(); video.src = ""; }
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
    if(s) { s.classList.add('exit'); setTimeout(() => { s.classList.add('hidden'); s.classList.remove('exit'); }, 800); }
}

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

function showGreeting(name) {
    const overlay = document.getElementById('greeting-overlay');
    const text = document.getElementById('greeting-text');
    if(overlay && text) {
        text.innerText = `Приветствую, ${name}`;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 2500);
    }
}

function navigateTo(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.target === viewId));
    
    if (viewId === 'video-feed') loadVideoFeed();
    if (viewId === 'shorts-feed') loadShorts();
    if (viewId === 'my-channel') loadMyChannel();
    if (viewId === 'subscriptions-view') loadSubscriptions();
    if (viewId === 'profile-view') updateUI();
}

function updateUI() {
    if(!currentUser) return;
    if(currentUser.theme === 'neon-purple') document.body.classList.add('theme-purple');
    else document.body.classList.remove('theme-purple');
    
    if(document.getElementById('profile-name')) document.getElementById('profile-name').innerText = currentUser.name;
    if(document.getElementById('profile-username')) document.getElementById('profile-username').innerText = currentUser.username;
    if(document.getElementById('profile-avatar')) document.getElementById('profile-avatar').src = currentUser.avatarPath || '/assets/avatar-placeholder.svg';
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
            saveAuth(currentUser.token, user);
            updateUI();
        }
    } catch (e) {}
}

function setupForms() {
    const logForm = document.getElementById('login-form');
    if(logForm) logForm.onsubmit = (e) => {
        e.preventDefault();
        if(!logForm.reportValidity()) return;
        login(document.getElementById('login-username').value.trim(), document.getElementById('login-password').value.trim());
    };

    const regForm = document.getElementById('register-form');
    if(regForm) regForm.onsubmit = (e) => {
        e.preventDefault();
        if(!regForm.reportValidity()) return;
        register(document.getElementById('reg-name').value.trim(), document.getElementById('reg-username').value.trim(), document.getElementById('reg-password').value.trim());
    };

    const upForm = document.getElementById('upload-form');
    if(upForm) upForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
            const chRes = await apiFetch('/channels/my');
            if(!chRes) return;
            const ch = await chRes.json();
            if(!ch) { showToast('Сначала создайте канал', 'error'); return; }

            const fd = new FormData(e.target);
            fd.append('channelId', ch.id);
            const res = await apiFetch('/videos', { method: 'POST', body: fd });
            if(res) { showToast('Опубликовано!'); closeModal('upload-modal'); e.target.reset(); loadMyChannel(); }
        } catch(e) { showToast(e.message, 'error'); }
    };

    const chForm = document.getElementById('create-channel-form');
    if(chForm) chForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { if(await apiFetch('/channels', { method: 'POST', body: fd })) { showToast('Канал создан'); loadMyChannel(); } }
        catch(e) { showToast(e.message, 'error'); }
    };

    const profForm = document.getElementById('profile-edit-form');
    if(profForm) profForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData();
        const name = document.getElementById('edit-name').value;
        const pass = document.getElementById('edit-pass').value;
        const file = document.getElementById('edit-avatar-file').files[0];
        if(name) fd.append('name', name);
        if(pass) fd.append('password', pass);
        if(file) fd.append('avatar', file);
        try { if(await apiFetch('/users/update', { method: 'POST', body: fd })) { showToast('Обновлено'); checkAuth(); } }
        catch(e) { showToast(e.message, 'error'); }
    };

    document.getElementById('toggle-theme').onclick = async () => {
        const newTheme = document.body.classList.contains('theme-purple') ? 'neon-blue' : 'neon-purple';
        document.body.classList.toggle('theme-purple');
        try {
            await apiFetch('/users/update', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ theme: newTheme }) });
            if(currentUser) { currentUser.theme = newTheme; localStorage.setItem('user', JSON.stringify(currentUser)); }
        } catch(e) {}
    };

    document.getElementById('delete-acc-btn').onclick = async () => {
        if(confirm('Удалить аккаунт навсегда?')) { 
            try { 
                await apiFetch('/auth/delete', {method:'POST'}); 
                logout('Аккаунт удален'); 
            } catch(e) { showToast(e.message, 'error'); } 
        }
    };
    
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('active'));
}

function setupNavigation() {
    const toReg = document.getElementById('to-register');
    if (toReg) toReg.onclick = () => { document.getElementById('login-form').classList.add('hidden'); document.getElementById('register-form').classList.remove('hidden'); };
    
    const toLog = document.getElementById('to-login');
    if (toLog) toLog.onclick = () => { document.getElementById('register-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); };
    
    const drawer = document.getElementById('drawer');
    const drawerToggle = document.getElementById('drawer-toggle');
    if (drawerToggle) drawerToggle.onclick = () => drawer.classList.add('open');
    
    const drawerBack = document.getElementById('drawer-backdrop');
    if (drawerBack) drawerBack.onclick = () => drawer.classList.remove('open');
    
    document.querySelectorAll('.drawer-item').forEach(item => {
        item.onclick = () => {
            if(item.id === 'logout-btn') logout();
            else { navigateTo(item.dataset.target); drawer.classList.remove('open'); }
        }
    });
    
    document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => navigateTo(btn.dataset.target));
    
    const upBtn = document.getElementById('header-upload-btn');
    if (upBtn) upBtn.onclick = () => checkChannelAndUpload();
    
    const upHero = document.getElementById('upload-video-hero-btn');
    if (upHero) upHero.onclick = () => openModal('upload-modal');
    
    const backBtn = document.getElementById('back-feed-btn');
    if (backBtn) backBtn.onclick = () => {
        const video = document.getElementById('main-player');
        if(video) { video.pause(); video.src = ""; }
        navigateTo('video-feed');
    };
}

function renderVideoCard(v, isMyChannel = false) {
    const thumb = v.thumbnailPath ? `/uploads/thumbnails/${v.thumbnailPath.split(/[/\\]/).pop()}` : null;
    const thumbHtml = thumb ? `<img src="${thumb}" class="thumb-img">` : `<div class="thumb-placeholder"><i class="fas fa-play"></i></div>`;
    const deleteBtn = isMyChannel ? `<button class="delete-video-btn" onclick="event.stopPropagation(); askDelete('${v.id}')"><i class="fas fa-trash"></i></button>` : '';
    
    const avaHtml = `<img src="${v.channelAvatar||'/assets/avatar-placeholder.svg'}" style="width:24px;height:24px;border-radius:50%;margin-right:5px;vertical-align:middle;cursor:pointer" onclick="event.stopPropagation(); openChannel('${v.ownerChannelId}')">`;

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
        if(!res) return;
        const ch = await res.json();
        
        navigateTo('other-channel-view');
        document.getElementById('oc-name').innerText = ch.channelName;
        document.getElementById('oc-tag').innerText = ch.channelTag;
        document.getElementById('oc-avatar').src = ch.avatarPath;
        document.getElementById('oc-subs-count').innerText = `${ch.subscribersCount} подписчиков`;
        
        const subBtn = document.getElementById('oc-sub-btn');
        subBtn.innerText = ch.isSubscribed ? 'Вы подписаны' : 'Подписаться';
        subBtn.onclick = async () => {
            await apiFetch('/subscriptions/toggle', {method: 'POST', body: JSON.stringify({channelId: ch.id})});
            window.openChannel(channelId);
        };

        const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
        const vids = await vRes.json();
        document.getElementById('oc-videos-list').innerHTML = vids.map(v => renderVideoCard(v, false)).join('');
    } catch(e) { showToast(e.message, 'error'); }
};

async function loadVideoFeed() {
    try {
        const res = await apiFetch('/videos?isShort=false');
        if(!res) return;
        const videos = await res.json();
        document.getElementById('video-list').innerHTML = videos.map(v => renderVideoCard(v, false)).join('');
    } catch(e) {}
}

async function loadSubscriptions() {
    try {
        const res = await apiFetch('/subscriptions');
        if(!res) return;
        const subs = await res.json();
        const container = document.getElementById('subscriptions-list');
        if(subs.length === 0) container.innerHTML = '<p style="color:#777;grid-column:1/-1;text-align:center">Нет подписок</p>';
        else {
            container.innerHTML = subs.map(s => `
                <div class="profile-card" style="padding:20px;cursor:pointer" onclick="openChannel('${s.id}')">
                    <img src="${s.avatarPath}" style="width:60px;height:60px;border-radius:50%;margin-bottom:10px">
                    <h3>${s.channelName}</h3>
                    <small>${s.subscribersCount} подписчиков</small>
                </div>
            `).join('');
        }
    } catch(e) {}
}

async function loadMyChannel() {
    try {
        const res = await apiFetch('/channels/my');
        if(!res) return;
        const ch = await res.json();
        if(!ch) {
            document.getElementById('create-channel-ui').classList.remove('hidden');
            document.getElementById('channel-view-ui').classList.add('hidden');
        } else {
            document.getElementById('create-channel-ui').classList.add('hidden');
            document.getElementById('channel-view-ui').classList.remove('hidden');
            document.getElementById('ch-view-name').innerText = ch.channelName;
            
            const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
            if(vRes) {
                const vids = await vRes.json();
                document.getElementById('ch-videos-list').innerHTML = vids.map(v => renderVideoCard(v, true)).join('');
            }
        }
    } catch(e) {}
}

async function loadShorts() {
    try {
        const res = await apiFetch('/videos?isShort=true');
        if(!res) return;
        const videos = await res.json();
        const container = document.getElementById('shorts-container');
        container.innerHTML = '';

        for (const v of videos) {
            const dRes = await apiFetch(`/videos/${v.id}/details`);
            const details = await dRes.json();
            
            const el = document.createElement('div');
            el.className = 'short-item';
            el.innerHTML = `
                <video src="/api/stream/${v.filename}" class="short-video" loop playsinline></video>
                <div class="short-overlay" onclick="openChannel('${v.ownerChannelId}')">
                    <h3>${v.title}</h3>
                    <small>@${v.channelTag || 'user'}</small>
                </div>
                <div class="short-controls">
                    <div class="short-btn ${details.userReaction==='like'?'active':''}" onclick="toggleShortLike('${v.id}', this)">
                        <i class="fas fa-heart"></i>
                    </div>
                    <span class="short-count" id="s-likes-${v.id}">${details.likes}</span>
                    <div class="short-btn" onclick="toggleShortComments('${v.id}')">
                        <i class="fas fa-comment"></i>
                    </div>
                    <span class="short-count">${details.comments.length}</span>
                </div>
                <div id="s-comments-${v.id}" class="short-comments-panel">
                    <div class="panel-header"><span>Комментарии</span><i class="fas fa-times" onclick="toggleShortComments('${v.id}')" style="cursor:pointer"></i></div>
                    <div class="panel-body" id="s-comments-list-${v.id}">
                        ${details.comments.map(c => `<div style="margin-bottom:10px"><small style="color:var(--primary)">${c.username}</small><br>${c.text}</div>`).join('')}
                    </div>
                    <div class="panel-input">
                        <input type="text" class="neon-input" placeholder="..." id="s-input-${v.id}" style="margin:0">
                        <button class="neon-btn-secondary" onclick="sendShortComment('${v.id}')"><i class="fas fa-paper-plane"></i></button>
                    </div>
                </div>`;
            const vid = el.querySelector('video');
            attachPauseFX(el, vid); 
            container.appendChild(el);
        }
    } catch(e) {}
}

function setupShortsScroll() {
    window.scrollShorts = (dir) => {
        const container = document.getElementById('shorts-container');
        container.scrollBy({ top: dir * 600, behavior: 'smooth' }); 
    };
}

window.toggleShortLike = async (vidId, btn) => {
    try {
        await apiFetch('/interact/like', { method: 'POST', body: JSON.stringify({ videoId: vidId, type: 'like' }) });
        btn.classList.toggle('active');
        const countEl = document.getElementById(`s-likes-${vidId}`);
        let count = parseInt(countEl.innerText);
        countEl.innerText = btn.classList.contains('active') ? count + 1 : Math.max(0, count - 1);
    } catch(e) {}
};

window.toggleShortComments = (vidId) => { document.getElementById(`s-comments-${vidId}`).classList.toggle('open'); };

window.sendShortComment = async (vidId) => {
    const input = document.getElementById(`s-input-${vidId}`);
    const text = input.value.trim();
    if(!text) return;
    try {
        await apiFetch('/interact/comment', { method: 'POST', body: JSON.stringify({ videoId: vidId, text }) });
        input.value = '';
        const list = document.getElementById(`s-comments-list-${vidId}`);
        const div = document.createElement('div');
        div.innerHTML = `<div style="margin-bottom:10px"><small style="color:var(--primary)">Я</small><br>${text}</div>`;
        list.prepend(div.firstChild);
    } catch(e) { showToast(e.message, 'error'); }
};

async function openPlayer(id) {
    navigateTo('video-player-view');
    const allRes = await apiFetch('/videos');
    const all = await allRes.json();
    const v = all.find(x => x.id === id);
    if(v) {
        const pContainer = document.querySelector('.player-wrapper');
        const p = document.getElementById('main-player');
        
        // Remove old fx
        const old = pContainer.querySelector('.pause-overlay');
        if(old) old.remove();
        pContainer.onclick = null;

        p.src = `/api/stream/${v.filename}`;
        
        // Add fx
        attachPauseFX(pContainer, p);
        
        p.play().catch(()=>{});

        document.getElementById('vp-title').innerText = v.title;
        document.getElementById('vp-desc').innerText = v.description || 'Нет описания';
        document.getElementById('vp-desc').classList.add('hidden');
        
        const ava = document.getElementById('vp-channel-avatar');
        ava.src = v.channelAvatar || '/assets/avatar-placeholder.svg';
        document.getElementById('vp-channel-link').onclick = () => openChannel(v.ownerChannelId);
        
        document.getElementById('vp-title').onclick = () => document.getElementById('vp-desc').classList.toggle('hidden');
        
        loadInteractions(id);
    }
}

async function checkChannelAndUpload() {
    try {
        const res = await apiFetch('/channels/my');
        if(!res) return;
        const ch = await res.json();
        if(!ch) { showToast('Создайте канал', 'error'); navigateTo('my-channel'); }
        else openModal('upload-modal');
    } catch(e) {}
}

async function loadInteractions(videoId) {
    try {
        const res = await apiFetch(`/videos/${videoId}/details`);
        if(!res) return;
        const data = await res.json();
        document.getElementById('likes-count').innerText = data.likes;
        document.getElementById('vp-subs-count').innerText = `${data.subscribersCount} подп.`;
        
        const likeBtn = document.getElementById('like-btn');
        likeBtn.style.color = data.userReaction === 'like' ? 'var(--primary)' : '#fff';
        likeBtn.onclick = async () => {
            try { await apiFetch('/interact/like', { method: 'POST', body: JSON.stringify({ videoId, type: data.userReaction === 'like' ? 'none' : 'like' }) }); loadInteractions(videoId); }
            catch(e) {}
        };
        
        const subBtn = document.getElementById('sub-btn');
        subBtn.innerText = data.isSubscribed ? 'Вы подписаны' : 'Подписаться';
        subBtn.onclick = async () => {
            const vRes = await apiFetch('/videos'); 
            const vids = await vRes.json();
            const v = vids.find(x => x.id === videoId);
            if(v) {
                await apiFetch('/subscriptions/toggle', {method: 'POST', body: JSON.stringify({channelId: v.ownerChannelId})});
                loadInteractions(videoId);
            }
        };
        
        const commList = document.getElementById('comments-list');
        commList.innerHTML = data.comments.length ? data.comments.map(c => `
            <div style="margin-bottom:10px; padding:10px; background:rgba(255,255,255,0.05); border-radius:8px;">
                <small style="color:var(--primary)">${c.username}</small><p style="margin:0">${c.text}</p>
            </div>`).join('') : '<p class="text-center" style="color:#777">Нет комментариев</p>';
        
        const sendBtn = document.getElementById('send-comment');
        sendBtn.onclick = async () => {
            const txt = document.getElementById('comment-text');
            if(txt.value.trim()) { 
                await apiFetch('/interact/comment', {method:'POST', body:JSON.stringify({videoId, text:txt.value})}); 
                txt.value=''; loadInteractions(videoId); 
            }
        };
    } catch(e) {}
}

function setupFileUploads() {
    const vInput = document.getElementById('video-file-input');
    if(vInput) vInput.onchange = (e) => { document.getElementById('video-file-display').innerText = e.target.files[0]?.name || ''; };
    const tInput = document.getElementById('thumb-file-input');
    const tPrev = document.getElementById('thumb-preview-img');
    if(tInput && tPrev) tInput.onchange = (e) => {
        const file = e.target.files[0];
        document.getElementById('thumb-file-display').innerText = file?.name || '';
        if(file) {
            const reader = new FileReader();
            reader.onload = (ev) => { tPrev.src = ev.target.result; tPrev.classList.remove('hidden'); };
            reader.readAsDataURL(file);
        } else { tPrev.classList.add('hidden'); }
    };
    const aInput = document.getElementById('edit-avatar-file');
    if(aInput) aInput.onchange = (e) => { document.getElementById('avatar-preview-name').innerText = e.target.files[0]?.name || ''; };
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
        } catch(e) { showToast(e.message, 'error'); }
    };
}

function initLavaLamp() {
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(isReduced) return;
    const zones = document.querySelectorAll('.lava-zone');
    zones.forEach(z => {
        z.innerHTML = '';
        for(let i=0; i<8; i++) {
            const b = document.createElement('div');
            b.className = 'lava-bubble ' + (Math.random()>0.4?'pill':'');
            const s = Math.floor(Math.random()*60)+30;
            b.style.width=`${s}px`; b.style.height=b.classList.contains('pill')?`${s*1.6}px`:`${s}px`;
            b.style.left=`${Math.floor(Math.random()*80)+10}%`;
            b.style.setProperty('--duration',`${Math.floor(Math.random()*15)+15}s`);
            b.style.setProperty('--delay',`${Math.floor(Math.random()*-30)}s`);
            b.style.setProperty('--opacity',(Math.random()*0.3)+0.2);
            z.appendChild(b);
        }
    });
}

// --- FX ---
function createPauseOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';
    overlay.innerHTML = `
        <div class="pause-icon"><i class="fas fa-pause"></i></div>
        <div class="fx-container">
            <div class="fx-ripple"></div>
            <div class="fx-burst">
                ${Array.from({length: 8}).map((_, i) => `<div class="fx-particle" style="--angle:${i * 45}deg"></div>`).join('')}
            </div>
        </div>`;
    return overlay;
}

function attachPauseFX(container, video) {
    const overlay = createPauseOverlay();
    container.appendChild(overlay);
    const ripple = overlay.querySelector('.fx-ripple');
    const burst = overlay.querySelector('.fx-burst');

    const updateState = () => {
        if (video.paused) { overlay.classList.add('is-visible'); } 
        else { overlay.classList.remove('is-visible'); triggerPlayFX(ripple, burst); }
    };

    container.onclick = (e) => {
        if(['I', 'BUTTON', 'INPUT'].includes(e.target.tagName)) return;
        video.paused ? video.play() : video.pause();
        updateState();
    };

    video.onpause = () => overlay.classList.add('is-visible');
    video.onplay = () => overlay.classList.remove('is-visible');
    if (video.paused) overlay.classList.add('is-visible');
}

function triggerPlayFX(ripple, burst) {
    ripple.classList.remove('animate'); burst.classList.remove('animate');
    void ripple.offsetWidth;
    ripple.classList.add('animate'); burst.classList.add('animate');
}