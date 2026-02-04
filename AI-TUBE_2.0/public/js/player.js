/* ==========================================
   PLAYER.JS - Пауза, FX
   ========================================== */

export function createSimplePauseOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'simple-pause-overlay';
    overlay.innerHTML = '<i class="fas fa-pause"></i>';
    return overlay;
}

export function attachPauseFX(container, video) {
    const existing = container.querySelector('.simple-pause-overlay');
    if (existing) existing.remove();
    const overlay = createSimplePauseOverlay();
    container.appendChild(overlay);

    const toggle = (e) => {
        if (e) {
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
