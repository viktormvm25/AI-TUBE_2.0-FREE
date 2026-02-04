/* ==========================================
   SHORTS.JS - Shorts логика
   ========================================== */

import { apiFetch, currentUser } from './api.js';
import { showToast, openModal } from './ui.js';
import { attachPauseFX } from './player.js';

export async function renderShortsList(videos, startVideoId = null) {
    const container = document.getElementById('shorts-container');
    container.innerHTML = '';

    if (videos.length === 0) {
        container.innerHTML = `
            <div class="not-found-msg">
                <i class="fas fa-video-slash"></i>
                <p>Шортсы не найдены</p>
            </div>`;
        return;
    }

    const detailsCache = {};

    async function loadVideoDetails(videoId) {
        if (detailsCache[videoId]) return detailsCache[videoId];
        try {
            const dRes = await apiFetch(`/videos/${videoId}/details`);
            if (dRes) {
                detailsCache[videoId] = await dRes.json();
                return detailsCache[videoId];
            }
        } catch (e) { }
        return { likes: 0, userReaction: null, comments: [], isSubscribed: false };
    }

    async function updateShortDetails(videoId, v) {
        const details = await loadVideoDetails(videoId);

        const subBtn = document.getElementById(`s-sub-${videoId}`);
        if (subBtn) {
            if (details.isSubscribed) {
                subBtn.classList.add('subscribed');
                subBtn.textContent = 'Вы подписаны';
                subBtn.style.borderColor = '#25D366';
                subBtn.style.color = '#25D366';
                subBtn.style.boxShadow = '0 0 10px #25D366';
                subBtn.style.background = 'rgba(37,211,102,0.1)';
            }
        }

        const likesEl = document.getElementById(`s-likes-${videoId}`);
        if (likesEl) likesEl.textContent = details.likes;

        const likeBtn = document.querySelector(`[onclick*="toggleShortLike('${videoId}'"]`);
        if (likeBtn && details.userReaction === 'like') {
            likeBtn.classList.add('active');
        }

        const commCount = document.getElementById(`s-comm-count-${videoId}`);
        if (commCount) commCount.textContent = details.comments.length;

        const commList = document.getElementById(`s-comments-list-${videoId}`);
        if (commList) {
            commList.innerHTML = details.comments.length ? details.comments.map(c => `
                <div class="comment-item">
                    <div class="comment-content">
                        <span class="comment-author">${c.username}</span>
                        <p class="comment-text">${c.text}</p>
                    </div>
                </div>
            `).join('') : '<p class="text-center" style="color:#777;padding:20px">Нет комментариев</p>';
        }
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const vid = entry.target.querySelector('video');
            const videoId = entry.target.dataset.videoId;

            if (entry.isIntersecting) {
                if (!vid.getAttribute('src') && vid.dataset.src) {
                    vid.src = vid.dataset.src;
                    vid.load();
                }

                if (!entry.target.dataset.detailsLoaded) {
                    entry.target.dataset.detailsLoaded = 'true';
                    const videoData = videos.find(x => x.id === videoId);
                    if (videoData) updateShortDetails(videoId, videoData);
                }

                document.querySelectorAll('.short-video').forEach(v => {
                    if (v !== vid) {
                        v.pause();
                    }
                });

                vid.parentElement.style.opacity = '1';
                vid.controls = false;

                vid.play().catch(() => {
                    vid.muted = true;
                    vid.play();
                    const btn = entry.target.querySelector('.unmute-overlay');
                    if (btn) btn.classList.add('visible');
                });
            } else {
                vid.pause();
                vid.removeAttribute('src');
                vid.load();
            }
        });
    }, { threshold: 0.6 });

    for (const v of videos) {
        const el = document.createElement('div');
        el.className = 'short-item';
        el.dataset.videoId = v.id;

        // По умолчанию cover (заполняет экран, может кропать углы)
        // Для горизонтальных видео JS автоматически переключит на fill
        el.innerHTML = `
            <div style="width:100%;height:100%;position:relative;overflow:hidden;background:#000;" class="short-video-container">
                <video id="vid-${v.id}" data-src="${v.videoUrl}" class="short-video" loop playsinline preload="metadata" style="position:relative;z-index:1; width:100% !important; height:100% !important; object-fit: cover !important;"></video>
                <div class="unmute-overlay" onclick="event.stopPropagation(); window.unmuteShort('${v.id}')">
                    <i class="fas fa-volume-mute"></i>
                </div>
            </div>
            <div class="short-overlay">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
                    <div class="avatar-frame avatar-sm" onclick="event.stopPropagation(); window.openChannel('${v.ownerChannelId}')" style="cursor:pointer">
                        <img src="${v.channelAvatar}" class="avatar-img">
                    </div>
                    <span style="font-weight:bold;cursor:pointer;text-shadow:0 0 5px #000" onclick="event.stopPropagation(); window.openChannel('${v.ownerChannelId}')">${v.channelName}</span>
                    ${(currentUser && currentUser.id !== v.ownerUserId) ?
                `<button id="s-sub-${v.id}" class="neon-btn-lg"
                            onclick="event.stopPropagation(); window.toggleShortSub('${v.ownerChannelId}', 's-sub-${v.id}')" 
                            style="margin-left:10px; font-size: 0.8rem; padding: 5px 15px; height:auto; border-radius:12px;">
                            Подписаться
                        </button>` : ''}
                </div>

                <div class="short-desc-container">
                     <h3 style="margin:0 0 5px 0;text-shadow:0 0 5px #000;text-align:left">${v.title}</h3>
                     ${v.description ? `<div id="desc-${v.id}" class="short-desc" onclick="event.stopPropagation()">${v.description}</div>${v.description.length > 30 ? `<span class="desc-more-btn" onclick="event.stopPropagation(); window.toggleShortDesc('${v.id}')">Ещё</span>` : ''}` : ''}
                </div>
            </div>
            <div class="short-controls">
                <div class="short-btn" onclick="event.stopPropagation(); window.toggleShortLike('${v.id}', this)">
                    <i class="fas fa-heart"></i>
                </div>
                <span class="short-count" id="s-likes-${v.id}">0</span>
                <div class="short-btn" onclick="event.stopPropagation(); window.toggleShortComments('${v.id}')">
                    <i class="fas fa-comment"></i>
                </div>
                <span class="short-count" id="s-comm-count-${v.id}">0</span>
                <div class="short-btn" onclick="event.stopPropagation(); window.shareVideo('${v.id}')">
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
                    <i class="fas fa-times" onclick="window.toggleShortComments('${v.id}')" style="cursor:pointer;font-size:1.2rem;"></i>
                </div>
                <div class="panel-input">
                    <input type="text" class="neon-input" placeholder="Написать..." id="s-input-${v.id}" style="margin:0" onkeydown="if(event.key==='Enter') window.sendShortComment('${v.id}')">
                    <button class="neon-btn-secondary" onclick="window.sendShortComment('${v.id}')"><i class="fas fa-paper-plane"></i></button>
                </div>
                <div class="panel-body" id="s-comments-list-${v.id}">
                    <p class="text-center" style="color:#777;padding:20px">Загрузка...</p>
                </div>
            </div>`;

        const vid = el.querySelector('video');
        attachPauseFX(el, vid);
        container.appendChild(el);
        observer.observe(el);
    }

    if (videos.length > 0) {
        const firstEl = container.querySelector('.short-item');
        if (firstEl) {
            const vid = firstEl.querySelector('video');
            if (vid && vid.dataset.src) {
                vid.src = vid.dataset.src;
            }
            firstEl.dataset.detailsLoaded = 'true';
            updateShortDetails(videos[0].id, videos[0]);
        }
    }

    if (startVideoId) {
        setTimeout(() => {
            const t = container.querySelector(`[data-video-id="${startVideoId}"]`);
            if (t) t.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 100);
    }
}

export async function loadShorts(startVideoId = null) {
    try {
        const res = await apiFetch('/videos?isShort=true');
        if (!res) return;
        const videos = await res.json();
        renderShortsList(videos, startVideoId);
    } catch (e) { }
}


export function setupShortsScroll() {
    window.scrollShorts = (dir) => {
        const container = document.getElementById('shorts-container');
        container.scrollBy({ top: dir * 600, behavior: 'smooth' });
    };
}

export function setupShortsGlobals(navigateTo) {
    window.goBackFromShorts = () => {
        document.querySelectorAll('.short-video').forEach(vid => {
            vid.pause();
            vid.src = '';
            vid.load();
        });
        navigateTo('video-feed');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector('.nav-item[data-target="video-feed"]')?.classList.add('active');
    };

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
        } catch (e) { }
    };

    window.shareVideo = (videoId) => {
        const url = `${window.location.origin}/?v=${videoId}`;
        const modal = document.getElementById('share-modal');
        if (!modal) {
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
                    window.prompt('Ваш браузер заблокировал копирование. Скопируйте ссылку вручную:', url);
                    modal.classList.remove('active');
                }
            };
        }

        const cls = modal.querySelector('.close-modal');
        if (cls) cls.onclick = () => modal.classList.remove('active');

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

    window.toggleShortComments = (vidId) => {
        document.getElementById(`s-comments-${vidId}`).classList.toggle('open');
    };

    window.sendShortComment = async (vidId) => {
        const input = document.getElementById(`s-input-${vidId}`);
        const text = input.value.trim();
        if (!text) return;
        try {
            await apiFetch('/interact/comment', { method: 'POST', body: JSON.stringify({ videoId: vidId, text }) });
            input.value = '';
            const list = document.getElementById(`s-comments-list-${vidId}`);
            const countEl = document.getElementById(`s-comm-count-${vidId}`);

            const div = document.createElement('div');
            div.className = 'comment-item';
            div.innerHTML = `
                <div class="comment-content">
                    <span class="comment-author">Я</span>
                    <p class="comment-text">${text}</p>
                </div>`;
            list.prepend(div);

            if (countEl) {
                let count = parseInt(countEl.innerText) || 0;
                countEl.innerText = count + 1;
            }
        } catch (e) { showToast(e.message, 'error'); }
    };
    window.unmuteShort = (id) => {
        const v = document.getElementById(`vid-${id}`);
        if (v) {
            v.muted = false;
        }
        const btn = v.parentElement.querySelector('.unmute-overlay');
        if (btn) btn.classList.remove('visible');
    };
}
