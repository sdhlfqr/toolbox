// ==UserScript==
// @name         PSREF Lookup
// @namespace    https://www.lenovo.com/
// @version      0.1.1
// @description  Click-to-copy part numbers and instant PSREF hover menus (Models, Specs, Accessories) in cart & quote details
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lenovo.com
// @match        https://www.lenovo.com/*/cart*
// @match        https://account.lenovo.com/*/account/quote/detail*
// @match        https://psref.lenovo.com/*
// @connect      psref.lenovo.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const HOVER_MENU_CLASS = 'psref-hover-actions';
    const STYLE_ID = 'psref-link-styles';
    const TOKEN_STORAGE_KEY = 'psref_bearer_token';
    const TOKEN_ENDPOINT_KEY = 'psref_token_endpoint_v1';
    const EXPIRY_BUFFER_MS = 10 * 1000;

    function parseJwtPayload(tokenOrBearer) {
        if (!tokenOrBearer || typeof tokenOrBearer !== 'string') return null;
        try {
            const raw = tokenOrBearer.replace(/^Bearer\s+/i, '').trim();
            const parts = raw.split('.');
            if (parts.length < 3) return null;
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            return JSON.parse(atob(padded));
        } catch (_) {
            return null;
        }
    }

    function getJwtExpiryMs(tokenOrBearer) {
        const payload = parseJwtPayload(tokenOrBearer);
        return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    }

    function isTokenFresh(tokenOrBearer) {
        if (!tokenOrBearer) return false;
        const expMs = getJwtExpiryMs(tokenOrBearer);
        return expMs > Date.now() + EXPIRY_BUFFER_MS;
    }

    function normalizeBearerToken(raw) {
        if (!raw) return '';
        if (typeof raw === 'object') {
            const jwtCandidate = raw.jwt || raw.token || raw.access_token || raw.data?.jwt || raw.data?.token || '';
            if (typeof jwtCandidate === 'string' && jwtCandidate.trim()) {
                return normalizeBearerToken(jwtCandidate);
            }
            return '';
        }
        if (typeof raw !== 'string') return '';
        const trimmed = raw.trim();
        if (!trimmed) return '';

        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                return normalizeBearerToken(parsed);
            } catch (_) {
            }
        }

        const jwtMatch = trimmed.match(/(?:Bearer\s+)?(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i);
        if (jwtMatch && jwtMatch[1]) {
            const candidate = `Bearer ${jwtMatch[1]}`;
            const payload = parseJwtPayload(candidate);
            if (payload) {
                return candidate;
            }
        }
        return '';
    }

    function getBearerToken() {
        try {
            if (typeof GM_getValue === 'function') {
                const saved = normalizeBearerToken(GM_getValue(TOKEN_STORAGE_KEY, ''));
                if (saved && isTokenFresh(saved)) {
                    return saved;
                }
            }
        } catch (_) {
        }
        return '';
    }

    function saveCapturedBearerToken(rawAuth) {
        const token = normalizeBearerToken(rawAuth);
        if (!token || !isTokenFresh(token)) return '';

        const payload = parseJwtPayload(token);
        if (payload && payload.kid && payload.kid !== 'psref-default') {
            return '';
        }

        try {
            if (typeof GM_setValue === 'function') {
                const current =
                    typeof GM_getValue === 'function' ? normalizeBearerToken(GM_getValue(TOKEN_STORAGE_KEY, '')) : '';
                const currentExp = getJwtExpiryMs(current);
                const expMs = getJwtExpiryMs(token);
                if (token !== current && (!currentExp || !isTokenFresh(current) || expMs >= currentExp)) {
                    GM_setValue(TOKEN_STORAGE_KEY, token);
                }
            }
        } catch (_) {
        }
        return token;
    }

    function saveDiscoveredTokenEndpoint(url, method = 'GET') {
        if (!url || typeof url !== 'string') return;
        try {
            const fullUrl = new URL(url, 'https://psref.lenovo.com').toString();
            if (!fullUrl.startsWith('https://psref.lenovo.com/')) return;
            if (/\/Suggest\b/i.test(fullUrl)) return;
            if (typeof GM_setValue === 'function') {
                GM_setValue(TOKEN_ENDPOINT_KEY, JSON.stringify({ url: fullUrl, method: method || 'GET' }));
            }
        } catch (_) {
        }
    }

    function extractAuthHeader(headers) {
        if (!headers) return '';
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            return headers.get('authorization') || headers.get('Authorization') || '';
        }
        if (Array.isArray(headers)) {
            for (let i = 0; i < headers.length; i++) {
                const pair = headers[i];
                if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[0].toLowerCase() === 'authorization') {
                    return pair[1] || '';
                }
            }
            return '';
        }
        if (typeof headers === 'object') {
            return headers.authorization || headers.Authorization || '';
        }
        return '';
    }

    function scanStorageForPsrefToken(win) {
        try {
            for (const storage of [win.localStorage, win.sessionStorage]) {
                if (!storage) continue;

                const directPsrefAt = storage.getItem('psref_at');
                if (directPsrefAt) {
                    const captured = saveCapturedBearerToken(directPsrefAt);
                    if (captured) return captured;
                }

                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    const val = key ? storage.getItem(key) : '';
                    if (!val || typeof val !== 'string') continue;
                    if (key === 'psref_at' || /psref/i.test(key) || val.includes('eyJ')) {
                        const candidate = normalizeBearerToken(val);
                        const payload = parseJwtPayload(candidate);
                        if (payload && (payload.kid === 'psref-default' || /psref/i.test(key))) {
                            const captured = saveCapturedBearerToken(candidate);
                            if (captured) return captured;
                        }
                    }
                }
            }
        } catch (_) {
        }
        return '';
    }

    function inspectPsrefResponseForToken(reqUrl, responseText) {
        if (!responseText || typeof responseText !== 'string' || !responseText.includes('eyJ')) return '';
        const token = saveCapturedBearerToken(responseText);
        if (token && reqUrl) {
            saveDiscoveredTokenEndpoint(reqUrl, 'GET');
        }
        return token;
    }

    function captureTokenOnPsrefSite() {
        if (window.location.hostname !== 'psref.lenovo.com') return false;

        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        try {
            const StorageProto = pageWin.Storage?.prototype || window.Storage?.prototype;
            const origSetItem = StorageProto?.setItem;
            if (typeof origSetItem === 'function' && !StorageProto._psrefSetItemHooked) {
                StorageProto._psrefSetItemHooked = true;
                StorageProto.setItem = function (key, value) {
                    const res = origSetItem.apply(this, arguments);
                    try {
                        if (key === 'psref_at' || (typeof value === 'string' && value.includes('eyJ'))) {
                            saveCapturedBearerToken(value);
                        }
                    } catch (_) {
                    }
                    return res;
                };
            }
        } catch (_) {
        }

        try {
            const origFetch = pageWin.fetch;
            if (typeof origFetch === 'function' && !pageWin._psrefFetchHooked) {
                pageWin._psrefFetchHooked = true;
                pageWin.fetch = function (...args) {
                    const reqObj = args[0];
                    const reqInit = args[1];
                    const reqUrl = typeof reqObj === 'string' ? reqObj : reqObj?.url || '';
                    try {
                        const auth =
                            extractAuthHeader(reqInit?.headers) ||
                            (typeof pageWin.Request === 'function' && reqObj instanceof pageWin.Request
                                ? extractAuthHeader(reqObj.headers)
                                : '') ||
                            (typeof Request === 'function' && reqObj instanceof Request
                                ? extractAuthHeader(reqObj.headers)
                                : '');
                        if (auth) saveCapturedBearerToken(auth);
                    } catch (_) {
                    }
                    const promise = origFetch.apply(this, args);
                    promise
                        .then((resp) => {
                            if (resp && resp.ok) {
                                resp.clone()
                                    .text()
                                    .then((txt) => inspectPsrefResponseForToken(reqUrl, txt))
                                    .catch(() => {});
                            }
                        })
                        .catch(() => {});
                    return promise;
                };
            }
        } catch (_) {
        }

        try {
            const XhrCtor = pageWin.XMLHttpRequest || window.XMLHttpRequest;
            const origOpen = XhrCtor?.prototype?.open;
            const origSetRequestHeader = XhrCtor?.prototype?.setRequestHeader;
            if (typeof origOpen === 'function' && !XhrCtor.prototype._psrefOpenHooked) {
                XhrCtor.prototype._psrefOpenHooked = true;
                XhrCtor.prototype.open = function (method, url) {
                    this._psrefUrl = typeof url === 'string' ? url : '';
                    this.addEventListener('load', function () {
                        try {
                            if (typeof this.responseText === 'string' && this.responseText.includes('eyJ')) {
                                inspectPsrefResponseForToken(this._psrefUrl, this.responseText);
                            }
                        } catch (_) {
                        }
                    });
                    return origOpen.apply(this, arguments);
                };
            }
            if (typeof origSetRequestHeader === 'function' && !XhrCtor.prototype._psrefHeaderHooked) {
                XhrCtor.prototype._psrefHeaderHooked = true;
                XhrCtor.prototype.setRequestHeader = function (name, value) {
                    try {
                        if (typeof name === 'string' && name.toLowerCase() === 'authorization') {
                            saveCapturedBearerToken(value);
                        }
                    } catch (_) {
                    }
                    return origSetRequestHeader.apply(this, arguments);
                };
            }
        } catch (_) {
        }

        scanStorageForPsrefToken(pageWin);
        pageWin.addEventListener('storage', () => scanStorageForPsrefToken(pageWin));
        document.addEventListener('DOMContentLoaded', () => scanStorageForPsrefToken(pageWin), { once: true });
        window.addEventListener('load', () => scanStorageForPsrefToken(pageWin), { once: true });

        let pollCount = 0;
        const pollTimer = setInterval(() => {
            pollCount++;
            if (scanStorageForPsrefToken(pageWin) || pollCount >= 40) {
                clearInterval(pollTimer);
            }
        }, 350);

        return true;
    }

    if (captureTokenOnPsrefSite()) return;

    const urlCache = new Map();

    function injectStyles() {
        if (document.getElementById(STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .psref-pn-wrap {
                display: inline !important;
            }
            .psref-copyable-pn {
                cursor: pointer !important;
                transition: color 0.15s ease !important;
            }
            .psref-copied {
                color: #1a7f37 !important;
            }
            .psref-copied::after {
                content: ' ✓' !important;
                color: #1a7f37 !important;
                font-weight: 700 !important;
                font-size: 11px !important;
            }
            html body .${HOVER_MENU_CLASS} {
                display: inline-flex !important;
                flex-wrap: wrap !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 6px !important;
                margin: 0 0 0 8px !important;
                padding: 0 !important;
                width: auto !important;
                min-width: 0 !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                transition: opacity 0.15s ease !important;
                font-size: 11px !important;
                line-height: 1.2 !important;
                letter-spacing: normal !important;
                word-spacing: normal !important;
                text-align: left !important;
                vertical-align: baseline !important;
            }
            html body .partNumber:hover .${HOVER_MENU_CLASS},
            html body .psref-pn-wrap:hover .${HOVER_MENU_CLASS},
            html body .item-detail-list-product-info:hover .${HOVER_MENU_CLASS},
            html body .item-detail-list-children-container-info:hover .${HOVER_MENU_CLASS},
            html body .${HOVER_MENU_CLASS}:hover {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }
            html body .${HOVER_MENU_CLASS} a,
            html body .${HOVER_MENU_CLASS} a:link,
            html body .${HOVER_MENU_CLASS} a:visited {
                display: inline !important;
                flex: 0 0 auto !important;
                float: none !important;
                position: static !important;
                width: auto !important;
                max-width: none !important;
                min-width: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                background: transparent !important;
                color: #666 !important;
                text-decoration: none !important;
                font-size: 11px !important;
                font-weight: 500 !important;
                line-height: 1.2 !important;
                letter-spacing: normal !important;
                word-spacing: normal !important;
                white-space: nowrap !important;
                cursor: pointer !important;
            }
            html body .${HOVER_MENU_CLASS} a:hover {
                color: #111 !important;
                text-decoration: underline !important;
            }
            html body .${HOVER_MENU_CLASS} .psref-sep {
                display: inline !important;
                flex: 0 0 auto !important;
                float: none !important;
                position: static !important;
                width: auto !important;
                max-width: none !important;
                min-width: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                color: #aaa !important;
                font-size: 11px !important;
                line-height: 1.2 !important;
                letter-spacing: normal !important;
                word-spacing: normal !important;
                user-select: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    function getPartNumberSpan(partNumberEl) {
        if (!partNumberEl) return null;
        return partNumberEl.querySelector(`span:not(.${HOVER_MENU_CLASS}):not(.psref-sep)`);
    }

    function extractPartNumber(partNumberEl) {
        if (!partNumberEl) return '';
        if (partNumberEl.dataset?.psrefPn) {
            return partNumberEl.dataset.psrefPn.trim().toUpperCase();
        }
        const span = getPartNumberSpan(partNumberEl);
        if (span && span.textContent.trim()) {
            const candidate = span.textContent.trim().toUpperCase();
            if (/^[A-Z0-9]{4,15}$/i.test(candidate) && /\d/.test(candidate)) {
                return candidate;
            }
        }

        let rawText = '';
        for (let i = 0; i < partNumberEl.childNodes.length; i++) {
            const node = partNumberEl.childNodes[i];
            if (node.nodeType === 1 && node.classList?.contains(HOVER_MENU_CLASS)) continue;
            rawText += node.textContent || '';
        }

        const afterColon = rawText.split(':').pop()?.trim() || '';
        const codeMatch = afterColon.match(/\b([A-Z0-9]{4,15})\b/i);
        if (codeMatch && /\d/.test(codeMatch[1])) {
            return codeMatch[1].toUpperCase();
        }

        const itemContainer =
            partNumberEl.closest('.subItem, .productcart, .item-detail-list-product') || partNumberEl.parentElement;
        if (itemContainer) {
            const urlEl = itemContainer.querySelector('a.productNameInfoUrl, a.item-detail-list-product-name');
            const href = urlEl?.getAttribute('href') || '';
            const segMatch = href.match(/\/([a-z0-9]{8,14})(?:[/?#]|$)/i);
            if (segMatch) {
                return segMatch[1].toUpperCase();
            }
        }

        return '';
    }

    function setTabOnProductUrl(rawUrl, tabName) {
        if (!rawUrl) return '';
        let full = rawUrl.trim();
        if (full.startsWith('/')) {
            full = `https://psref.lenovo.com${full}`;
        }
        full = full.replace(/https:\/\/psref\.lenovo\.com\/Product\//i, 'https://psref.lenovo.com/product/');

        try {
            const urlObj = new URL(full);
            urlObj.searchParams.set('tab', tabName);
            return urlObj.toString();
        } catch (_) {
            const base = full.split('?')[0];
            return `${base}?tab=${encodeURIComponent(tabName)}`;
        }
    }

    function deriveProductBaseUrlFromSlug(slug, brandHint) {
        if (!slug) return '';
        const cleanSlug = slug.replace(/^\/+|\/+$/g, '');
        if (cleanSlug.includes('/')) {
            return `https://psref.lenovo.com/product/${cleanSlug}`;
        }
        const brand = (brandHint || cleanSlug.split('_')[0] || 'Lenovo').replace(/[^A-Za-z0-9]/g, '');
        return `https://psref.lenovo.com/product/${brand}/${cleanSlug}`;
    }

    function buildAccessoryLinks(accCode) {
        const cleanCode = accCode.trim();
        const encoded = encodeURIComponent(cleanCode);
        return {
            isAccessory: true,
            overviewUrl: `https://psref.lenovo.com/l/accessory/${encoded}?tab=Overview`,
            specsUrl: `https://psref.lenovo.com/l/accessory/${encoded}?tab=Specifications`,
            compatibilityUrl: `https://psref.lenovo.com/l/accessory/${encoded}?tab=Compatibility`
        };
    }

    function parsePsrefUrlsFromSuggestResponse(data, queryCode, fullPartNumber) {
        if (!data) return null;

        const obj =
            typeof data === 'string'
                ? (() => {
                    try {
                        return JSON.parse(data);
                    } catch (_) {
                        return null;
                    }
                })()
                : data;

        const isCto = /CTO/i.test(fullPartNumber);
        const isPrefixFallback = queryCode.length === 4 && fullPartNumber.length > 4 && !isCto;
        const normalizedFull = fullPartNumber.toUpperCase();
        let systemCode = fullPartNumber.slice(0, 4);

        const rawItems = Array.isArray(obj?.data) ? obj.data : Array.isArray(obj) ? obj : [];
        const orderedItems = [...rawItems].sort((a, b) => {
            const aExact =
                a?.accessory_code?.trim?.().toUpperCase() === normalizedFull ||
                a?.ModelCode?.trim?.().toUpperCase() === normalizedFull;
            const bExact =
                b?.accessory_code?.trim?.().toUpperCase() === normalizedFull ||
                b?.ModelCode?.trim?.().toUpperCase() === normalizedFull;
            return (bExact ? 1 : 0) - (aExact ? 1 : 0);
        });

        for (let i = 0; i < orderedItems.length; i++) {
            const item = orderedItems[i];
            if (!item || typeof item !== 'object') continue;

            if (typeof item.accessory_code === 'string' && item.accessory_code.trim()) {
                const accCode = item.accessory_code.trim();
                if (isPrefixFallback && accCode.toUpperCase() !== normalizedFull) {
                    continue;
                }
                return buildAccessoryLinks(accCode);
            }

            if (
                isPrefixFallback &&
                typeof item.MachineType === 'string' &&
                item.MachineType.trim() &&
                item.MachineType.trim().toUpperCase() !== queryCode.toUpperCase()
            ) {
                continue;
            }
            const rawSlug = item.ProductKey || item.Product_Url_Name || item.ProductUrlName || item.ProductName || '';
            if (typeof rawSlug === 'string' && rawSlug.trim()) {
                let cleaned = rawSlug.trim();
                const escapedCode = queryCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleaned = cleaned.replace(new RegExp(`\\s*\\(?\\b${escapedCode}\\b\\)?`, 'ig'), '').trim();
                cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, '').trim();
                const slug = cleaned.replace(/[^A-Za-z0-9_/-]+/g, '_').replace(/^_+|_+$/g, '');

                if (slug) {
                    const brandHint = item.ProductLine || item.ClassificationName || item.Brand || '';
                    const productBaseUrl = deriveProductBaseUrlFromSlug(slug, brandHint);
                    const detailSlug = slug.split('/').pop();
                    if (typeof item.MachineType === 'string' && item.MachineType.trim().length === 4) {
                        systemCode = item.MachineType.trim();
                    }
                    const accessoriesUrl = `https://psref.lenovo.com/l/accessories/?system=${encodeURIComponent(
                        systemCode
                    )}`;
                    const modelsUrl = setTabOnProductUrl(productBaseUrl, 'model');
                    const modelCode =
                        typeof item.ModelCode === 'string' && item.ModelCode.trim()
                            ? item.ModelCode.trim()
                            : fullPartNumber;
                    const hasExactModel =
                        item.IsExistModel === true ||
                        (item.IsExistModel !== false && queryCode.length > 4 && detailSlug);
                    const specsUrl =
                        !isCto && hasExactModel && detailSlug
                            ? `https://psref.lenovo.com/detail/${detailSlug}?M=${encodeURIComponent(modelCode)}`
                            : setTabOnProductUrl(productBaseUrl, 'spec');

                    return {
                        isAccessory: false,
                        modelsUrl,
                        specsUrl,
                        accessoriesUrl
                    };
                }
            }
        }

        const rawStr = typeof data === 'string' ? data : JSON.stringify(data);
        const accMatch = rawStr.match(/"accessory_code"\s*:\s*"([^"]+)"/i);
        if (accMatch && accMatch[1]) {
            const accCode = accMatch[1].trim();
            if (!isPrefixFallback || accCode.toUpperCase() === normalizedFull) {
                return buildAccessoryLinks(accCode);
            }
        }

        let productBaseUrl = '';
        let detailSlug = '';

        const productPathMatch = rawStr.match(/\/product\/([A-Za-z0-9_/-]+)/i);
        if (productPathMatch && productPathMatch[1]) {
            productBaseUrl = `https://psref.lenovo.com/product/${productPathMatch[1].split('?')[0]}`;
        }

        const detailMatch = rawStr.match(/\/detail\/([A-Za-z0-9_-]+)/i);
        if (detailMatch && detailMatch[1]) {
            detailSlug = detailMatch[1];
            if (!productBaseUrl) {
                productBaseUrl = deriveProductBaseUrlFromSlug(detailSlug, '');
            }
        }

        if (!productBaseUrl && !detailSlug) {
            return null;
        }

        if (!productBaseUrl && detailSlug) {
            productBaseUrl = deriveProductBaseUrlFromSlug(detailSlug, '');
        }

        const accessoriesUrl = `https://psref.lenovo.com/l/accessories/?system=${encodeURIComponent(systemCode)}`;
        const modelsUrl = setTabOnProductUrl(productBaseUrl, 'model');
        const specsUrl =
            !isCto && queryCode.length > 4 && detailSlug
                ? `https://psref.lenovo.com/detail/${detailSlug}?M=${encodeURIComponent(fullPartNumber)}`
                : setTabOnProductUrl(productBaseUrl, 'spec');

        return {
            isAccessory: false,
            modelsUrl,
            specsUrl,
            accessoriesUrl
        };
    }

    function gmFetchPsrefText(url, method = 'GET') {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('GM_xmlhttpRequest unavailable'));
                return;
            }
            GM_xmlhttpRequest({
                method,
                url,
                headers: {
                    accept: 'application/json, text/plain, text/html, */*',
                    'accept-language': 'en-US,en;q=0.9',
                    Referer: 'https://psref.lenovo.com/'
                },
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300 && typeof resp.responseText === 'string') {
                        resolve(resp.responseText);
                    } else {
                        reject(new Error(`HTTP ${resp.status}`));
                    }
                },
                onerror: (err) => reject(err || new Error('Network error')),
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }

    async function tryFetchTokenViaLearnedEndpoint() {
        try {
            if (typeof GM_getValue !== 'function') return '';
            const raw = GM_getValue(TOKEN_ENDPOINT_KEY, '');
            if (!raw) return '';
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!parsed?.url) return '';
            const text = await gmFetchPsrefText(parsed.url, parsed.method || 'GET');
            return saveCapturedBearerToken(text);
        } catch (_) {
            return '';
        }
    }

    async function tryDiscoverTokenFromPsrefBundles() {
        try {
            const html = await gmFetchPsrefText('https://psref.lenovo.com/');
            const direct = saveCapturedBearerToken(html);
            if (direct) return direct;

            const scriptUrls = [];
            const scriptRe = /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;
            let match;
            while ((match = scriptRe.exec(html))) {
                try {
                    const fullScriptUrl = new URL(match[1], 'https://psref.lenovo.com/').toString();
                    if (fullScriptUrl.startsWith('https://psref.lenovo.com/')) {
                        scriptUrls.push(fullScriptUrl);
                    }
                } catch (_) {
                }
            }

            const candidateApis = new Set();
            for (let i = 0; i < Math.min(scriptUrls.length, 4); i++) {
                try {
                    const bundle = await gmFetchPsrefText(scriptUrls[i]);
                    const psrefAtIdx = bundle.indexOf('psref_at');
                    if (psrefAtIdx !== -1) {
                        const windowSlice = bundle.slice(
                            Math.max(0, psrefAtIdx - 1500),
                            Math.min(bundle.length, psrefAtIdx + 1500)
                        );
                        const apiMatches = windowSlice.match(/["'](\/api\/[A-Za-z0-9_/-]+)["']/g) || [];
                        for (let j = 0; j < apiMatches.length; j++) {
                            const cleanPath = apiMatches[j].slice(1, -1);
                            if (!/\/Suggest\b/i.test(cleanPath)) {
                                candidateApis.add(`https://psref.lenovo.com${cleanPath}`);
                            }
                        }
                    }

                    const authMatches =
                        bundle.match(/["'](\/api\/[A-Za-z0-9_/-]*(?:token|jwt|auth)[A-Za-z0-9_/-]*)["']/gi) || [];
                    for (let j = 0; j < authMatches.length; j++) {
                        const cleanPath = authMatches[j].slice(1, -1);
                        candidateApis.add(`https://psref.lenovo.com${cleanPath}`);
                    }
                } catch (_) {
                }
            }

            for (const apiUrl of candidateApis) {
                try {
                    const respText = await gmFetchPsrefText(apiUrl, 'GET');
                    const token = saveCapturedBearerToken(respText);
                    if (token) {
                        saveDiscoveredTokenEndpoint(apiUrl, 'GET');
                        return token;
                    }
                } catch (_) {
                }
            }
        } catch (_) {
        }
        return '';
    }

    function tryAcquireTokenViaHiddenIframe(timeoutMs = 8000) {
        return new Promise((resolve) => {
            if (!document.body) {
                resolve('');
                return;
            }

            const iframe = document.createElement('iframe');
            iframe.src = 'https://psref.lenovo.com/';
            iframe.setAttribute('aria-hidden', 'true');
            iframe.tabIndex = -1;
            iframe.style.cssText =
                'display:none !important;width:0 !important;height:0 !important;border:0 !important;position:fixed !important;left:-9999px !important;top:-9999px !important;pointer-events:none !important;';

            let settled = false;
            let pollTimer = null;
            let timeoutTimer = null;

            const cleanup = (token) => {
                if (settled) return;
                settled = true;
                if (pollTimer) clearInterval(pollTimer);
                if (timeoutTimer) clearTimeout(timeoutTimer);
                try {
                    iframe.remove();
                } catch (_) {
                }
                resolve(token || '');
            };

            pollTimer = setInterval(() => {
                const latest = getBearerToken();
                if (latest) {
                    cleanup(latest);
                }
            }, 250);

            timeoutTimer = setTimeout(() => {
                cleanup(getBearerToken());
            }, timeoutMs);

            document.body.appendChild(iframe);
        });
    }

    let inFlightTokenRefresh = null;

    function ensureFreshBearerToken(forceRefresh = false) {
        if (!forceRefresh) {
            const current = getBearerToken();
            if (current) return Promise.resolve(current);
        } else {
            try {
                if (typeof GM_setValue === 'function') {
                    GM_setValue(TOKEN_STORAGE_KEY, '');
                }
            } catch (_) {
            }
        }

        if (inFlightTokenRefresh) {
            return inFlightTokenRefresh;
        }

        inFlightTokenRefresh = (async () => {
            const fromLearned = await tryFetchTokenViaLearnedEndpoint();
            if (fromLearned) return fromLearned;

            const fromBundles = await tryDiscoverTokenFromPsrefBundles();
            if (fromBundles) return fromBundles;

            const fromIframe = await tryAcquireTokenViaHiddenIframe();
            if (fromIframe) return fromIframe;

            return getBearerToken();
        })().finally(() => {
            inFlightTokenRefresh = null;
        });

        return inFlightTokenRefresh;
    }

    function executeSuggestHttp(url, bearerToken) {
        return new Promise((resolve, reject) => {
            const headers = {
                accept: 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                ...(bearerToken ? { authorization: bearerToken } : {}),
                priority: 'u=1, i'
            };

            const makeStatusError = (status) => {
                const err = new Error(`HTTP ${status}`);
                err.status = status;
                return err;
            };

            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: {
                        ...headers,
                        Referer: 'https://psref.lenovo.com/'
                    },
                    onload: (resp) => {
                        if (resp.status >= 200 && resp.status < 300 && resp.responseText) {
                            try {
                                resolve(JSON.parse(resp.responseText));
                            } catch (_) {
                                resolve(resp.responseText);
                            }
                        } else {
                            reject(makeStatusError(resp.status));
                        }
                    },
                    onerror: (err) => reject(err),
                    ontimeout: () => reject(new Error('Timeout'))
                });
                return;
            }

            fetch(url, {
                headers,
                referrer: 'https://psref.lenovo.com/',
                body: null,
                method: 'GET',
                mode: 'cors',
                credentials: 'include'
            })
                .then((res) => {
                    if (!res.ok) throw makeStatusError(res.status);
                    return res.json();
                })
                .then(resolve)
                .catch(reject);
        });
    }

    async function requestPsrefSuggest(queryCode) {
        const buildUrl = () =>
            `https://psref.lenovo.com/api/search/DefinitionFilterAndSearch/Suggest?kw=${encodeURIComponent(
                queryCode
            )}&limit=6&IsPreviewProduct=true&t=${Math.random()}`;

        const token = await ensureFreshBearerToken(false);
        try {
            return await executeSuggestHttp(buildUrl(), token);
        } catch (err) {
            if (err?.status === 401 || err?.status === 403 || !token) {
                const freshToken = await ensureFreshBearerToken(true);
                if (freshToken) {
                    return await executeSuggestHttp(buildUrl(), freshToken);
                }
            }
            throw err;
        }
    }

    async function fetchPsrefUrlsForPartNumber(partNumber) {
        const isCto = /CTO/i.test(partNumber);
        const firstFour = partNumber.slice(0, 4);

        if (isCto) {
            if (firstFour.length < 4) return { links: null, authError: false };
            try {
                const data = await requestPsrefSuggest(firstFour);
                return {
                    links: parsePsrefUrlsFromSuggestResponse(data, firstFour, partNumber),
                    authError: false
                };
            } catch (err) {
                return { links: null, authError: err?.status === 401 || err?.status === 403 };
            }
        }

        try {
            const data = await requestPsrefSuggest(partNumber);
            const links = parsePsrefUrlsFromSuggestResponse(data, partNumber, partNumber);
            if (links) return { links, authError: false };
        } catch (err) {
            if (err?.status === 401 || err?.status === 403) {
                return { links: null, authError: true };
            }
        }

        if (partNumber.length === 10 && firstFour.length === 4) {
            try {
                const mtData = await requestPsrefSuggest(firstFour);
                return {
                    links: parsePsrefUrlsFromSuggestResponse(mtData, firstFour, partNumber),
                    authError: false
                };
            } catch (err) {
                return { links: null, authError: err?.status === 401 || err?.status === 403 };
            }
        }

        return { links: null, authError: false };
    }

    function resolvePsrefLinks(partNumber) {
        if (urlCache.has(partNumber)) {
            return urlCache.get(partNumber);
        }

        const promise = fetchPsrefUrlsForPartNumber(partNumber).then((result) => {
            if (result.authError) {
                urlCache.delete(partNumber);
            }
            return result;
        });
        urlCache.set(partNumber, promise);
        return promise;
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(() => copyViaTextarea(text));
        }
        return copyViaTextarea(text);
    }

    function copyViaTextarea(text) {
        return new Promise((resolve, reject) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    function bindCopyOnPartNumber(partNumberEl, partNumber) {
        const targetEl = getPartNumberSpan(partNumberEl) || partNumberEl;
        targetEl.dataset.psrefCopyValue = partNumber;
        targetEl.classList.add('psref-copyable-pn');
        targetEl.title = 'Click to copy part number';

        if (targetEl.dataset.psrefCopyInit === '1') return;
        targetEl.dataset.psrefCopyInit = '1';

        targetEl.addEventListener('click', (e) => {
            if (e.target && e.target.closest && e.target.closest(`.${HOVER_MENU_CLASS}`)) return;
            const pn = targetEl.dataset.psrefCopyValue;
            if (!pn) return;
            copyTextToClipboard(pn).then(() => {
                targetEl.classList.add('psref-copied');
                clearTimeout(targetEl._psrefCopyTimer);
                targetEl._psrefCopyTimer = setTimeout(() => {
                    targetEl.classList.remove('psref-copied');
                }, 850);
            });
        });
    }

    function createHoverMenu(links) {
        const hoverMenu = document.createElement('span');
        hoverMenu.className = HOVER_MENU_CLASS;

        const entries = links.isAccessory
            ? [
                { label: 'Overview', url: links.overviewUrl },
                { label: 'Specs', url: links.specsUrl },
                { label: 'Compatibility', url: links.compatibilityUrl }
            ]
            : [
                { label: 'Models', url: links.modelsUrl },
                { label: 'Specs', url: links.specsUrl },
                { label: 'Accessories', url: links.accessoriesUrl }
            ];

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!entry.url) continue;
            if (hoverMenu.childElementCount > 0) {
                const sep = document.createElement('span');
                sep.className = 'psref-sep';
                sep.textContent = '-';
                hoverMenu.appendChild(sep);
            }
            const link = document.createElement('a');
            link.href = entry.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = entry.label;
            hoverMenu.appendChild(link);
        }

        return hoverMenu;
    }

    function wrapTextNodePartNumber(textNode) {
        if (!textNode || textNode.nodeType !== 3) return false;
        const text = textNode.nodeValue || '';
        const match = text.match(/^([\s\S]*?[:：]\s*)([A-Z0-9]{4,15})\b([\s\S]*)$/i);
        if (!match) return false;

        const code = match[2].toUpperCase();
        if (!/\d/.test(code)) return false;

        const wrap = document.createElement('span');
        wrap.className = 'psref-pn-wrap';
        wrap.dataset.psrefPn = code;

        const valSpan = document.createElement('span');
        valSpan.className = 'psref-pn-value';
        valSpan.textContent = match[2];
        wrap.appendChild(valSpan);

        const frag = document.createDocumentFragment();
        if (match[1]) frag.appendChild(document.createTextNode(match[1]));
        frag.appendChild(wrap);
        if (match[3]) frag.appendChild(document.createTextNode(match[3]));

        textNode.parentNode.replaceChild(frag, textNode);
        return true;
    }

    function prepareQuoteDetailPartNodes() {
        const productInfoBlocks = document.querySelectorAll('.item-detail-list-product-info');
        for (let i = 0; i < productInfoBlocks.length; i++) {
            const block = productInfoBlocks[i];
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            let current;
            while ((current = walker.nextNode())) {
                const parentEl = current.parentElement;
                if (
                    !parentEl ||
                    parentEl.closest(`.psref-pn-wrap, .${HOVER_MENU_CLASS}, [data-tkey="nextShippingDate"]`)
                ) {
                    continue;
                }
                textNodes.push(current);
            }
            for (let j = 0; j < textNodes.length; j++) {
                wrapTextNodePartNumber(textNodes[j]);
            }
        }
    }

    function updateAllItems() {
        prepareQuoteDetailPartNodes();

        const partNumberBlocks = document.querySelectorAll(
            '#productList .partNumber, .productcart .partNumber, .subItem .partNumber, .productNameInfo .partNumber, .itemProductNameInfo .partNumber, .item-detail-list-product-info .psref-pn-wrap, .item-detail-list-children-container-info'
        );
        if (partNumberBlocks.length === 0) return false;

        injectStyles();
        let allReady = true;

        for (let i = 0; i < partNumberBlocks.length; i++) {
            const partNumberEl = partNumberBlocks[i];
            const partNumber = extractPartNumber(partNumberEl);

            if (!partNumber) {
                if (!partNumberEl.classList.contains('item-detail-list-children-container-info')) {
                    allReady = false;
                }
                continue;
            }

            bindCopyOnPartNumber(partNumberEl, partNumber);

            if (partNumberEl.dataset.psrefChecked === partNumber) {
                continue;
            }

            const existingMenu = partNumberEl.querySelector(`.${HOVER_MENU_CLASS}`);
            if (existingMenu) existingMenu.remove();

            partNumberEl.dataset.psrefChecked = partNumber;

            resolvePsrefLinks(partNumber).then(({ links, authError }) => {
                if (partNumberEl.dataset.psrefChecked !== partNumber) return;
                if (authError) {
                    delete partNumberEl.dataset.psrefChecked;
                    return;
                }
                if (!links || partNumberEl.querySelector(`.${HOVER_MENU_CLASS}`)) return;

                partNumberEl.appendChild(createHoverMenu(links));
            });
        }

        return allReady;
    }

    function startWhenDataReady() {
        let attempts = 0;
        const maxAttempts = 60;

        const pollTimer = setInterval(() => {
            attempts++;
            if (updateAllItems() || attempts >= maxAttempts) {
                clearInterval(pollTimer);
            }
        }, 500);

        if (typeof GM_addValueChangeListener === 'function') {
            try {
                GM_addValueChangeListener(TOKEN_STORAGE_KEY, () => {
                    urlCache.clear();
                    updateAllItems();
                });
            } catch (_) {
            }
        }

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let hasRelevantMutation = false;
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                const targetEl = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
                if (targetEl?.closest?.(`.${HOVER_MENU_CLASS}, .psref-pn-wrap`)) {
                    continue;
                }

                let isOwnNode = false;
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (
                        node.nodeType === 1 &&
                        (node.classList?.contains(HOVER_MENU_CLASS) || node.classList?.contains('psref-pn-wrap'))
                    ) {
                        isOwnNode = true;
                        break;
                    }
                }
                if (!isOwnNode) {
                    hasRelevantMutation = true;
                    break;
                }
            }

            if (hasRelevantMutation) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(updateAllItems, 150);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    let started = false;
    function initOnCartPage() {
        if (started) return;
        if (!document.body || !document.head) return;
        started = true;
        startWhenDataReady();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initOnCartPage();
    }
    document.addEventListener('DOMContentLoaded', initOnCartPage, { once: true });
    window.addEventListener('load', initOnCartPage, { once: true });
})();
