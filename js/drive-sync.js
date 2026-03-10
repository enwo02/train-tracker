// Google Drive sync for Train Tracker (works on GitHub Pages; no backend).
//
// Data is stored as a single JSON file in the user's Drive `appDataFolder`.
// Scope: https://www.googleapis.com/auth/drive.appdata
//
// This file intentionally contains no secrets. The OAuth client id is safe to publish.

(() => {
    const DEFAULT_CLIENT_ID = '756638404262-o5drvap24svo9pdeu6ikd8sibo43in4j.apps.googleusercontent.com';
    const CLIENT_ID = String(window.TRAIN_TRACKER_GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID);

    // Request Drive appData access (hidden app-specific storage) + basic identity
    // so we can show which Google account is connected (email in status tooltip).
    // Files in appDataFolder are NOT visible in the normal Drive UI.
    const SCOPE = 'https://www.googleapis.com/auth/drive.appdata openid email';
    const DRIVE_FILENAME = 'train-tracker.json';

    const LS = {
        enabled: 'trainTrackerDriveSyncEnabled',
        // v2 so we don't reuse the old hidden appData file id
        fileId: 'trainTrackerDriveFileId_v2',
        lastSyncedAt: 'trainTrackerDriveLastSyncedAt', // ISO string
        localUpdatedAt: 'trainTrackerLocalUpdatedAt',   // ISO string
        clientInstanceId: 'trainTrackerClientInstanceId',
        accountEmail: 'trainTrackerDriveAccountEmail'
    };

    const ui = {
        status: null,
        btnConnect: null,
        btnUpload: null,
        btnDownload: null
    };

    let tokenClient = null;
    let accessToken = null;
    let pushTimer = null;
    let pushInFlight = false;
    let tokenWaiters = [];

    function getStorage() {
        try {
            // `Storage` is defined as a global binding by `js/storage.js`
            // (not as `window.Storage`).
            // eslint-disable-next-line no-undef
            return (typeof Storage !== 'undefined') ? Storage : null;
        } catch (e) {
            return null;
        }
    }

    function getApp() {
        try {
            // eslint-disable-next-line no-undef
            return (typeof App !== 'undefined') ? App : null;
        } catch (e) {
            return null;
        }
    }

    function ensureClientInstanceId() {
        try {
            const existing = localStorage.getItem(LS.clientInstanceId);
            if (existing) return existing;
            const c = (window && window.crypto) ? window.crypto : null;
            const id = (c && typeof c.randomUUID === 'function')
                ? c.randomUUID()
                : `client-${Math.random().toString(16).slice(2)}-${Date.now()}`;
            localStorage.setItem(LS.clientInstanceId, id);
            return id;
        } catch (e) {
            return `client-${Date.now()}`;
        }
    }

    function setLocalUpdatedAtNow() {
        try {
            localStorage.setItem(LS.localUpdatedAt, new Date().toISOString());
        } catch (e) { /* ignore */ }
    }

    function getLocalUpdatedAt() {
        try {
            return localStorage.getItem(LS.localUpdatedAt) || null;
        } catch (e) {
            return null;
        }
    }

    function getAccountEmail() {
        try {
            return localStorage.getItem(LS.accountEmail) || '';
        } catch (e) {
            return '';
        }
    }

    function setAccountEmail(email) {
        try {
            if (email) {
                localStorage.setItem(LS.accountEmail, email);
            } else {
                localStorage.removeItem(LS.accountEmail);
            }
        } catch (e) { /* ignore */ }
    }

    function formatStatusTitle(text) {
        const email = getAccountEmail();
        if (email) {
            return `Google Drive (${email}): ${text}`;
        }
        return `Google Drive: ${text}`;
    }

    function setStatus(text, { visible = true, tone = 'muted' } = {}) {
        if (ui.status) {
            ui.status.textContent = text;
            ui.status.classList.toggle('hidden', !visible);
            ui.status.classList.toggle('badge-muted', tone === 'muted');
            ui.status.classList.toggle('badge-success', tone === 'success');
            ui.status.classList.toggle('badge-danger', tone === 'danger');
            ui.status.title = formatStatusTitle(text);
        }

        if (ui.btnConnect) {
            ui.btnConnect.classList.toggle('btn-sync-connected', tone === 'success');
            ui.btnConnect.classList.toggle('btn-sync-error', tone === 'danger');
        }
    }

    function setDriveButtonLabel(label) {
        if (!ui.btnConnect) return;
        ui.btnConnect.textContent = label;
    }

    function setDriveButtonEnabled(enabled) {
        if (!ui.btnConnect) return;
        ui.btnConnect.disabled = !enabled;
    }

    function isEnabled() {
        try {
            return localStorage.getItem(LS.enabled) === '1';
        } catch (e) {
            return false;
        }
    }

    function setSyncButtonsVisible(visible) {
        if (ui.btnUpload) ui.btnUpload.classList.toggle('hidden', !visible);
        if (ui.btnDownload) ui.btnDownload.classList.toggle('hidden', !visible);
    }

    function setEnabled(enabled) {
        try {
            localStorage.setItem(LS.enabled, enabled ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    function toast(message) {
        try {
            const app = getApp();
            if (app && typeof app.showToast === 'function') {
                app.showToast(message);
                return;
            }
        } catch (e) { /* ignore */ }
        console.log(message);
    }

    function hasGisLoaded() {
        return !!(window.google
            && window.google.accounts
            && window.google.accounts.oauth2
            && typeof window.google.accounts.oauth2.initTokenClient === 'function');
    }

    function ensureTokenClient() {
        if (tokenClient) return tokenClient;
        if (!hasGisLoaded()) {
            throw new Error('Google Identity Services not loaded.');
        }
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: (resp) => {
                if (resp && resp.access_token) {
                    accessToken = resp.access_token;
                    setStatus('Connected', { visible: true, tone: 'success' });
                    setDriveButtonLabel('Disconnect Drive');
                    setDriveButtonEnabled(true);
                    setSyncButtonsVisible(true);
                    try {
                        setEnabled(true);
                    } catch (e) { /* ignore */ }

                    if (tokenWaiters.length > 0) {
                        const waiters = tokenWaiters;
                        tokenWaiters = [];
                        waiters.forEach(w => w.resolve(resp.access_token));
                    }
                } else {
                    console.warn('Unexpected token response', resp);
                    setStatus('Not connected', { visible: true, tone: 'danger' });
                    setDriveButtonLabel('Connect Drive');
                    setDriveButtonEnabled(true);
                    setSyncButtonsVisible(false);

                    if (tokenWaiters.length > 0) {
                        const waiters = tokenWaiters;
                        tokenWaiters = [];
                        waiters.forEach(w => w.reject(new Error('Google sign-in failed or was cancelled.')));
                    }
                }
            }
        });
        return tokenClient;
    }

    async function requestAccessToken({ prompt } = { prompt: '' }) {
        const tc = ensureTokenClient();
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                reject(new Error('Timed out while waiting for Google sign-in.'));
            }, 12000);

            tokenWaiters.push({
                resolve: (tok) => {
                    clearTimeout(t);
                    resolve(tok);
                },
                reject: (err) => {
                    clearTimeout(t);
                    reject(err);
                }
            });

            try {
                tc.requestAccessToken({ prompt: prompt ?? '' });
            } catch (e) {
                clearTimeout(t);
                reject(e);
            }
        });
    }

    async function fetchUserEmail() {
        if (!accessToken) return;
        try {
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            const email = data && data.email;
            if (email) {
                setAccountEmail(email);
                // Refresh title text to include email
                if (ui.status && ui.status.textContent) {
                    ui.status.title = formatStatusTitle(ui.status.textContent);
                }
            }
        } catch (e) {
            // best-effort only
        }
    }

    async function readErrorText(res) {
        try {
            const t = await res.text();
            return (t && t.trim().length > 0) ? t : '';
        } catch (e) {
            return '';
        }
    }

    async function driveFetch(url, options = {}) {
        const {
            _allowReauth,
            _retry,
            headers: inputHeaders,
            ...init
        } = options || {};

        const isRetry = !!_retry;

        if (!accessToken) {
            // Only attempt silent re-auth on explicit user actions.
            if (_allowReauth) {
                await requestAccessToken({ prompt: '' });
            } else {
                throw new Error('Not connected to Google Drive.');
            }
        }

        const headers = new Headers(inputHeaders || {});
        headers.set('Authorization', `Bearer ${accessToken}`);
        const res = await fetch(url, { ...init, headers });

        if (res.status === 401 && !isRetry && _allowReauth) {
            // Token likely expired; try to refresh once (user-gesture paths only).
            await requestAccessToken({ prompt: '' });
            return driveFetch(url, { ...options, _retry: true });
        }

        return res;
    }

    async function findOrCreateFileId() {
        const existingId = (() => {
            try { return localStorage.getItem(LS.fileId); } catch (e) { return null; }
        })();
        if (existingId) return existingId;

        // Search in appDataFolder by name
        const q = encodeURIComponent(`name='${DRIVE_FILENAME}' and trashed=false`);
        const listUrl = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`;
        const listRes = await driveFetch(listUrl, { _allowReauth: true });
        if (!listRes.ok) {
            const txt = await readErrorText(listRes);
            throw new Error(`Drive list failed (${listRes.status})${txt ? `: ${txt}` : ''}`);
        }
        const listJson = await listRes.json();
        const files = (listJson && listJson.files) ? listJson.files : [];
        if (files.length > 0 && files[0] && files[0].id) {
            const fileId = files[0].id;
            try {
                localStorage.setItem(LS.fileId, fileId);
            } catch (e) { /* ignore */ }
            return fileId;
        }

        // Create metadata-only file in appDataFolder (hidden app storage)
        const createUrl = 'https://www.googleapis.com/drive/v3/files?fields=id,modifiedTime';
        const createRes = await driveFetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: DRIVE_FILENAME,
                parents: ['appDataFolder'],
                mimeType: 'application/json'
            }),
            _allowReauth: true
        });

        if (!createRes.ok) {
            const txt = await readErrorText(createRes);
            throw new Error(`Drive create failed (${createRes.status})${txt ? `: ${txt}` : ''}`);
        }

        const created = await createRes.json();
        const newId = created && created.id;
        if (!newId) throw new Error('Drive create returned no file id.');

        try {
            localStorage.setItem(LS.fileId, newId);
        } catch (e) { /* ignore */ }

        return newId;
    }

    async function downloadRemotePayload(fileId) {
        // Download file content (may be empty if first created)
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
        const res = await driveFetch(downloadUrl, { method: 'GET', _allowReauth: true });
        if (!res.ok) {
            const txt = await readErrorText(res);
            throw new Error(`Drive download failed (${res.status})${txt ? `: ${txt}` : ''}`);
        }

        const text = await res.text();
        if (!text || text.trim().length === 0) {
            return { updatedAt: null, lines: [] };
        }

        const remote = parseRemotePayload(text);
        return remote;
    }

    function buildPayload(lines) {
        return {
            app: 'train-tracker',
            version: 1,
            updatedAt: new Date().toISOString(),
            clientInstanceId: ensureClientInstanceId(),
            lines: Array.isArray(lines) ? lines : []
        };
    }

    function parseRemotePayload(remoteText) {
        const parsed = JSON.parse(String(remoteText || ''));
        if (Array.isArray(parsed)) {
            return { updatedAt: null, lines: parsed };
        }
        if (parsed && Array.isArray(parsed.lines)) {
            return { updatedAt: parsed.updatedAt || null, lines: parsed.lines };
        }
        return { updatedAt: null, lines: [] };
    }

    async function uploadToDrive({ quiet = false } = {}) {
        if (pushInFlight) return;
        pushInFlight = true;

        try {
            const fileId = await findOrCreateFileId();
            const storage = getStorage();
            const localLines = (storage && typeof storage.getLines === 'function')
                ? storage.getLines()
                : [];

            const payload = buildPayload(localLines);

            const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,modifiedTime`;
            const headers = { 'Content-Type': 'application/json' };

            const res = await driveFetch(uploadUrl, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(payload),
                _allowReauth: true
            });

            if (!res.ok) {
                const txt = await readErrorText(res);
                throw new Error(`Drive upload failed (${res.status})${txt ? `: ${txt}` : ''}`);
            }

            await res.json().catch(() => ({}));

            const nowIso = payload.updatedAt;
            try {
                localStorage.setItem(LS.lastSyncedAt, nowIso);
                localStorage.setItem(LS.localUpdatedAt, nowIso);
            } catch (e) { /* ignore */ }

            if (!quiet) toast('Overwritten Google Drive with local routes.');
            setStatus('Connected', { visible: true, tone: 'success' });
        } finally {
            pushInFlight = false;
        }
    }

    async function downloadFromDrive({ quiet = false } = {}) {
        if (pushInFlight) return;
        pushInFlight = true;

        try {
            const fileId = await findOrCreateFileId();
            const storage = getStorage();
            const localLines = (storage && typeof storage.getLines === 'function')
                ? storage.getLines()
                : [];

            const remote = await downloadRemotePayload(fileId); // { updatedAt, lines }
            const remoteLines = remote.lines || [];

            if (remoteLines.length < localLines.length) {
                const confirmOverwrite = window.confirm('Warning: Your Google Drive has fewer routes than your local device. Overwriting will delete some local routes. Continue?');
                if (!confirmOverwrite) {
                    return;
                }
            }

            if (storage && typeof storage.setLines === 'function') {
                storage.setLines(remoteLines);
            }

            try {
                localStorage.setItem(LS.localUpdatedAt, remote.updatedAt || new Date().toISOString());
            } catch (e) { /* ignore */ }

            if (!quiet) toast('Downloaded routes from Google Drive.');
            setStatus('Connected', { visible: true, tone: 'success' });
        } finally {
            pushInFlight = false;
        }
    }

    async function connectAndInitialSync() {
        setStatus('Connecting…', { visible: true, tone: 'muted' });
        setDriveButtonLabel('Connecting…');
        setDriveButtonEnabled(false);

        try {
            // After first successful connection, try to reuse existing consent.
            // Note: this still may require user interaction depending on browser/account state.
            const prompt = isEnabled() ? '' : 'consent';
            await requestAccessToken({ prompt });
            // Best-effort fetch of the account email for display.
            await fetchUserEmail();
            toast('Connected to Google Drive.');
        } catch (e) {
            console.error(e);
            setStatus('Not connected', { visible: true, tone: 'danger' });
            setDriveButtonLabel('Connect Drive');
            setDriveButtonEnabled(true);
            setSyncButtonsVisible(false);
            toast(`Drive sync: could not start Google sign-in. ${e && e.message ? e.message : ''}`.trim());
            return;
        }
    }

    function disconnectDrive() {
        if (accessToken) {
            try {
                if (window.google && window.google.accounts && window.google.accounts.oauth2) {
                    window.google.accounts.oauth2.revoke(accessToken);
                }
            } catch (e) { /* ignore */ }
        }
        accessToken = null;
        setEnabled(false);
        setAccountEmail('');
        setStatus('Not connected', { visible: true, tone: 'danger' });
        setDriveButtonLabel('Connect Drive');
        setDriveButtonEnabled(true);
        setSyncButtonsVisible(false);
        toast('Disconnected from Google Drive.');
    }

    async function handleUpload() {
        if (!accessToken) return;
        try {
            ui.btnUpload.disabled = true;
            await uploadToDrive({ quiet: false });
        } catch (e) {
            console.error(e);
            toast(`Drive upload failed. ${e && e.message ? e.message : ''}`.trim());
        } finally {
            ui.btnUpload.disabled = false;
        }
    }

    async function handleDownload() {
        if (!accessToken) return;
        try {
            ui.btnDownload.disabled = true;
            await downloadFromDrive({ quiet: false });
        } catch (e) {
            console.error(e);
            toast(`Drive download failed. ${e && e.message ? e.message : ''}`.trim());
        } finally {
            ui.btnDownload.disabled = false;
        }
    }

    function wireUi() {
        ui.status = document.getElementById('drive-sync-status');
        ui.btnConnect = document.getElementById('btn-connect-drive');
        ui.btnUpload = document.getElementById('btn-drive-upload');
        ui.btnDownload = document.getElementById('btn-drive-download');

        if (!ui.btnConnect || !ui.status) return;

        setStatus('Not connected', { visible: true, tone: 'danger' });
        setDriveButtonLabel('Connect Drive');
        setDriveButtonEnabled(true);
        setSyncButtonsVisible(false);

        ui.btnConnect.addEventListener('click', () => {
            if (accessToken) {
                disconnectDrive();
            } else {
                connectAndInitialSync();
            }
        });

        if (ui.btnUpload) {
            ui.btnUpload.addEventListener('click', handleUpload);
        }
        
        if (ui.btnDownload) {
            ui.btnDownload.addEventListener('click', handleDownload);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        wireUi();
        wireStorageChangeListener();
        ensureClientInstanceId();

        // Remember intent: if user enabled drive sync earlier, reflect it in the UI.
        if (isEnabled()) {
            setStatus('Reconnect needed', { visible: true, tone: 'danger' });
            setDriveButtonLabel('Connect Drive');
            setDriveButtonEnabled(true);
        }
    });
})();

