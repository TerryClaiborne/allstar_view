(() => {
    'use strict';
    const storageKey = 'allstar_view_theme';
    const toggle = document.getElementById('theme-toggle');

    function applyTheme(value, persist = true) {
        const theme = value === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        if (toggle) {
            toggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
        }
        if (persist) {
            try { window.localStorage.setItem(storageKey, theme); } catch (error) { /* keep the active theme */ }
        }
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            applyTheme(current === 'light' ? 'dark' : 'light');
        });
    }
    applyTheme(document.documentElement.getAttribute('data-theme'), false);

    function parseVersion(value) {
        const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    }
    function newer(remote, local) {
        const left = parseVersion(remote);
        const right = parseVersion(local);
        if (!left || !right) return false;
        for (let index = 0; index < 3; index += 1) {
            if (left[index] !== right[index]) return left[index] > right[index];
        }
        return false;
    }

    async function checkForUpdate() {
        const title = document.getElementById('branding-title');
        const indicator = document.getElementById('update-indicator');
        if (!title || !indicator) return;
        const localVersion = String(title.dataset.localVersion || '').trim();
        const versionUrl = String(title.dataset.versionUrl || '').trim();
        if (!localVersion || !versionUrl) return;
        try {
            const response = await fetch(versionUrl, { cache: 'no-store' });
            if (!response.ok) return;
            const remoteVersion = String(await response.text()).trim();
            if (newer(remoteVersion, localVersion)) {
                indicator.classList.add('update-available');
                title.title = `AllStar View v${localVersion} - update available: v${remoteVersion}`;
                indicator.title = `Update available: v${remoteVersion} (installed v${localVersion})`;
            }
        } catch (error) {
            // Update checks must never interfere with the page.
        }
    }
    checkForUpdate();
})();
