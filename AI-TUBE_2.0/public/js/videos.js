/* ==========================================
   VIDEOS.JS - Видео, подписки, плеер
   ========================================== */

import { apiFetch, currentUser } from './api.js';
import { showToast, openModal, closeModal } from './ui.js';
import { attachPauseFX } from './player.js';

export let deleteVideoId = null;

export function setDeleteVideoId(id) {
    deleteVideoId = id;
}

export function renderVideoCard(v, isMyChannel = false, forceIsShort = false) {
    const thumb = v.thumbnailPath || null;
    const thumbHtml = thumb ? `<img src="${thumb}" class="thumb-img">` : `<div class="thumb-placeholder"><i class="fas fa-play"></i></div>`;
    const deleteBtn = isMyChannel ? `<button class="delete-video-btn" onclick="event.stopPropagation(); window.askDelete('${v.id}')"><i class="fas fa-trash"></i></button>` : '';

    const avaHtml = `<img src="${v.channelAvatar || '/assets/avatar-placeholder.svg'}" style="width:24px;height:24px;border-radius:50%;margin-right:5px;vertical-align:middle;cursor:pointer" onclick="event.stopPropagation(); window.openChannel('${v.ownerChannelId}')">`;

    const isShort = v.isShort || forceIsShort;
    const clickFn = isShort ? `window.openShort('${v.id}')` : `window.openPlayer('${v.id}')`;

    return `
        <div class="video-card" onclick="${clickFn}">
            ${deleteBtn}
            <div style="aspect-ratio:16/9; overflow:hidden;">${thumbHtml}</div>
            <div class="video-meta">
                <h4>${v.title}</h4>
                <small>${avaHtml} ${v.channelName || ''}</small>
            </div>
        </div>`;
}

export async function loadVideoFeed(renderVideoCard) {
    try {
        const res = await apiFetch('/videos?isShort=false');
        if (!res) return;
        const videos = await res.json();
        const list = document.getElementById('video-list');
        if (videos.length === 0) {
            list.innerHTML = `
                <div class="not-found-msg">
                    <i class="fas fa-video-slash"></i>
                    <p>Видео не найдены</p>
                </div>`;
        } else {
            list.innerHTML = videos.map(v => renderVideoCard(v, false)).join('');
        }
    } catch (e) { }
}

export async function loadSubscriptions() {
    try {
        const res = await apiFetch('/subscriptions');
        if (!res) return;
        const subs = await res.json();
        const container = document.getElementById('subscriptions-list');
        if (subs.length === 0) container.innerHTML = '<p style="color:#777;grid-column:1/-1;text-align:center">Нет подписок</p>';
        else {
            container.innerHTML = subs.map(s => `
                <div class="profile-card" style="padding:20px;cursor:pointer" onclick="window.openChannel('${s.id}')">
                    <img src="${s.avatarPath}" style="width:60px;height:60px;border-radius:50%;margin-bottom:10px">
                    <h3>${s.channelName}</h3>
                    <small>${s.subscribersCount} подписчиков</small>
                </div>
            `).join('');
        }
    } catch (e) { }
}

export async function openPlayer(id, navigateTo, updateUrl = true) {
    navigateTo('video-player-view');
    if (updateUrl) {
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('v', id);
        window.history.pushState({}, '', newUrl);
    }
    const allRes = await apiFetch('/videos');
    const all = await allRes.json();
    const v = all.find(x => x.id === id);
    if (v) {
        const pContainer = document.querySelector('.player-wrapper');
        const p = document.getElementById('main-player');

        p.src = v.videoUrl;

        if (v.thumbnailPath) {
            pContainer.style.backgroundImage = `url('${v.thumbnailPath}')`;
        } else {
            pContainer.style.backgroundImage = 'none';
        }

        attachPauseFX(pContainer, p);
        p.play().catch(() => { });

        document.getElementById('vp-title').innerText = v.title;

        const descEl = document.getElementById('vp-desc');
        const toggleBtn = document.getElementById('desc-toggle-btn');

        descEl.innerText = v.description || 'Нет описания';
        descEl.classList.remove('hidden');
        descEl.classList.add('collapsed');

        const ava = document.getElementById('vp-channel-avatar');
        const avaUrl = v.channelAvatar || '/assets/avatar-placeholder.svg';
        ava.src = avaUrl;
        document.getElementById('vp-channel-link').onclick = () => window.openChannel(v.ownerChannelId);

        document.getElementById('vp-title').onclick = null;

        toggleBtn.style.display = 'none';
        toggleBtn.onclick = null;

        setTimeout(() => {
            if (descEl.scrollHeight > 60) {
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

export async function checkChannelAndUpload(navigateTo) {
    try {
        const res = await apiFetch('/channels/my');
        if (!res) return;
        const ch = await res.json();
        if (!ch) { showToast('Создайте канал', 'error'); navigateTo('my-channel'); }
        else openModal('upload-modal');
    } catch (e) { }
}

export async function loadInteractions(videoId) {
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
        if (shareBtn) shareBtn.onclick = () => window.shareVideo(videoId);

        const subBtn = document.getElementById('sub-btn');
        const vRes = await apiFetch('/videos');
        const vids = await vRes.json();
        const v = vids.find(x => x.id === videoId);

        if (v && currentUser && v.ownerUserId === currentUser.id) {
            subBtn.style.display = 'none';
        } else {
            subBtn.style.display = 'block';
            subBtn.innerText = data.isSubscribed ? 'Вы подписаны' : 'Подписаться';
        }

        subBtn.onclick = async () => {
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
                try {
                    await apiFetch('/interact/comment', { method: 'POST', body: JSON.stringify({ videoId, text: txt }) });
                    commInput.value = '';

                    const div = document.createElement('div');
                    div.className = 'comment-item';
                    div.innerHTML = `
                        <div class="comment-content">
                            <span class="comment-author">Вы</span>
                            <p class="comment-text">${txt}</p>
                        </div>`;
                    if (commList.querySelector('p')) commList.innerHTML = '';
                    commList.prepend(div);
                } catch (e) {
                    showToast('Ошибка при отправке комментария', 'error');
                }
            }
        };

        sendBtn.onclick = submitComment;
        commInput.onkeydown = (e) => {
            if (e.key === 'Enter') submitComment();
        };
    } catch (e) { }
}

export function setupDeleteModal(loadMyChannel) {
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

export function setupFileUploads() {
    const vInput = document.getElementById('video-file-input');
    const warningBox = document.getElementById('upload-warning');
    const isShortInput = document.getElementById('is-short-check');
    const isOptimizedInput = document.getElementById('is-optimized-check'); // Updated ID

    let currentRatio = 0;

    const updateWarning = () => {
        if (!currentRatio) return;

        const isShort = isShortInput ? isShortInput.checked : false;
        const warningText = warningBox ? warningBox.querySelector('p') : null;

        let showWarning = false;
        let message = "";

        if (!isShort) {
            // Normal video check: should be widescreen (~1.77)
            if (currentRatio < 1.7) {
                showWarning = true;
                message = "Это видео не 16:9. В плеере появятся черные поля.";
            }
        } else {
            // Short video check: should be vertical (<1.0)
            if (currentRatio > 1.2) {
                showWarning = true;
                message = "Горизонтальное видео в Shorts будет выглядеть мелко.";
            }
        }

        if (warningBox) {
            if (showWarning) {
                warningBox.classList.add('visible');
                if (warningText) warningText.innerText = message;
            } else {
                warningBox.classList.remove('visible');
            }
        }
    };

    if (vInput) vInput.onchange = (e) => {
        const file = e.target.files[0];
        document.getElementById('video-file-display').innerText = file?.name || '';
        if (warningBox) warningBox.classList.remove('visible');
        currentRatio = 0;

        if (file) {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = function () {
                window.URL.revokeObjectURL(video.src);
                currentRatio = video.videoWidth / video.videoHeight;
                updateWarning();
            };
            video.src = URL.createObjectURL(file);
        }
    };

    if (isShortInput) isShortInput.onchange = updateWarning;

    // Checkbox listener needed here? updateWarning handles it.

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
