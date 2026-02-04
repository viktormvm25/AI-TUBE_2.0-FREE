/* ==========================================
   CHANNEL.JS - Функции канала
   ========================================== */

import { apiFetch, currentUser } from './api.js';
import { showToast, openModal } from './ui.js';

export async function loadChannelStats() {
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

        const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
        const videos = vRes ? await vRes.json() : [];

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
                    <span class="stat-value">${videos.length}</span>
                    <span class="stat-label">Всего видео</span>
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

export async function loadMyChannel(renderVideoCard) {
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
            const ava = document.getElementById('ch-view-avatar');
            ava.onerror = () => window.handleImgError(ava);
            ava.src = ch.avatarPath || '/assets/avatar-placeholder.svg';
            window.currentChannelId = ch.id;

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

            document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('active'));
            document.getElementById('ch-tab-videos')?.classList.add('active');
            loadChannelVideos('videos', renderVideoCard);
        }
    } catch (e) {
        console.error(e);
        showToast('Ошибка загрузки канала', 'error');
    }
}

export async function loadChannelVideos(type, renderVideoCard) {
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
                list.innerHTML = vids.map(v => renderVideoCard(v, true, isShort)).join('');
            }
        }
    } catch (e) { }
}

export function setupChannelTabs(renderVideoCard) {
    window.switchChannelTab = (type) => {
        document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`ch-tab-${type}`).classList.add('active');
        loadChannelVideos(type, renderVideoCard);
    };
}

export async function openChannel(channelId, renderVideoCard, navigateTo) {
    try {
        const res = await apiFetch(`/channels/${channelId}`);
        if (!res) return;
        const ch = await res.json();

        navigateTo('other-channel-view');
        document.getElementById('oc-name').innerText = ch.channelName;
        document.getElementById('oc-tag').innerText = ch.channelTag;
        const ava = document.getElementById('oc-avatar');
        ava.onerror = () => window.handleImgError(ava);
        ava.src = ch.avatarPath;
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
                if (res) openChannel(channelId, renderVideoCard, navigateTo);
            };
        }

        const vRes = await apiFetch(`/videos?channelId=${ch.id}`);
        const vids = await vRes.json();
        document.getElementById('oc-videos-list').innerHTML = vids.map(v => renderVideoCard(v, false)).join('');
    } catch (e) { showToast(e.message, 'error'); }
}
