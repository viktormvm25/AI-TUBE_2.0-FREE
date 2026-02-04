/* ==========================================
   UI.JS - UI утилиты
   ========================================== */

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

export function openModal(id) {
    document.getElementById(id)?.classList.add('active');
}

export function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
}

export function showSplash() {
    document.getElementById('splash-screen')?.classList.remove('hidden');
}

export function hideSplash() {
    const s = document.getElementById('splash-screen');
    if (s) {
        s.classList.add('exit');
        setTimeout(() => {
            s.classList.add('hidden');
            s.classList.remove('exit');
        }, 800);
    }
}

export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
}

export function showGreeting(name) {
    const overlay = document.getElementById('greeting-overlay');
    const text = document.getElementById('greeting-text');
    if (overlay && text) {
        text.innerText = `Приветствую, ${name}`;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 2500);
    }
}

export function navigateTo(viewId, callbacks = {}) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId)?.classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.target === viewId));

    const header = document.querySelector('.app-header');
    if (header) {
        if (viewId === 'video-player-view' || viewId === 'shorts-feed') {
            header.classList.add('hidden');
            document.getElementById('app-layout').style.paddingTop = '0';
        } else {
            header.classList.remove('hidden');
            document.getElementById('app-layout').style.paddingTop = '';
        }
    }

    if (viewId === 'video-feed' && callbacks.loadVideoFeed) callbacks.loadVideoFeed();
    if (viewId === 'shorts-feed' && callbacks.loadShorts) callbacks.loadShorts();
    if (viewId === 'my-channel' && callbacks.loadMyChannel) callbacks.loadMyChannel();
    if (viewId === 'subscriptions-view' && callbacks.loadSubscriptions) callbacks.loadSubscriptions();
    if (viewId === 'profile-view' && callbacks.updateUI) callbacks.updateUI();
}

export function updateUI(currentUser, loadChannelStats) {
    if (!currentUser) return;
    if (currentUser.theme === 'neon-purple') document.body.classList.add('theme-purple');
    else document.body.classList.remove('theme-purple');

    if (document.getElementById('profile-name')) document.getElementById('profile-name').innerText = currentUser.name;
    if (document.getElementById('profile-username')) document.getElementById('profile-username').innerText = currentUser.username;
    if (document.getElementById('profile-avatar')) document.getElementById('profile-avatar').src = currentUser.avatarPath || '/assets/avatar-placeholder.svg';

    if (loadChannelStats) loadChannelStats();
}

// Lazy Loading Observer for images
export const lazyImageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            }
            lazyImageObserver.unobserve(img);
        }
    });
}, { rootMargin: '100px' });

export function setupLazyImages() {
    document.querySelectorAll('img[data-src]').forEach(img => {
        lazyImageObserver.observe(img);
    });
}

// Global Image Error Handler
window.handleImgError = (img) => {
    img.onerror = null;
    img.src = '/assets/avatar-placeholder.svg';
};
