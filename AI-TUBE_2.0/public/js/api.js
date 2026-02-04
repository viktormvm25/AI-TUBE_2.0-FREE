/* ==========================================
   API.JS - API функции, авторизация
   ========================================== */

export const API_URL = '/api';
export let currentUser = null;

export function setCurrentUser(user) {
    currentUser = user;
}

export function saveAuth(token, user) {
    if (!token || !user) return;
    user.token = token;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    currentUser = user;
}

export function loadAuth() {
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

export function logout(message = null) {
    const { showScreen, showToast } = window.uiFunctions || {};
    
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.clear();
    currentUser = null;
    window.currentChannelId = null;

    const chViewName = document.getElementById('ch-view-name');
    const chViewTag = document.getElementById('ch-view-tag');
    const chViewAvatar = document.getElementById('ch-view-avatar');
    if (chViewName) chViewName.innerText = '';
    if (chViewTag) chViewTag.innerText = '';
    if (chViewAvatar) chViewAvatar.src = '/assets/avatar-placeholder.svg';

    const videoList = document.getElementById('video-list');
    const channelVideoList = document.getElementById('channel-video-list');
    if (videoList) videoList.innerHTML = '';
    if (channelVideoList) channelVideoList.innerHTML = '';

    if (showScreen) showScreen('auth-screen');
    if (message && showToast) showToast(message, 'error');
}

export async function apiFetch(endpoint, options = {}) {
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
