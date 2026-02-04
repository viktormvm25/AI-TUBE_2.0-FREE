/* ==========================================
   AUTH.JS - Формы авторизации
   ========================================== */

import { apiFetch, saveAuth, currentUser } from './api.js';
import { showToast, showGreeting, showScreen, openModal, closeModal } from './ui.js';

export async function login(username, password, callbacks = {}) {
    try {
        const res = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        if (!res) return;
        const data = await res.json();
        saveAuth(data.token, data.user);
        showGreeting(data.user.name);
        if (callbacks.updateUI) callbacks.updateUI();
        showScreen('app-layout');
        if (callbacks.loadVideoFeed) callbacks.loadVideoFeed();
    } catch (e) { showToast(e.message, 'error'); }
}

export async function register(name, username, password, callbacks = {}) {
    try {
        const res = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ name, username, password }) });
        if (!res) return;
        const data = await res.json();
        saveAuth(data.token, data.user);
        showGreeting(data.user.name);
        if (callbacks.updateUI) callbacks.updateUI();
        showScreen('app-layout');
        if (callbacks.loadVideoFeed) callbacks.loadVideoFeed();
    } catch (e) { showToast(e.message, 'error'); }
}

export async function checkAuth(callbacks = {}) {
    try {
        const res = await apiFetch('/auth/me');
        if (res) {
            const user = await res.json();
            saveAuth(localStorage.getItem('token'), user);
            if (callbacks.updateUI) callbacks.updateUI();
        }
    } catch (e) { }
}

export function setupForms(callbacks = {}) {
    const logForm = document.getElementById('login-form');
    if (logForm) logForm.onsubmit = (e) => {
        e.preventDefault();
        if (!logForm.reportValidity()) return;
        login(
            document.getElementById('login-username').value.trim(),
            document.getElementById('login-password').value.trim(),
            callbacks
        );
    };

    const regForm = document.getElementById('register-form');
    if (regForm) regForm.onsubmit = (e) => {
        e.preventDefault();
        if (!regForm.reportValidity()) return;
        register(
            document.getElementById('reg-name').value.trim(),
            document.getElementById('reg-username').value.trim(),
            document.getElementById('reg-password').value.trim(),
            callbacks
        );
    };

    const upForm = document.getElementById('upload-form');
    if (upForm) upForm.onsubmit = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const warningBox = document.getElementById('upload-warning');
        const confirmCheck = document.getElementById('confirm-vertical');
        if (warningBox && warningBox.classList.contains('visible') && !confirmCheck.checked) {
            showToast('Подтвердите загрузку вертикального видео с полями', 'error');
            return;
        }

        const submitBtn = upForm.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.innerHTML : '';

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
            }

            const chRes = await apiFetch('/channels/my');
            if (!chRes) {
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText; }
                return;
            }
            const ch = await chRes.json();
            if (!ch) {
                showToast('Сначала создайте канал', 'error');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText; }
                return;
            }

            const fd = new FormData(e.target);
            fd.append('channelId', ch.id);

            const res = await apiFetch('/videos', { method: 'POST', body: fd });
            if (res) {
                showToast('Опубликовано!');
                closeModal('upload-modal');
                e.target.reset();
                const thumbPreview = document.getElementById('thumb-preview-img');
                if (thumbPreview) thumbPreview.classList.add('hidden');
                const videoDisplay = document.getElementById('video-file-display');
                if (videoDisplay) videoDisplay.innerText = '';
                const thumbDisplay = document.getElementById('thumb-file-display');
                if (thumbDisplay) thumbDisplay.innerText = '';

                if (callbacks.loadMyChannel) callbacks.loadMyChannel();
            }
        } catch (err) {
            console.error('Ошибка загрузки:', err);
            showToast(err.message || 'Ошибка при загрузке видео', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        }
    };

    const chForm = document.getElementById('create-channel-form');
    if (chForm) chForm.onsubmit = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fd = new FormData(e.target);
        try {
            if (await apiFetch('/channels', { method: 'POST', body: fd })) {
                showToast('Канал создан');
                if (callbacks.loadMyChannel) callbacks.loadMyChannel();
            }
        }
        catch (err) { showToast(err.message, 'error'); }
    };

    const profForm = document.getElementById('profile-edit-form');
    if (profForm) profForm.onsubmit = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fd = new FormData();
        const name = document.getElementById('edit-name').value;
        const pass = document.getElementById('edit-pass').value;
        const file = document.getElementById('edit-avatar-file').files[0];
        if (name) fd.append('name', name);
        if (pass) fd.append('password', pass);
        if (file) fd.append('avatar', file);
        try {
            if (await apiFetch('/users/update', { method: 'POST', body: fd })) {
                showToast('Обновлено');
                if (callbacks.checkAuth) callbacks.checkAuth();
            }
        }
        catch (e) { showToast(e.message, 'error'); }
    };

    const toggleTheme = document.getElementById('toggle-theme');
    if (toggleTheme) toggleTheme.onclick = async () => {
        const { currentUser } = await import('./api.js');
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
        e.stopPropagation();
        const fd = new FormData(e.target);
        try {
            const res = await apiFetch('/channels/update', { method: 'POST', body: fd });
            if (res) {
                showToast('Канал обновлен');
                closeModal('edit-channel-modal');
                setTimeout(() => {
                    if (callbacks.loadMyChannel) callbacks.loadMyChannel();
                }, 300);
            }
        } catch (err) { showToast(err.message, 'error'); }
    };

    const deleteAccBtn = document.getElementById('delete-acc-btn');
    if (deleteAccBtn) deleteAccBtn.onclick = async () => {
        if (confirm('Удалить аккаунт навсегда?')) {
            const { logout } = await import('./api.js');
            try {
                await apiFetch('/auth/delete', { method: 'POST' });
                logout('Аккаунт удален');
            } catch (e) { showToast(e.message, 'error'); }
        }
    };

    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('active'));
}
