/* ==========================================
   MAIN.JS - Точка входа
   ========================================== */

import { loadAuth, currentUser, apiFetch, logout } from './api.js';
import {
    showToast, openModal, closeModal,
    showSplash, hideSplash, showScreen, showGreeting,
    navigateTo as baseNavigateTo, updateUI as baseUpdateUI,
    setupLazyImages
} from './ui.js';
import { login, register, checkAuth, setupForms } from './auth.js';
import { loadChannelStats, loadMyChannel, loadChannelVideos, setupChannelTabs, openChannel } from './channel.js';
import {
    renderVideoCard, loadVideoFeed, loadSubscriptions,
    openPlayer, checkChannelAndUpload, loadInteractions,
    setupDeleteModal, setupFileUploads, setDeleteVideoId, deleteVideoId
} from './videos.js';
import { loadShorts, setupShortsScroll, setupShortsGlobals, renderShortsList } from './shorts.js';

// Wrapper functions for global access
function wrappedNavigateTo(viewId) {
    baseNavigateTo(viewId, {
        loadVideoFeed: () => loadVideoFeed(wrappedRenderVideoCard),
        loadShorts,
        loadMyChannel: () => loadMyChannel(wrappedRenderVideoCard),
        loadSubscriptions,
        updateUI: wrappedUpdateUI
    });
}

function wrappedUpdateUI() {
    baseUpdateUI(currentUser, loadChannelStats);
}

function wrappedRenderVideoCard(v, isMyChannel = false, forceIsShort = false) {
    return renderVideoCard(v, isMyChannel, forceIsShort);
}

// Make functions globally accessible
window.uiFunctions = { showScreen, showToast };
window.openPlayer = (id, updateUrl = true) => openPlayer(id, wrappedNavigateTo, updateUrl);
window.openChannel = (channelId) => openChannel(channelId, wrappedRenderVideoCard, wrappedNavigateTo);
window.askDelete = (id) => { setDeleteVideoId(id); openModal('confirm-modal'); };
window.openShort = (id) => { wrappedNavigateTo('shorts-feed'); loadShorts(id); };

// Main initialization


document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    // Для получения ID используем сохраненный URL (до очистки) или текущий, если вдруг очистка не сработала (маловероятно)
    // Но так как мы очищаем выше, то здесь params может быть уже пустым, если мы перезагрузили страницу.
    // Стоп. Если мы очистили URL через replaceState, то при F5 браузер загрузит чистый URL без ?v=.
    // Значит, логика "открыть видео по ссылке" должна отработать ДО очистки или мы должны сохранить ID.

    // Правильная логика:
    // 1. Читаем ID
    // 2. Если есть ID -> сохраняем его в переменную
    // 3. Очищаем URL
    // 4. Запускаем плеер с сохраненным ID

    let videoIdToPlay = null;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('v')) {
        videoIdToPlay = urlParams.get('v');
        const cleanUrl = new URL(window.location);
        cleanUrl.searchParams.delete('v');
        window.history.replaceState({}, document.title, cleanUrl.toString());
    }

    if (videoIdToPlay) {
        setTimeout(() => {
            if (window.openPlayer) window.openPlayer(videoIdToPlay, false);
        }, 800);
    }

    const splashShown = sessionStorage.getItem('splashShown');
    const hasAuth = loadAuth();

    if (!splashShown) {
        showSplash();
        sessionStorage.setItem('splashShown', 'true');
        setTimeout(async () => {
            hideSplash();
            if (hasAuth) {
                await checkAuth({ updateUI: wrappedUpdateUI });
                showScreen('app-layout');
                loadVideoFeed(wrappedRenderVideoCard);
            } else {
                showScreen('auth-screen');
            }
        }, 2500);
    } else {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';

        if (hasAuth) {
            await checkAuth({ updateUI: wrappedUpdateUI });
            showScreen('app-layout');
            loadVideoFeed(wrappedRenderVideoCard);
        } else {
            showScreen('auth-screen');
        }
    }

    setupNavigation();
    setupForms({
        updateUI: wrappedUpdateUI,
        loadVideoFeed: () => loadVideoFeed(wrappedRenderVideoCard),
        loadMyChannel: () => loadMyChannel(wrappedRenderVideoCard),
        checkAuth: () => checkAuth({ updateUI: wrappedUpdateUI })
    });
    setupFileUploads();
    setupDeleteModal(() => loadMyChannel(wrappedRenderVideoCard));
    setupShortsScroll();
    setupShortsGlobals(wrappedNavigateTo);
    setupChannelTabs(wrappedRenderVideoCard);

    const backBtn = document.getElementById('player-back-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            const video = document.getElementById('main-player');
            if (video) { video.pause(); video.src = ""; }
            wrappedNavigateTo('video-feed');
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

function setupNavigation() {
    const toReg = document.getElementById('to-register');
    if (toReg) toReg.onclick = () => {
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
    };

    const toLog = document.getElementById('to-login');
    if (toLog) toLog.onclick = () => {
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
    };

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
                wrappedNavigateTo('video-feed');
                const list = document.getElementById('video-list');
                if (videos.length === 0) {
                    list.innerHTML = `
                        <div class="not-found-msg">
                            <i class="fas fa-search"></i>
                            <p>Ничего не найдено по вашему запросу</p>
                        </div>`;
                } else {
                    list.innerHTML = videos.map(v => wrappedRenderVideoCard(v, false)).join('');
                }
            }
        } catch (e) { }
    };

    if (searchBtn) searchBtn.onclick = triggerSearch;
    if (searchInput) searchInput.onkeydown = (e) => { if (e.key === 'Enter') triggerSearch(); };

    const drawer = document.getElementById('drawer');
    const drawerToggle = document.getElementById('drawer-toggle');
    if (drawerToggle) drawerToggle.onclick = (e) => {
        e.stopPropagation();
        drawer.classList.toggle('open');
    };

    document.addEventListener('click', (e) => {
        if (drawer.classList.contains('open') && !drawer.contains(e.target) && e.target !== drawerToggle) {
            drawer.classList.remove('open');
        }
    });

    const drawerBack = document.getElementById('drawer-backdrop');
    if (drawerBack) drawerBack.onclick = () => drawer.classList.remove('open');

    document.querySelectorAll('.drawer-item').forEach(item => {
        item.onclick = () => {
            wrappedNavigateTo(item.dataset.target);
            drawer.classList.remove('open');
        }
    });

    const logoutBtn = document.getElementById('logout-btn-settings');
    if (logoutBtn) logoutBtn.onclick = () => logout();

    document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => wrappedNavigateTo(btn.dataset.target));

    const upBtn = document.getElementById('header-upload-btn');
    if (upBtn) upBtn.onclick = () => checkChannelAndUpload(wrappedNavigateTo);

    const upHero = document.getElementById('upload-video-hero-btn');
    if (upHero) upHero.onclick = () => openModal('upload-modal');

    const backBtn = document.getElementById('back-feed-btn');
    if (backBtn) backBtn.onclick = () => {
        const video = document.getElementById('main-player');
        if (video) { video.pause(); video.src = ""; }
        wrappedNavigateTo('video-feed');
    };

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (['INPUT', 'TEXTAREA'].includes(activeEl.tagName)) return;

        const isShortsView = !document.getElementById('shorts-feed').classList.contains('hidden');
        const isVideoView = !document.getElementById('video-player-view').classList.contains('hidden');
        const mainVideo = document.getElementById('main-player');
        const shortsContainer = document.getElementById('shorts-container');

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

        if (isShortsView && shortsContainer) {
            if (e.code === 'ArrowDown') {
                e.preventDefault();
                shortsContainer.scrollBy({ top: 600, behavior: 'smooth' });
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                shortsContainer.scrollBy({ top: -600, behavior: 'smooth' });
            }
        }

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
