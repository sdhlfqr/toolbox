(function () {
    'use strict';

    const PACKAGE_VERSION = '0.1.2';

    const bridge =
        typeof YOGIS_TOOLBOX_BRIDGE === 'object' && YOGIS_TOOLBOX_BRIDGE
            ? YOGIS_TOOLBOX_BRIDGE
            : {
                  version: PACKAGE_VERSION,
                  cacheTtlMs: 12 * 60 * 60 * 1000,
                  pageWindow: typeof unsafeWindow !== 'undefined' ? unsafeWindow : window,
                  isUpdatingCore: false,
                  onCoreUpdateStateChange: null,
                  GM_xmlhttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
                  GM_getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
                  GM_setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
                  GM_deleteValue: typeof GM_deleteValue === 'function' ? GM_deleteValue : null,
                  GM_listValues: typeof GM_listValues === 'function' ? GM_listValues : null,
                  GM_addValueChangeListener:
                      typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener : null,
                  GM_registerMenuCommand:
                      typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null,
                  refreshCore: () => Promise.resolve(null)
              };

    const pageWin = bridge.pageWindow || window;
    const isSubFrame = pageWin.top !== pageWin.self;

    if (isSubFrame && pageWin.location.hostname !== 'psref.lenovo.com') {
        return;
    }

    if (pageWin.__YOGIS_TOOLBOX_CORE_ACTIVE__) return;
    pageWin.__YOGIS_TOOLBOX_CORE_ACTIVE__ = true;

    const RAW_BASE_URL = 'https://raw.githubusercontent.com/sdhlfqr/toolbox/main/userscripts/lenovo';
    const CACHE_TTL_MS = bridge.cacheTtlMs || 12 * 60 * 60 * 1000;
    const SETTINGS_KEY = 'ytb_module_settings_v1';
    const PACKAGE_SNAPSHOTS_KEY = 'ytb_package_snapshots_v1';
    const LEGACY_SCRIPT_CACHE_PREFIX = 'ytb_script_cache_v1_';
    const MAX_CACHED_VERSIONS = 10;

    const MODULE_REGISTRY = [
        {
            id: 'quotesPlus',
            name: 'Quotes Plus',
            file: 'quotesPlus.user.js',
            url: `${RAW_BASE_URL}/quotesPlus.user.js`,
            defaultEnabled: true,
            defaultRunAt: 'document-start',
            defaultMatches: [
                'https://www.lenovo.com/*',
                'https://account.lenovo.com/*',
                'https://*.lenovo.com/*'
            ]
        },
        {
            id: 'psrefLookup',
            name: 'PSREF Lookup',
            file: 'psrefLookup.user.js',
            url: `${RAW_BASE_URL}/psrefLookup.user.js`,
            defaultEnabled: true,
            defaultRunAt: 'document-start',
            defaultMatches: [
                'https://www.lenovo.com/*/cart*',
                'https://account.lenovo.com/*/account/quote/detail*',
                'https://psref.lenovo.com/*'
            ]
        },
        {
            id: 'autoCoupons',
            name: 'Auto Coupons',
            file: 'autoCoupons.user.js',
            url: `${RAW_BASE_URL}/autoCoupons.user.js`,
            defaultEnabled: true,
            defaultRunAt: 'document-idle',
            defaultMatches: ['https://www.lenovo.com/*/cart*']
        },
        {
            id: 'profitOverride',
            name: 'Profit Override',
            file: 'profitOverride.user.js',
            url: `${RAW_BASE_URL}/profitOverride.user.js`,
            defaultEnabled: true,
            defaultRunAt: 'document-idle',
            defaultMatches: ['https://www.lenovo.com/*/cart*']
        },
        {
            id: 'landingpagePlus',
            name: 'LandingPage Plus',
            file: 'landingpagePlus.user.js',
            url: `${RAW_BASE_URL}/landingpagePlus.user.js`,
            defaultEnabled: true,
            defaultRunAt: 'document-idle',
            defaultMatches: ['https://www.lenovo.com/*', 'https://*.lenovo.com/*']
        }
    ];

    const executedModules = new Set();
    const inFlightFetches = new Map();
    const listeners = new Set();

    const updateStatus = {
        active: Boolean(bridge.isUpdatingCore),
        completed: 0,
        total: 0,
        text: bridge.isUpdatingCore ? 'Updating Toolbox Core…' : '',
        justFinished: false,
        finishTimer: null
    };

    function notifyListeners(event) {
        listeners.forEach((fn) => {
            try {
                fn(event);
            } catch (_) {
            }
        });
    }

    function setUpdateProgress(active, text, completed = 0, total = 0, justFinished = false) {
        if (updateStatus.finishTimer) {
            clearTimeout(updateStatus.finishTimer);
            updateStatus.finishTimer = null;
        }
        updateStatus.active = active;
        updateStatus.text = text || '';
        updateStatus.completed = completed;
        updateStatus.total = total;
        updateStatus.justFinished = justFinished;
        notifyListeners({ type: 'updateStatus', status: { ...updateStatus } });

        if (!active && justFinished) {
            updateStatus.finishTimer = setTimeout(() => {
                updateStatus.justFinished = false;
                updateStatus.text = '';
                notifyListeners({ type: 'updateStatus', status: { ...updateStatus } });
            }, 2400);
        }
    }

    bridge.onCoreUpdateStateChange = ({ isUpdating, message }) => {
        if (isUpdating) {
            setUpdateProgress(true, message || 'Updating Toolbox Core…', 0, 1, false);
        } else {
            setUpdateProgress(false, message || `Updated v${PACKAGE_VERSION}`, 1, 1, true);
        }
    };

    function readJsonValue(key, fallback) {
        try {
            if (bridge.GM_getValue) {
                const raw = bridge.GM_getValue(key, '');
                if (!raw) return fallback;
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            const raw = pageWin.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJsonValue(key, value) {
        try {
            const serialized = JSON.stringify(value);
            if (bridge.GM_setValue) {
                bridge.GM_setValue(key, serialized);
                return;
            }
            pageWin.localStorage.setItem(key, serialized);
        } catch (_) {
        }
    }

    function deleteStoredValue(key) {
        try {
            if (bridge.GM_deleteValue) {
                bridge.GM_deleteValue(key);
                return;
            }
            pageWin.localStorage.removeItem(key);
        } catch (_) {
        }
    }

    function compareSemVer(a, b) {
        const pa = String(a || '0.0.0')
            .replace(/^v/i, '')
            .split('.')
            .map((n) => parseInt(n, 10) || 0);
        const pb = String(b || '0.0.0')
            .replace(/^v/i, '')
            .split('.')
            .map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < 3; i++) {
            if ((pa[i] || 0) !== (pb[i] || 0)) {
                return (pb[i] || 0) - (pa[i] || 0);
            }
        }
        return 0;
    }

    function getSettings() {
        const stored = readJsonValue(SETTINGS_KEY, {});
        return stored && typeof stored === 'object' ? stored : {};
    }

    function saveSettings(settings) {
        writeJsonValue(SETTINGS_KEY, settings);
    }

    function readAllPackageSnapshots() {
        const map = readJsonValue(PACKAGE_SNAPSHOTS_KEY, null);
        if (map && typeof map === 'object') {
            return map;
        }
        return {};
    }

    function writeAllPackageSnapshots(snapshotsMap) {
        const keys = Object.keys(snapshotsMap).sort(compareSemVer);
        const trimmed = {};
        for (let i = 0; i < Math.min(keys.length, MAX_CACHED_VERSIONS); i++) {
            trimmed[keys[i]] = snapshotsMap[keys[i]];
        }
        writeJsonValue(PACKAGE_SNAPSHOTS_KEY, trimmed);
        return trimmed;
    }

    function migrateLegacyCacheIfNeeded() {
        const snapshots = readAllPackageSnapshots();
        let migratedAny = false;
        const legacyScripts = {};
        let oldestFetch = 0;

        MODULE_REGISTRY.forEach((mod) => {
            const legacyKey = `${LEGACY_SCRIPT_CACHE_PREFIX}${mod.id}`;
            const entry = readJsonValue(legacyKey, null);
            if (entry && typeof entry.code === 'string') {
                legacyScripts[mod.id] = entry;
                if (entry.fetchedAt && (!oldestFetch || entry.fetchedAt > oldestFetch)) {
                    oldestFetch = entry.fetchedAt;
                }
                migratedAny = true;
            }
        });

        if (migratedAny && !snapshots['0.0.1']) {
            snapshots['0.0.1'] = {
                version: '0.0.1',
                fetchedAt: oldestFetch || Date.now(),
                scripts: legacyScripts
            };
            writeAllPackageSnapshots(snapshots);
        }
    }

    migrateLegacyCacheIfNeeded();

    function getCachedPackageVersions() {
        const snapshots = readAllPackageSnapshots();
        const versions = Object.keys(snapshots).sort(compareSemVer);
        return versions.map((ver) => ({
            version: ver,
            fetchedAt: snapshots[ver]?.fetchedAt || null,
            scriptCount: Object.keys(snapshots[ver]?.scripts || {}).length
        }));
    }

    function getActivePackageVersion() {
        const settings = getSettings();
        const snapshots = readAllPackageSnapshots();
        if (settings.activePackageVersion && snapshots[settings.activePackageVersion]) {
            return settings.activePackageVersion;
        }
        const versions = Object.keys(snapshots).sort(compareSemVer);
        return versions[0] || PACKAGE_VERSION;
    }

    function setActivePackageVersion(version, reloadPage = false) {
        const snapshots = readAllPackageSnapshots();
        if (!snapshots[version]) return false;

        const settings = getSettings();
        settings.activePackageVersion = version;
        settings.pinnedByUser = version !== PACKAGE_VERSION;
        saveSettings(settings);

        notifyListeners({ type: 'versionChanged', version });
        if (reloadPage) {
            pageWin.location.reload();
        }
        return true;
    }

    function readScriptFromActivePackage(moduleId) {
        const snapshots = readAllPackageSnapshots();
        const activeVer = getActivePackageVersion();
        const activeSnap = snapshots[activeVer] || snapshots[PACKAGE_VERSION];
        const entry = activeSnap?.scripts?.[moduleId];
        if (entry && typeof entry === 'object' && typeof entry.code === 'string') {
            return {
                ...entry,
                packageVersion: activeSnap.version || activeVer,
                packageFetchedAt: activeSnap.fetchedAt || entry.fetchedAt || 0
            };
        }
        return null;
    }

    function writeScriptToPackageSnapshot(targetVersion, moduleId, code, meta) {
        const snapshots = readAllPackageSnapshots();
        const ver = targetVersion || PACKAGE_VERSION;
        const now = Date.now();

        if (!snapshots[ver]) {
            const existingVersions = Object.keys(snapshots).sort(compareSemVer);
            const baseScripts = existingVersions.length > 0 ? { ...(snapshots[existingVersions[0]]?.scripts || {}) } : {};
            snapshots[ver] = {
                version: ver,
                fetchedAt: now,
                scripts: baseScripts
            };
        }

        const entry = {
            code,
            meta: meta || {},
            fetchedAt: now
        };
        snapshots[ver].scripts[moduleId] = entry;
        snapshots[ver].fetchedAt = now;
        writeAllPackageSnapshots(snapshots);

        const settings = getSettings();
        if (!settings.pinnedByUser || !snapshots[settings.activePackageVersion]) {
            settings.activePackageVersion = ver;
            saveSettings(settings);
        }

        return entry;
    }

    function isActivePackageExpired() {
        const snapshots = readAllPackageSnapshots();
        const activeVer = getActivePackageVersion();
        const snap = snapshots[activeVer];
        if (!snap || !snap.fetchedAt) return true;
        return Date.now() - snap.fetchedAt >= CACHE_TTL_MS;
    }

    function isModuleEnabled(mod) {
        const settings = getSettings();
        if (typeof settings[mod.id]?.enabled === 'boolean') {
            return settings[mod.id].enabled;
        }
        return mod.defaultEnabled !== false;
    }

    function setModuleEnabled(moduleId, enabled) {
        const mod = MODULE_REGISTRY.find((m) => m.id === moduleId);
        if (!mod) return false;

        const settings = getSettings();
        settings[mod.id] = {
            ...(settings[mod.id] || {}),
            enabled: Boolean(enabled),
            updatedAt: Date.now()
        };
        saveSettings(settings);
        notifyListeners({ type: 'toggle', moduleId: mod.id, enabled: Boolean(enabled) });

        if (enabled && !executedModules.has(mod.id)) {
            loadAndRunModule(mod, false);
        }
        return Boolean(enabled);
    }

    function toggleModule(moduleId) {
        const mod = MODULE_REGISTRY.find((m) => m.id === moduleId);
        if (!mod) return false;
        const nextState = !isModuleEnabled(mod);
        return setModuleEnabled(moduleId, nextState);
    }

    function parseUserscriptHeader(code) {
        const meta = {
            name: '',
            version: '',
            description: '',
            runAt: '',
            matches: [],
            excludes: []
        };
        if (typeof code !== 'string' || !code.trim()) return meta;

        const headerMatch = code.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
        if (!headerMatch) return meta;

        const lines = headerMatch[1].split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const m = line.match(/^\/\/\s*@(\S+)\s+(.+)$/);
            if (!m) continue;
            const tag = m[1].trim().toLowerCase();
            const val = m[2].trim();
            if (!val) continue;

            if (tag === 'name' && !meta.name) meta.name = val;
            else if (tag === 'version' && !meta.version) meta.version = val;
            else if (tag === 'description' && !meta.description) meta.description = val;
            else if (tag === 'run-at' && !meta.runAt) meta.runAt = val.toLowerCase();
            else if (tag === 'match' || tag === 'include') meta.matches.push(val);
            else if (tag === 'exclude') meta.excludes.push(val);
        }

        return meta;
    }

    function matchPatternToRegExp(pattern) {
        if (!pattern || pattern === '*://*/*' || pattern === '<all_urls>') {
            return /^https?:\/\/.*/i;
        }
        let escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        escaped = escaped.replace(/^\*:\/\//, 'https?://');
        escaped = escaped.replace(/^(https?\??:\/\/)\*\\\./i, '$1(?:[^/]+\\.)?');
        escaped = escaped.replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`, 'i');
    }

    function doesUrlMatchPatterns(url, patterns) {
        if (!Array.isArray(patterns) || patterns.length === 0) return false;
        for (let i = 0; i < patterns.length; i++) {
            try {
                const regex = matchPatternToRegExp(patterns[i]);
                if (regex.test(url)) return true;
            } catch (_) {
            }
        }
        return false;
    }

    function doesModuleMatchUrl(mod, cachedEntry, url = pageWin.location.href) {
        if (isSubFrame && mod.id !== 'psrefLookup') {
            return false;
        }
        const meta = cachedEntry?.meta;
        const matches =
            Array.isArray(meta?.matches) && meta.matches.length > 0 ? meta.matches : mod.defaultMatches || [];
        const excludes = Array.isArray(meta?.excludes) ? meta.excludes : [];

        if (excludes.length > 0 && doesUrlMatchPatterns(url, excludes)) {
            return false;
        }
        return doesUrlMatchPatterns(url, matches);
    }

    function fetchRemoteScript(mod, targetPackageVersion = PACKAGE_VERSION) {
        if (inFlightFetches.has(mod.id)) {
            return inFlightFetches.get(mod.id);
        }

        const bustUrl = `${mod.url}${mod.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;
        const promise = new Promise((resolve, reject) => {
            if (bridge.GM_xmlhttpRequest) {
                bridge.GM_xmlhttpRequest({
                    method: 'GET',
                    url: bustUrl,
                    headers: {
                        Accept: 'application/javascript, text/plain, */*',
                        'Cache-Control': 'no-cache'
                    },
                    onload: (resp) => {
                        if (resp.status >= 200 && resp.status < 300 && typeof resp.responseText === 'string') {
                            resolve(resp.responseText);
                        } else {
                            reject(new Error(`HTTP ${resp.status} for ${mod.file}`));
                        }
                    },
                    onerror: (err) => reject(err || new Error(`Network error fetching ${mod.file}`)),
                    ontimeout: () => reject(new Error(`Timeout fetching ${mod.file}`))
                });
                return;
            }

            fetch(bustUrl, { cache: 'no-store' })
                .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status} for ${mod.file}`);
                    return res.text();
                })
                .then(resolve)
                .catch(reject);
        })
            .then((code) => {
                const meta = parseUserscriptHeader(code);
                const entry = writeScriptToPackageSnapshot(targetPackageVersion, mod.id, code, meta);
                notifyListeners({ type: 'refreshed', moduleId: mod.id, entry });
                return entry;
            })
            .finally(() => {
                inFlightFetches.delete(mod.id);
            });

        inFlightFetches.set(mod.id, promise);
        return promise;
    }

    function scheduleByRunAt(runAt, callback) {
        const mode = (runAt || 'document-idle').toLowerCase();

        if (mode === 'document-start') {
            callback();
            return;
        }

        if (mode === 'document-end') {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                callback();
            } else {
                document.addEventListener('DOMContentLoaded', callback, { once: true });
            }
            return;
        }

        if (document.readyState === 'complete') {
            setTimeout(callback, 0);
        } else if (document.readyState === 'interactive') {
            setTimeout(callback, 50);
        } else {
            document.addEventListener(
                'DOMContentLoaded',
                () => {
                    setTimeout(callback, 50);
                },
                { once: true }
            );
        }
    }

    function executeModuleCode(mod, cachedEntry) {
        if (executedModules.has(mod.id)) return;
        const code = cachedEntry?.code;
        if (typeof code !== 'string' || !code.trim()) {
            return;
        }

        if (!isModuleEnabled(mod)) return;
        if (!doesModuleMatchUrl(mod, cachedEntry)) return;

        const runAt = cachedEntry?.meta?.runAt || mod.defaultRunAt || 'document-idle';
        executedModules.add(mod.id);

        scheduleByRunAt(runAt, () => {
            if (!isModuleEnabled(mod)) return;
            try {
                const fn = new Function(
                    'window',
                    'self',
                    'globalThis',
                    'unsafeWindow',
                    'GM_xmlhttpRequest',
                    'GM_getValue',
                    'GM_setValue',
                    'GM_deleteValue',
                    'GM_listValues',
                    'GM_addValueChangeListener',
                    'GM_registerMenuCommand',
                    `${code}\n//# sourceURL=yogis-toolbox://${mod.file}`
                );
                fn(
                    pageWin,
                    pageWin,
                    pageWin,
                    pageWin,
                    bridge.GM_xmlhttpRequest,
                    bridge.GM_getValue,
                    bridge.GM_setValue,
                    bridge.GM_deleteValue,
                    bridge.GM_listValues,
                    bridge.GM_addValueChangeListener,
                    bridge.GM_registerMenuCommand
                );
                notifyListeners({ type: 'executed', moduleId: mod.id });
            } catch (err) {
                executedModules.delete(mod.id);
                console.error(`[Yogi's Toolbox] Error executing ${mod.file}:`, err);
            }
        });
    }

    function loadAndRunModule(mod, forceRefresh = false) {
        if (!isModuleEnabled(mod) && !forceRefresh) return Promise.resolve(null);

        const cached = readScriptFromActivePackage(mod.id);
        const now = Date.now();
        const isExpired = !cached || !cached.fetchedAt || now - cached.fetchedAt >= CACHE_TTL_MS;

        if (cached && !forceRefresh) {
            executeModuleCode(mod, cached);
            return Promise.resolve(cached);
        }

        if (!forceRefresh && !doesModuleMatchUrl(mod, cached)) {
            return Promise.resolve(cached);
        }

        setUpdateProgress(true, `Updating ${mod.name}…`, 0, 1, false);
        return fetchRemoteScript(mod, PACKAGE_VERSION)
            .then((freshEntry) => {
                setUpdateProgress(false, `Updated v${PACKAGE_VERSION}`, 1, 1, true);
                executeModuleCode(mod, freshEntry);
                return freshEntry;
            })
            .catch((err) => {
                setUpdateProgress(false, 'Update failed (using cache)', 0, 1, true);
                console.warn(`[Yogi's Toolbox] Failed to fetch ${mod.file}, falling back to cache:`, err);
                if (cached) {
                    executeModuleCode(mod, cached);
                }
                return cached;
            });
    }

    function getModulesStatus() {
        const now = Date.now();
        const activePkgVer = getActivePackageVersion();
        return MODULE_REGISTRY.map((mod) => {
            const cached = readScriptFromActivePackage(mod.id);
            const fetchedAt = cached?.fetchedAt || 0;
            const cacheAgeMs = fetchedAt ? Math.max(0, now - fetchedAt) : null;
            const isExpired = !fetchedAt || now - fetchedAt >= CACHE_TTL_MS;
            const hasCode = Boolean(cached?.code && cached.code.trim());

            return {
                id: mod.id,
                name: cached?.meta?.name || mod.name,
                file: mod.file,
                url: mod.url,
                packageVersion: activePkgVer,
                version: cached?.meta?.version || '—',
                description: cached?.meta?.description || '',
                runAt: cached?.meta?.runAt || mod.defaultRunAt,
                enabled: isModuleEnabled(mod),
                cached: Boolean(cached),
                hasCode,
                fetchedAt: fetchedAt || null,
                cacheAgeMs,
                cacheTtlMs: CACHE_TTL_MS,
                isExpired,
                matchesCurrentUrl: doesModuleMatchUrl(mod, cached),
                executed: executedModules.has(mod.id)
            };
        });
    }

    function refreshAll(options = { includeCore: true }) {
        const total = MODULE_REGISTRY.length + (options?.includeCore ? 1 : 0);
        let completed = 0;

        const settings = getSettings();
        settings.pinnedByUser = false;
        settings.activePackageVersion = PACKAGE_VERSION;
        saveSettings(settings);

        setUpdateProgress(true, `Updating scripts (0/${total})…`, 0, total, false);

        const bump = (label) => {
            completed++;
            setUpdateProgress(true, `Updating ${label} (${completed}/${total})…`, completed, total, false);
        };

        const tasks = MODULE_REGISTRY.map((mod) =>
            fetchRemoteScript(mod, PACKAGE_VERSION)
                .then((entry) => {
                    bump(mod.name);
                    executeModuleCode(mod, entry);
                    return entry;
                })
                .catch((err) => {
                    bump(mod.name);
                    console.warn(`[Yogi's Toolbox] Refresh failed for ${mod.file}:`, err);
                    return null;
                })
        );

        if (options?.includeCore && typeof bridge.refreshCore === 'function') {
            tasks.push(
                bridge
                    .refreshCore()
                    .then((res) => {
                        bump('Core');
                        return res;
                    })
                    .catch(() => {
                        bump('Core');
                        return null;
                    })
            );
        }

        return Promise.all(tasks).then((results) => {
            setUpdateProgress(false, `Updated to v${PACKAGE_VERSION}`, total, total, true);
            notifyListeners({ type: 'refreshAll', timestamp: Date.now() });
            return results;
        });
    }

    function clearCache() {
        deleteStoredValue(PACKAGE_SNAPSHOTS_KEY);
        MODULE_REGISTRY.forEach((mod) => {
            deleteStoredValue(`${LEGACY_SCRIPT_CACHE_PREFIX}${mod.id}`);
        });
        notifyListeners({ type: 'clearCache', timestamp: Date.now() });
    }

    function shouldMountLenovoUi() {
        if (isSubFrame) return false;
        const host = (pageWin.location.hostname || '').toLowerCase();
        return /(^|\.)lenovo\.com$/i.test(host) && host !== 'psref.lenovo.com';
    }

    function formatAgeShort(ms) {
        if (ms === null || ms === undefined) return 'Not cached';
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        return `${hrs}h ${mins % 60}m ago`;
    }

    function mountLenovoToolboxUi() {
        if (!shouldMountLenovoUi()) return;
        if (!document.body || !document.head) return;
        if (document.getElementById('ytb-lenovo-root')) return;

        const style = document.createElement('style');
        style.id = 'ytb-lenovo-styles';
        style.textContent = `
            #ytb-lenovo-root {
                position: fixed !important;
                left: 10px !important;
                bottom: 10px !important;
                z-index: 2147483640 !important;
                font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                font-size: 12px !important;
                line-height: 1.4 !important;
                color: #171717 !important;
                user-select: none !important;
            }
            #ytb-lenovo-root * {
                box-sizing: border-box !important;
                font-family: inherit !important;
            }
            .ytb-trigger {
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                height: 22px !important;
                padding: 0 7px !important;
                border: 1px solid #d1d5db !important;
                border-radius: 2px !important;
                background: #ffffff !important;
                color: #171717 !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                opacity: 0.16 !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06) !important;
                transition: opacity 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease !important;
            }
            #ytb-lenovo-root:hover .ytb-trigger,
            #ytb-lenovo-root.ytb-open .ytb-trigger,
            .ytb-trigger.ytb-updating {
                opacity: 1 !important;
                border-color: #171717 !important;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12) !important;
            }
            .ytb-trigger-dot {
                width: 6px !important;
                height: 6px !important;
                border-radius: 50% !important;
                background: #171717 !important;
                flex-shrink: 0 !important;
            }
            .ytb-trigger.ytb-updating .ytb-trigger-dot {
                background: #d97706 !important;
                animation: ytb-pulse 0.9s infinite alternate !important;
            }
            .ytb-trigger.ytb-updated .ytb-trigger-dot {
                background: #1a7f37 !important;
            }
            @keyframes ytb-pulse {
                from { opacity: 0.35; transform: scale(0.85); }
                to { opacity: 1; transform: scale(1.15); }
            }
            @keyframes ytb-spin {
                to { transform: rotate(360deg); }
            }
            .ytb-panel {
                display: none !important;
                position: absolute !important;
                left: 0 !important;
                bottom: 28px !important;
                width: 268px !important;
                background: #ffffff !important;
                border: 1px solid #d1d5db !important;
                border-radius: 2px !important;
                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12) !important;
                overflow: hidden !important;
            }
            #ytb-lenovo-root.ytb-open .ytb-panel {
                display: block !important;
            }
            .ytb-header {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 6px !important;
                padding: 8px 10px !important;
                background: #171717 !important;
                color: #ffffff !important;
            }
            .ytb-title {
                font-size: 12px !important;
                font-weight: 700 !important;
                letter-spacing: 0.2px !important;
                white-space: nowrap !important;
            }
            .ytb-header-controls {
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
            }
            .ytb-ver-select {
                height: 20px !important;
                padding: 0 4px !important;
                border: 1px solid #4b5563 !important;
                border-radius: 2px !important;
                background: #262626 !important;
                color: #f9fafb !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                outline: none !important;
            }
            .ytb-ver-select:hover {
                border-color: #9ca3af !important;
            }
            .ytb-refresh-btn {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 20px !important;
                height: 20px !important;
                padding: 0 !important;
                border: 1px solid #4b5563 !important;
                border-radius: 2px !important;
                background: #262626 !important;
                color: #ffffff !important;
                font-size: 12px !important;
                line-height: 1 !important;
                cursor: pointer !important;
                transition: background 0.15s ease, border-color 0.15s ease !important;
            }
            .ytb-refresh-btn:hover {
                background: #374151 !important;
                border-color: #9ca3af !important;
            }
            .ytb-refresh-btn.ytb-spinning span {
                display: inline-block !important;
                animation: ytb-spin 0.8s linear infinite !important;
            }
            .ytb-status-bar {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 5px 10px !important;
                background: #f9fafb !important;
                border-bottom: 1px solid #e5e7eb !important;
                color: #6b7280 !important;
                font-size: 10.5px !important;
            }
            .ytb-status-bar.ytb-status-updating {
                background: #fffbeb !important;
                color: #92400e !important;
                font-weight: 600 !important;
            }
            .ytb-status-bar.ytb-status-done {
                background: #f0fdf4 !important;
                color: #166534 !important;
                font-weight: 600 !important;
            }
            .ytb-list {
                display: flex !important;
                flex-direction: column !important;
                padding: 4px 0 !important;
            }
            .ytb-row {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 8px !important;
                padding: 6px 10px !important;
                transition: background 0.12s ease !important;
            }
            .ytb-row:hover {
                background: #f3f4f6 !important;
            }
            .ytb-row-info {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                min-width: 0 !important;
            }
            .ytb-active-dot {
                width: 5px !important;
                height: 5px !important;
                border-radius: 50% !important;
                background: #d1d5db !important;
                flex-shrink: 0 !important;
            }
            .ytb-active-dot.ytb-match {
                background: #1a7f37 !important;
            }
            .ytb-row-name {
                font-size: 11.5px !important;
                font-weight: 500 !important;
                color: #171717 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
            }
            .ytb-row.ytb-disabled .ytb-row-name {
                color: #9ca3af !important;
            }
            .ytb-switch {
                position: relative !important;
                width: 28px !important;
                height: 15px !important;
                border-radius: 999px !important;
                background: #d1d5db !important;
                border: none !important;
                padding: 0 !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
                transition: background 0.15s ease !important;
            }
            .ytb-switch.ytb-on {
                background: #171717 !important;
            }
            .ytb-switch::after {
                content: "" !important;
                position: absolute !important;
                top: 2px !important;
                left: 2px !important;
                width: 11px !important;
                height: 11px !important;
                border-radius: 50% !important;
                background: #ffffff !important;
                transition: transform 0.15s ease !important;
            }
            .ytb-switch.ytb-on::after {
                transform: translateX(13px) !important;
            }
        `;
        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'ytb-lenovo-root';

        const panel = document.createElement('div');
        panel.className = 'ytb-panel';

        const header = document.createElement('div');
        header.className = 'ytb-header';

        const title = document.createElement('span');
        title.className = 'ytb-title';
        title.textContent = "Yogi's Toolbox";
        header.appendChild(title);

        const headerControls = document.createElement('div');
        headerControls.className = 'ytb-header-controls';

        const verSelect = document.createElement('select');
        verSelect.className = 'ytb-ver-select';
        verSelect.title = 'Select cached package version';
        verSelect.addEventListener('change', () => {
            const chosen = verSelect.value;
            if (chosen && chosen !== getActivePackageVersion()) {
                setActivePackageVersion(chosen, true);
            }
        });
        headerControls.appendChild(verSelect);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'ytb-refresh-btn';
        refreshBtn.title = 'Pull latest package from GitHub';
        refreshBtn.innerHTML = '<span>↻</span>';
        refreshBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (updateStatus.active) return;
            refreshAll({ includeCore: true });
        });
        headerControls.appendChild(refreshBtn);

        header.appendChild(headerControls);
        panel.appendChild(header);

        const statusBar = document.createElement('div');
        statusBar.className = 'ytb-status-bar';
        panel.appendChild(statusBar);

        const listEl = document.createElement('div');
        listEl.className = 'ytb-list';
        panel.appendChild(listEl);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ytb-trigger';
        trigger.title = "Yogi's Toolbox";

        const triggerDot = document.createElement('span');
        triggerDot.className = 'ytb-trigger-dot';
        trigger.appendChild(triggerDot);

        const triggerLabel = document.createElement('span');
        triggerLabel.textContent = 'YT';
        trigger.appendChild(triggerLabel);

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = root.classList.toggle('ytb-open');
            if (isOpen) renderUiState();
        });

        root.appendChild(panel);
        root.appendChild(trigger);
        document.body.appendChild(root);

        document.addEventListener('click', (e) => {
            if (root.classList.contains('ytb-open') && !root.contains(e.target)) {
                root.classList.remove('ytb-open');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && root.classList.contains('ytb-open')) {
                root.classList.remove('ytb-open');
            }
        });

        function renderUiState() {
            const activeVer = getActivePackageVersion();
            const cachedVersions = getCachedPackageVersions();
            const modules = getModulesStatus();

            trigger.classList.toggle('ytb-updating', Boolean(updateStatus.active || updateStatus.justFinished));
            trigger.classList.toggle('ytb-updated', Boolean(!updateStatus.active && updateStatus.justFinished));
            if (updateStatus.active) {
                triggerLabel.textContent = updateStatus.text || 'Updating scripts…';
            } else if (updateStatus.justFinished && updateStatus.text) {
                triggerLabel.textContent = `✓ ${updateStatus.text}`;
            } else {
                triggerLabel.textContent = `YT v${activeVer}`;
            }

            refreshBtn.classList.toggle('ytb-spinning', Boolean(updateStatus.active));

            verSelect.textContent = '';
            const versionList =
                cachedVersions.length > 0 ? cachedVersions : [{ version: activeVer, fetchedAt: null, scriptCount: 0 }];
            versionList.forEach((v) => {
                const opt = document.createElement('option');
                opt.value = v.version;
                opt.textContent = `v${v.version}`;
                if (v.version === activeVer) opt.selected = true;
                verSelect.appendChild(opt);
            });

            statusBar.className = 'ytb-status-bar';
            if (updateStatus.active) {
                statusBar.classList.add('ytb-status-updating');
                statusBar.textContent = updateStatus.text || 'Updating package from GitHub…';
            } else if (updateStatus.justFinished && updateStatus.text) {
                statusBar.classList.add('ytb-status-done');
                statusBar.textContent = `✓ ${updateStatus.text}`;
            } else {
                const activeSnap = cachedVersions.find((v) => v.version === activeVer);
                const ageText = formatAgeShort(activeSnap?.fetchedAt ? Date.now() - activeSnap.fetchedAt : null);
                statusBar.textContent = `Cached: ${ageText} • 12h cycle`;
            }

            listEl.textContent = '';
            modules.forEach((m) => {
                const row = document.createElement('div');
                row.className = `ytb-row${m.enabled ? '' : ' ytb-disabled'}`;

                const info = document.createElement('div');
                info.className = 'ytb-row-info';

                const dot = document.createElement('span');
                dot.className = `ytb-active-dot${m.matchesCurrentUrl && m.enabled ? ' ytb-match' : ''}`;
                dot.title = m.matchesCurrentUrl
                    ? m.enabled
                        ? 'Active on this page'
                        : 'Matches this page (disabled)'
                    : 'Inactive on this URL';
                info.appendChild(dot);

                const name = document.createElement('span');
                name.className = 'ytb-row-name';
                name.textContent = m.name;
                info.appendChild(name);

                row.appendChild(info);

                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = `ytb-switch${m.enabled ? ' ytb-on' : ''}`;
                toggleBtn.setAttribute('aria-pressed', m.enabled ? 'true' : 'false');
                toggleBtn.title = m.enabled ? `Disable ${m.name}` : `Enable ${m.name}`;
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const next = !m.enabled;
                    setModuleEnabled(m.id, next);
                    if (!next && m.executed) {
                        statusBar.textContent = 'Reload page to unload disabled script';
                    }
                });

                row.appendChild(toggleBtn);
                listEl.appendChild(row);
            });
        }

        listeners.add(renderUiState);
        renderUiState();
    }

    const controller = {
        version: PACKAGE_VERSION,
        cacheTtlMs: CACHE_TTL_MS,
        rawBaseUrl: RAW_BASE_URL,
        getModules: getModulesStatus,
        getCachedPackageVersions,
        getActivePackageVersion,
        setActivePackageVersion,
        isModuleEnabled: (id) => {
            const mod = MODULE_REGISTRY.find((m) => m.id === id);
            return mod ? isModuleEnabled(mod) : false;
        },
        setModuleEnabled,
        toggleModule,
        refreshAll,
        clearCache,
        subscribe: (fn) => {
            if (typeof fn === 'function') {
                listeners.add(fn);
                return () => listeners.delete(fn);
            }
            return () => {};
        }
    };

    pageWin.__YOGIS_TOOLBOX__ = controller;
    bridge.controller = controller;

    if (!isSubFrame && bridge.GM_registerMenuCommand) {
        try {
            bridge.GM_registerMenuCommand('🔄 Refresh All Toolbox Scripts (12h Cache)', () => {
                refreshAll({ includeCore: true }).then(() => {
                    pageWin.location.reload();
                });
            });

            MODULE_REGISTRY.forEach((mod) => {
                const enabled = isModuleEnabled(mod);
                const statusIcon = enabled ? '✅' : '❌';
                bridge.GM_registerMenuCommand(`${statusIcon} ${mod.name} (Click to Toggle)`, () => {
                    toggleModule(mod.id);
                    pageWin.location.reload();
                });
            });
        } catch (_) {
        }
    }

    if (shouldMountLenovoUi()) {
        if (document.body && document.head) {
            mountLenovoToolboxUi();
        } else {
            document.addEventListener('DOMContentLoaded', mountLenovoToolboxUi, { once: true });
            pageWin.addEventListener('load', mountLenovoToolboxUi, { once: true });
        }
    }

    const needFullPackageRefresh = !isSubFrame && isActivePackageExpired();
    MODULE_REGISTRY.forEach((mod) => {
        if (isModuleEnabled(mod)) {
            loadAndRunModule(mod, false);
        }
    });

    if (needFullPackageRefresh) {
        refreshAll({ includeCore: false });
    }
})();
