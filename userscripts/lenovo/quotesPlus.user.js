// ==UserScript==
// @name         Quotes Revamp
// @namespace    https://www.lenovo.com/
// @version      0.0.2
// @description  Enhances Lenovo Quotes navigation, Saved Quotes list, and Quote Details workflows across stores
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lenovo.com
// @match        https://www.lenovo.com/*
// @match        https://account.lenovo.com/*
// @match        https://*.lenovo.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const QUOTES_LINK_CLASS = 'lql-quotes-link';
    const COPY_TABLE_BTN_CLASS = 'qr-copy-table-btn';
    const COPY_ROW_BTN_CLASS = 'qr-row-copy-btn';
    const EXPAND_TOGGLE_CLASS = 'qr-expand-toggle';
    const EXPAND_PANEL_CLASS = 'qr-expand-panel';
    const COPY_INSTRUCTIONS_BTN_CLASS = 'qr-copy-instructions-btn';
    const COPYABLE_CLASS = 'qr-copyable';
    const SPEC_SUMMARY_CLASS = 'qr-specs-summary';
    const STYLE_ID = 'lql-quotes-styles';

    const COUNTRY_RE = /^[a-z]{2}$/i;
    const LANG_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

    const quoteApiCache = new Map();

    function ingestQuotePagePayload(payload) {
        const rows = payload?.data?.data;
        if (!Array.isArray(rows) || rows.length === 0) return;

        let updated = false;
        for (let i = 0; i < rows.length; i++) {
            const q = rows[i];
            if (!q || typeof q !== 'object') continue;
            if (q.id !== undefined && q.id !== null) {
                quoteApiCache.set(String(q.id), q);
                updated = true;
            }
            if (typeof q.quoteId === 'string' && q.quoteId.trim()) {
                quoteApiCache.set(q.quoteId.trim().toUpperCase(), q);
                updated = true;
            }
        }

        if (updated && document.body) {
            const scheduleSync = () => {
                if (typeof updateAll === 'function') updateAll();
            };
            setTimeout(scheduleSync, 50);
            setTimeout(scheduleSync, 180);
        }
    }

    function installQuoteApiInterceptor() {
        if (window._qrQuoteApiInterceptorInstalled) return;
        window._qrQuoteApiInterceptorInstalled = true;

        try {
            const origFetch = window.fetch;
            if (typeof origFetch === 'function') {
                window.fetch = function (...args) {
                    const reqUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
                    const promise = origFetch.apply(this, args);
                    if (/\/quote\/page\b/i.test(reqUrl)) {
                        promise
                            .then((resp) => {
                                if (resp && resp.ok) {
                                    resp.clone()
                                        .json()
                                        .then(ingestQuotePagePayload)
                                        .catch(() => {});
                                }
                            })
                            .catch(() => {});
                    }
                    return promise;
                };
            }
        } catch (_) {
        }

        try {
            const origOpen = window.XMLHttpRequest?.prototype?.open;
            const origSend = window.XMLHttpRequest?.prototype?.send;
            if (typeof origOpen === 'function' && typeof origSend === 'function') {
                window.XMLHttpRequest.prototype.open = function (method, url) {
                    try {
                        this._qrReqUrl = typeof url === 'string' ? url : String(url || '');
                    } catch (_) {
                        this._qrReqUrl = '';
                    }
                    return origOpen.apply(this, arguments);
                };

                window.XMLHttpRequest.prototype.send = function () {
                    try {
                        if (this._qrReqUrl && /\/quote\/page\b/i.test(this._qrReqUrl) && !this._qrXhrHooked) {
                            this._qrXhrHooked = true;
                            this.addEventListener('load', function () {
                                try {
                                    if (this.status >= 200 && this.status < 300) {
                                        const payload =
                                            this.responseType === 'json'
                                                ? this.response
                                                : typeof this.responseText === 'string' && this.responseText
                                                ? JSON.parse(this.responseText)
                                                : null;
                                        if (payload) ingestQuotePagePayload(payload);
                                    }
                                } catch (_) {
                                }
                            });
                        }
                    } catch (_) {
                    }
                    return origSend.apply(this, arguments);
                };
            }
        } catch (_) {
        }
    }

    installQuoteApiInterceptor();

    function injectStyles() {
        if (document.getElementById(STYLE_ID) || !document.head) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${QUOTES_LINK_CLASS}:hover .account-menu-masthead-item-text {
                text-decoration: underline !important;
            }
            .${COPYABLE_CLASS} {
                cursor: pointer !important;
                transition: color 0.15s ease !important;
            }
            .${COPYABLE_CLASS}:hover {
                text-decoration: underline !important;
            }
            .qr-copied {
                color: #1a7f37 !important;
            }
            .qr-copied::after {
                content: ' ✓' !important;
                color: #1a7f37 !important;
                font-weight: 700 !important;
                font-size: 11px !important;
            }

            html body .filter-result-section .sort-by-result .${COPY_TABLE_BTN_CLASS} {
                display: none !important;
                align-items: center !important;
                margin: 0 !important;
                padding: 0 0 0 12px !important;
                border: none !important;
                background: transparent !important;
                color: inherit !important;
                font: inherit !important;
                line-height: inherit !important;
                letter-spacing: inherit !important;
                cursor: pointer !important;
                opacity: 0.78 !important;
                white-space: nowrap !important;
                transition: opacity 0.15s ease, color 0.15s ease !important;
            }
            html body .filter-result-section .sort-by-result:hover .${COPY_TABLE_BTN_CLASS},
            html body .filter-result-section .sort-by-result .${COPY_TABLE_BTN_CLASS}:hover,
            html body .filter-result-section .sort-by-result .${COPY_TABLE_BTN_CLASS}.qr-btn-copied {
                display: inline-flex !important;
            }
            html body .filter-result-section .sort-by-result .${COPY_TABLE_BTN_CLASS}:hover {
                opacity: 1 !important;
                text-decoration: underline !important;
            }

            html body .filter-result-section .table-item.qr-row-host {
                position: relative !important;
                flex-wrap: wrap !important;
            }
            html body .filter-result-section .table-item.qr-row-host > tr.table-item-base-info {
                width: 100% !important;
                flex: 1 0 100% !important;
            }
            html body .filter-result-section .qr-expand-meta .${COPY_ROW_BTN_CLASS} {
                display: inline-flex !important;
                align-items: center !important;
                margin: 0 0 0 auto !important;
                padding: 0 !important;
                border: none !important;
                background: transparent !important;
                color: #6b7280 !important;
                font: inherit !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                line-height: inherit !important;
                white-space: nowrap !important;
                cursor: pointer !important;
                transition: color 0.15s ease !important;
            }
            html body .filter-result-section .qr-expand-meta .${COPY_ROW_BTN_CLASS}:hover {
                color: #171717 !important;
                text-decoration: underline !important;
            }

            html body .filter-result-section .table-item > .${EXPAND_TOGGLE_CLASS} {
                display: none !important;
                position: absolute !important;
                left: 6px !important;
                top: 24px !important;
                transform: translateY(-50%) !important;
                align-items: center !important;
                justify-content: center !important;
                width: 16px !important;
                height: 16px !important;
                margin: 0 !important;
                padding: 0 !important;
                border: none !important;
                border-radius: 2px !important;
                background: transparent !important;
                color: #666 !important;
                font-size: 11px !important;
                line-height: 1 !important;
                cursor: pointer !important;
                z-index: 4 !important;
                transition: color 0.15s ease, background-color 0.15s ease !important;
            }
            html body .filter-result-section .table-item:hover > .${EXPAND_TOGGLE_CLASS},
            html body .filter-result-section .table-item.qr-expanded > .${EXPAND_TOGGLE_CLASS},
            html body .filter-result-section .${EXPAND_TOGGLE_CLASS}:hover {
                display: inline-flex !important;
            }
            html body .filter-result-section .${EXPAND_TOGGLE_CLASS}:hover {
                color: #171717 !important;
                background: #eef0f3 !important;
            }
            html body .filter-result-section .table-item > .${EXPAND_PANEL_CLASS} {
                display: none !important;
                flex: 1 0 100% !important;
                width: 100% !important;
                box-sizing: border-box !important;
                padding: 10px 18px 12px !important;
                background: #ffffff !important;
                border-top: 1px solid #e6e8ec !important;
                font-size: 12px !important;
                line-height: 1.45 !important;
                color: #333 !important;
                text-align: left !important;
            }
            html body .filter-result-section .table-item.qr-expanded > .${EXPAND_PANEL_CLASS} {
                display: block !important;
            }
            html body .filter-result-section .qr-expand-meta {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: center !important;
                gap: 8px 20px !important;
                margin-bottom: 8px !important;
                padding-bottom: 8px !important;
                border-bottom: 1px dashed #e2e4e8 !important;
            }
            html body .filter-result-section .qr-meta-field {
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
            }
            html body .filter-result-section .qr-meta-label {
                color: #666 !important;
                font-weight: 600 !important;
            }
            html body .filter-result-section .qr-meta-val {
                color: #171717 !important;
            }
            html body .filter-result-section .qr-expand-items {
                display: flex !important;
                flex-direction: column !important;
                gap: 5px !important;
            }
            html body .filter-result-section .qr-expand-item-row,
            html body .filter-result-section .qr-expand-subitem-row {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: baseline !important;
                gap: 6px 12px !important;
            }
            html body .filter-result-section .qr-expand-subitem-row {
                padding-left: 18px !important;
                color: #555 !important;
                font-size: 11.5px !important;
            }
            html body .filter-result-section .qr-item-qty {
                font-weight: 700 !important;
                color: #171717 !important;
            }
            html body .filter-result-section .qr-item-name {
                font-weight: 600 !important;
                color: #171717 !important;
            }
            html body .filter-result-section .qr-expand-subitem-row .qr-item-name {
                font-weight: 500 !important;
                color: #333 !important;
            }
            html body .filter-result-section .qr-item-pn {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
                font-size: 11px !important;
                color: #444 !important;
                background: #efefef !important;
                padding: 1px 5px !important;
                border-radius: 3px !important;
            }
            html body .filter-result-section .qr-item-detail {
                color: #555 !important;
            }
            html body .filter-result-section .qr-override-badge {
                padding: 1px 6px !important;
                border-radius: 3px !important;
                background: #fef3c7 !important;
                color: #92400e !important;
                font-size: 11px !important;
                font-weight: 600 !important;
            }
            html body .filter-result-section .${SPEC_SUMMARY_CLASS} {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: baseline !important;
                gap: 4px 12px !important;
                padding: 2px 0 4px 18px !important;
                font-size: 11.5px !important;
                line-height: 1.4 !important;
                color: #374151 !important;
            }
            html body .item-detail-list-product-name-container .${SPEC_SUMMARY_CLASS} {
                display: flex !important;
                flex-wrap: wrap !important;
                align-items: baseline !important;
                gap: 4px 12px !important;
                margin: 5px 0 4px !important;
                font-size: 12px !important;
                line-height: 1.4 !important;
                color: #374151 !important;
            }
            html body .${SPEC_SUMMARY_CLASS} .qr-spec-chip {
                display: inline-flex !important;
                align-items: baseline !important;
                gap: 4px !important;
            }
            html body .${SPEC_SUMMARY_CLASS} .qr-spec-label {
                color: #6b7280 !important;
                font-weight: 600 !important;
            }
            html body .${SPEC_SUMMARY_CLASS} .qr-spec-val {
                color: #171717 !important;
            }

            html body .filter-result-section .${COPY_TABLE_BTN_CLASS}.qr-btn-copied {
                opacity: 1 !important;
                color: #1a7f37 !important;
            }
            html body .filter-result-section .${COPY_ROW_BTN_CLASS}.qr-btn-copied,
            html body .${COPY_INSTRUCTIONS_BTN_CLASS}.qr-btn-copied {
                border-color: #1a7f37 !important;
                color: #1a7f37 !important;
            }

            html body .qr-detail-btn-bar .${COPY_INSTRUCTIONS_BTN_CLASS} {
                display: none !important;
            }
            html body .qr-detail-btn-bar:hover .${COPY_INSTRUCTIONS_BTN_CLASS},
            html body .qr-detail-btn-bar .${COPY_INSTRUCTIONS_BTN_CLASS}:hover,
            html body .qr-detail-btn-bar .${COPY_INSTRUCTIONS_BTN_CLASS}.qr-btn-copied {
                display: inline-block !important;
            }

            .${COPY_INSTRUCTIONS_BTN_CLASS}.qr-fallback-btn {
                padding: 8px 18px !important;
                border: 1px solid #171717 !important;
                border-radius: 2px !important;
                background: #fff !important;
                color: #171717 !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                line-height: 18px !important;
                cursor: pointer !important;
            }
            .${COPY_INSTRUCTIONS_BTN_CLASS}.qr-fallback-btn:hover {
                background: #f5f5f5 !important;
            }
        `;
        document.head.appendChild(style);
    }

    function copyTextToClipboard(text) {
        if (!text) return Promise.reject(new Error('Empty text'));
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

    function flashCopiedElement(el, duration = 900) {
        el.classList.add('qr-copied');
        clearTimeout(el._qrCopyTimer);
        el._qrCopyTimer = setTimeout(() => {
            el.classList.remove('qr-copied');
        }, duration);
    }

    function flashCopiedButton(btn, copiedLabel, duration = 1200) {
        if (!btn.dataset.qrOrigText) {
            btn.dataset.qrOrigText = btn.textContent;
        }
        btn.textContent = copiedLabel;
        btn.classList.add('qr-btn-copied');
        clearTimeout(btn._qrBtnTimer);
        btn._qrBtnTimer = setTimeout(() => {
            btn.textContent = btn.dataset.qrOrigText;
            btn.classList.remove('qr-btn-copied');
        }, duration);
    }

    function bindClickToCopy(el, valueGetter, titleText = 'Click to copy') {
        if (!el) return;
        const val = typeof valueGetter === 'function' ? valueGetter() : valueGetter;
        if (!val) return;

        el.dataset.qrCopyValue = val;
        el.classList.add(COPYABLE_CLASS);
        el.title = titleText;

        if (el.dataset.qrCopyBound === '1') return;
        el.dataset.qrCopyBound = '1';

        el.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const latestVal = typeof valueGetter === 'function' ? valueGetter() : el.dataset.qrCopyValue;
            if (!latestVal) return;
            copyTextToClipboard(latestVal).then(() => flashCopiedElement(el));
        });
    }

    function extractStorePath(pathStr) {
        if (!pathStr || typeof pathStr !== 'string') return '';
        const segments = pathStr.split('/').filter(Boolean);
        if (segments.length < 2 || !COUNTRY_RE.test(segments[0])) {
            return '';
        }

        const country = segments[0].toLowerCase();

        if (LANG_RE.test(segments[1])) {
            return `${country}/${segments[1].toLowerCase()}`;
        }

        const docLang = (document.documentElement?.lang || '').split('-')[0].toLowerCase();
        const searchLimit = Math.min(segments.length, 7);

        if (docLang && COUNTRY_RE.test(docLang)) {
            for (let i = 2; i < searchLimit; i++) {
                const segBase = segments[i].split('-')[0].toLowerCase();
                if (LANG_RE.test(segments[i]) && segBase === docLang) {
                    return `${country}/${segments.slice(1, i).join('/')}/${segments[i].toLowerCase()}`;
                }
            }
        }

        for (let i = 2; i < searchLimit; i++) {
            if (LANG_RE.test(segments[i])) {
                return `${country}/${segments.slice(1, i).join('/')}/${segments[i].toLowerCase()}`;
            }
        }

        return '';
    }

    function resolveStorePath(mastheadEl) {
        const currentStorePath = extractStorePath(window.location.pathname || '');
        if (currentStorePath) return currentStorePath;

        if (mastheadEl) {
            const links = mastheadEl.querySelectorAll('a[href]');
            for (let i = 0; i < links.length; i++) {
                const rawHref = links[i].getAttribute('href') || '';
                if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;
                try {
                    const parsed = new URL(rawHref, window.location.origin);
                    if (parsed.hostname.endsWith('lenovo.com')) {
                        const storePath = extractStorePath(parsed.pathname);
                        if (storePath) return storePath;
                    }
                } catch (_) {
                }
            }
        }

        return '';
    }

    function resolveQuoteListUrl(mastheadEl) {
        const storePath = resolveStorePath(mastheadEl);
        return storePath ? `https://account.lenovo.com/${storePath}/account/quote/list.html` : '';
    }

    function buildStoreQuoteDetailUrl(internalId, fallbackHref) {
        let quoteParamId = internalId || '';
        let fallbackStorePath = '';

        if (fallbackHref && !fallbackHref.startsWith('#') && !fallbackHref.startsWith('javascript:')) {
            try {
                const parsed = new URL(fallbackHref, window.location.origin);
                if (!quoteParamId) {
                    quoteParamId = parsed.searchParams.get('id') || '';
                }
                fallbackStorePath = extractStorePath(parsed.pathname);
            } catch (_) {
            }
        }

        const liveStorePath = extractStorePath(window.location.pathname || '') || fallbackStorePath;
        if (!liveStorePath) {
            return fallbackHref || window.location.href;
        }
        if (quoteParamId) {
            return `https://account.lenovo.com/${liveStorePath}/account/quote/detail.html?id=${encodeURIComponent(
                quoteParamId
            )}`;
        }
        return window.location.href;
    }

    function formatCustomerInstructions({ quoteId, detailUrl }) {
        const quoteRef = quoteId ? ` (Quote ID: ${quoteId})` : '';
        const stepOne = detailUrl
            ? `1. Open your quote${quoteRef} using the link below:\n   ${detailUrl}`
            : `1. Open your quote${quoteRef} under My Saved Quotes.`;

        return [
            'Please follow these steps to convert your quote into an order:',
            '',
            stepOne,
            '2. Click "Convert To Order".',
            '3. Proceed to checkout to complete your purchase.'
        ].join('\n');
    }

    function createQuotesAnchor(quoteUrl, mastheadEl) {
        const anchor = document.createElement('a');
        anchor.className = QUOTES_LINK_CLASS;
        anchor.dataset.lqlQuotes = '1';
        anchor.href = quoteUrl;
        anchor.style.cssText =
            'align-self:stretch;height:34px;flex-direction:column;justify-content:flex-start;align-items:flex-start;gap:2px;display:flex;text-decoration:none';

        anchor.innerHTML = `
            <div style="justify-content:flex-start;align-items:flex-start;gap:8px;display:inline-flex">
                <div style="position:relative" data-svg-wrapper="">
                    <svg fill="none" height="16" viewBox="0 0 16 16" width="16" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2.5 1.5H10.2L13.5 4.8V14.5H2.5V1.5Z" stroke="#171717" stroke-width="1.15" stroke-linejoin="miter"></path>
                        <path d="M10.2 1.5V4.8H13.5" stroke="#171717" stroke-width="1.15" stroke-linejoin="miter"></path>
                        <path d="M8 4.6V12.6" stroke="#171717" stroke-width="1.1" stroke-linecap="round"></path>
                        <path d="M9.8 6.8C9.8 6.0 9.0 5.5 8.0 5.5C6.9 5.5 6.1 6.1 6.1 7.0C6.1 7.9 6.9 8.3 8.0 8.6C9.1 8.9 9.9 9.3 9.9 10.3C9.9 11.2 9.1 11.7 8.0 11.7C6.9 11.7 6.1 11.2 6.0 10.4" stroke="#171717" stroke-width="1.1" stroke-linecap="round"></path>
                    </svg>
                </div>
                <div style="text-align:center;color:#171717;font-size:14px;font-family:Noto Sans;font-weight:700;line-height:18px;word-wrap:break-word">
                    <span class="account-menu-masthead-item-text" style="color: inherit; text-decoration: none;">Quotes</span>
                </div>
            </div>
            <div style="align-self:stretch;padding-left:24px;justify-content:space-between;align-items:flex-start;display:inline-flex">
                <div style="flex:1 1 0;color:#4e444e;font-size:12px;font-family:Noto Sans;font-weight:400;line-height:14px;word-wrap:break-word">
                    View &amp; manage your quotes
                </div>
            </div>
        `;

        const refreshHref = () => {
            const latestUrl = resolveQuoteListUrl(mastheadEl);
            if (latestUrl && anchor.href !== latestUrl) {
                anchor.href = latestUrl;
            }
        };
        anchor.addEventListener('mouseenter', refreshHref);
        anchor.addEventListener('focus', refreshHref);
        anchor.addEventListener('click', refreshHref);

        return anchor;
    }

    function findPopoverAnchorTarget(mastheadEl) {
        const ordersHrefLink = mastheadEl.querySelector('a[href*="/account/order"]');
        if (ordersHrefLink && ordersHrefLink.parentElement) {
            return { referenceNode: ordersHrefLink, insertAfter: true };
        }

        const itemLabels = mastheadEl.querySelectorAll('.account-menu-masthead-item-text');
        for (let i = 0; i < itemLabels.length; i++) {
            const anchor = itemLabels[i].closest('a');
            if (anchor && /^orders$/i.test((itemLabels[i].textContent || '').trim())) {
                return { referenceNode: anchor, insertAfter: true };
            }
        }

        const fallbackSelectors = [
            'a[href*="/account/rewards"]',
            'a[href*="/account/myprofile"]',
            'a[href*="/account/wishlist"]'
        ];
        for (let i = 0; i < fallbackSelectors.length; i++) {
            const link = mastheadEl.querySelector(fallbackSelectors[i]);
            if (link && link.parentElement) {
                return { referenceNode: link, insertAfter: false };
            }
        }

        const firstItemAnchor = itemLabels[0]?.closest('a');
        if (firstItemAnchor && firstItemAnchor.parentElement) {
            return { referenceNode: firstItemAnchor, insertAfter: false };
        }

        return null;
    }

    function processPopoverMasthead(mastheadEl) {
        if (!mastheadEl) return false;

        const quoteUrl = resolveQuoteListUrl(mastheadEl);
        if (!quoteUrl) return false;

        const existingInjected = mastheadEl.querySelector(`.${QUOTES_LINK_CLASS}`);
        if (existingInjected) {
            if (existingInjected.href !== quoteUrl) {
                existingInjected.href = quoteUrl;
            }
            return true;
        }

        const existingNative = mastheadEl.querySelector('a[href*="/account/quote/"]');
        if (existingNative) {
            return true;
        }

        const target = findPopoverAnchorTarget(mastheadEl);
        if (!target) return false;

        injectStyles();
        const quoteEl = createQuotesAnchor(quoteUrl, mastheadEl);
        if (target.insertAfter) {
            target.referenceNode.insertAdjacentElement('afterend', quoteEl);
        } else {
            target.referenceNode.insertAdjacentElement('beforebegin', quoteEl);
        }

        return true;
    }

    function cleanDateCellText(cellEl) {
        if (!cellEl) return '';
        let text = '';
        for (let i = 0; i < cellEl.childNodes.length; i++) {
            const node = cellEl.childNodes[i];
            if (node.nodeType === 1) {
                if (node.style?.display === 'none' || node.classList?.contains('item-expiring')) continue;
            }
            text += node.textContent || '';
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    function extractQuoteRowData(itemEl) {
        const row = itemEl.matches('tr') ? itemEl : itemEl.querySelector('tr.table-item-base-info') || itemEl;
        const quoteIdTd = row.querySelector('td.quoteIdList');
        const quoteIdAnchor = quoteIdTd?.querySelector('a');
        const quoteId = (quoteIdAnchor?.textContent || quoteIdTd?.textContent || '')
            .replace(/^[▸▾]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();

        const datePlaced = (quoteIdTd?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim();
        const expirationDate = cleanDateCellText(row.querySelector('td.item-expire-time'));
        const status = (row.querySelector('td.item-status')?.textContent || '').replace(/\s+/g, ' ').trim();
        const storeTd = row.querySelector('td.item-store-name');
        const storeName = (storeTd?.textContent || '').replace(/\s+/g, ' ').trim();

        let totalAmount = '';
        const candidateTotalTd = storeTd?.nextElementSibling;
        if (candidateTotalTd && !candidateTotalTd.classList.contains('item-requote')) {
            totalAmount = (candidateTotalTd.textContent || '').replace(/\s+/g, ' ').trim();
        }

        const detailAnchor = row.querySelector('td.quoteDetailList a');
        const rawHref = detailAnchor?.getAttribute('href') || quoteIdAnchor?.getAttribute('href') || '';
        let hrefInternalId = '';
        if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
            try {
                hrefInternalId = new URL(rawHref, window.location.origin).searchParams.get('id') || '';
            } catch (_) {
            }
        }
        const attrInternalId =
            itemEl.getAttribute('data-quoteid') ||
            itemEl.closest?.('[data-quoteid]')?.getAttribute('data-quoteid') ||
            '';
        const internalId = hrefInternalId || attrInternalId;
        const detailUrl = buildStoreQuoteDetailUrl(internalId, rawHref);

        return {
            internalId,
            attrInternalId,
            quoteId,
            datePlaced,
            expirationDate,
            status,
            storeName,
            totalAmount,
            detailUrl,
            quoteIdAnchor,
            quoteIdTd,
            detailCell: row.querySelector('td.quoteDetailList')
        };
    }

    function getFiniteNumber(val) {
        if (typeof val === 'number') {
            return Number.isFinite(val) ? val : null;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return null;
            const parsed = Number(trimmed.replace(/,/g, ''));
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    function formatQuoteMoney(amount, currency) {
        const num = getFiniteNumber(amount);
        if (num === null) return '';
        const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return currency ? `${currency} ${formatted}` : `$${formatted}`;
    }

    function getEntryLineTotal(entry) {
        if (!entry || typeof entry !== 'object') return null;
        if (entry.totalPrice !== null && entry.totalPrice !== undefined) {
            const total = getFiniteNumber(entry.totalPrice);
            if (total !== null) return total;
        }
        if (entry.priceUnit !== null && entry.priceUnit !== undefined) {
            const unit = getFiniteNumber(entry.priceUnit);
            if (unit !== null) {
                const qty = getFiniteNumber(entry.qty);
                return unit * (qty && qty > 0 ? qty : 1);
            }
        }
        return null;
    }

    function getEntryListTotal(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const qtyVal = getFiniteNumber(entry.qty);
        const qty = qtyVal && qtyVal > 0 ? qtyVal : 1;

        if (entry.webPriceUnit !== null && entry.webPriceUnit !== undefined) {
            const wpu = getFiniteNumber(entry.webPriceUnit);
            if (wpu !== null) return wpu * qty;
        }
        if (entry.entryPrice !== null && entry.entryPrice !== undefined) {
            const ep = getFiniteNumber(entry.entryPrice);
            if (ep !== null) return ep * qty;
        }
        if (entry.webPrice !== null && entry.webPrice !== undefined) {
            const wp = getFiniteNumber(entry.webPrice);
            if (wp !== null) return wp;
        }
        return null;
    }

    function resolveMainItemPricing(item, allItems, quote) {
        const direct = getEntryLineTotal(item);
        const list = getEntryListTotal(item);
        const subItems = Array.isArray(item?.subItems) ? item.subItems : [];

        let subItemsTotal = 0;
        let hasAllSubPrices = true;
        for (let i = 0; i < subItems.length; i++) {
            const sub = subItems[i];
            if (!sub || typeof sub !== 'object') continue;
            const subPrice = getEntryLineTotal(sub);
            if (subPrice !== null) {
                subItemsTotal += subPrice;
            } else {
                const subList = getEntryListTotal(sub);
                if (subList !== null && subList > 0) {
                    hasAllSubPrices = false;
                }
            }
        }

        const quoteTotal = getFiniteNumber(quote?.totalPrice);
        const shipping = getFiniteNumber(quote?.shippingFee) || 0;
        const tax =
            getFiniteNumber(quote?.tax) ??
            getFiniteNumber(quote?.j1avTotalTax) ??
            getFiniteNumber(quote?.adiTotalTax) ??
            0;
        const quoteItemsTotal = quoteTotal !== null ? Math.max(0, quoteTotal - shipping - tax) : null;

        let standalone = null;
        let combined = null;

        if (direct !== null) {
            if (
                allItems.length === 1 &&
                subItems.length > 0 &&
                hasAllSubPrices &&
                subItemsTotal > 0 &&
                quoteItemsTotal !== null &&
                Math.abs(direct - quoteItemsTotal) < 0.05
            ) {
                standalone = Math.max(0, direct - subItemsTotal);
                combined = direct;
            } else {
                standalone = direct;
                combined = subItems.length > 0 && hasAllSubPrices && subItemsTotal > 0 ? direct + subItemsTotal : null;
            }
        } else if (allItems.length === 1 && quoteItemsTotal !== null) {
            if (subItems.length === 0) {
                standalone = quoteItemsTotal;
            } else if (hasAllSubPrices) {
                standalone = Math.max(0, quoteItemsTotal - subItemsTotal);
                if (subItemsTotal > 0) {
                    combined = quoteItemsTotal;
                }
            } else {
                combined = quoteItemsTotal;
            }
        }

        return { standalone, combined, list };
    }

    function createMetaField(label, value, copyValue) {
        const field = document.createElement('div');
        field.className = 'qr-meta-field';

        const labelEl = document.createElement('span');
        labelEl.className = 'qr-meta-label';
        labelEl.textContent = `${label}:`;
        field.appendChild(labelEl);

        const valEl = document.createElement('span');
        valEl.className = 'qr-meta-val';
        valEl.textContent = value || '—';
        if (copyValue) {
            bindClickToCopy(valEl, copyValue, `Click to copy ${label}`);
        }
        field.appendChild(valEl);

        return field;
    }

    function hasItemPriceOverride(entry) {
        if (!entry || typeof entry !== 'object') return false;
        return (
            (entry.priceOverride !== null && entry.priceOverride !== undefined && entry.priceOverride !== false) ||
            (entry.priceOverrideTotal !== null && entry.priceOverrideTotal !== undefined) ||
            (entry.details?.priceOverrideDiscountAppliedPrice !== null &&
                entry.details?.priceOverrideDiscountAppliedPrice !== undefined)
        );
    }

    function appendProfitAndOverrideDetails(targetRow, entry, currency) {
        if (!entry || typeof entry !== 'object') return;

        const hasLineProfit = entry.lineProfit !== null && entry.lineProfit !== undefined;
        const hasProfit = entry.profit !== null && entry.profit !== undefined;

        if (hasLineProfit) {
            const lpText = formatQuoteMoney(entry.lineProfit, currency) || String(entry.lineProfit);
            const lpEl = document.createElement('span');
            lpEl.className = 'qr-item-detail';
            lpEl.textContent = entry.lineProfitRate
                ? `Line Profit: ${lpText} (${entry.lineProfitRate})`
                : `Line Profit: ${lpText}`;
            targetRow.appendChild(lpEl);
        }

        if (hasProfit && (!hasLineProfit || getFiniteNumber(entry.profit) !== getFiniteNumber(entry.lineProfit))) {
            const profText = formatQuoteMoney(entry.profit, currency) || String(entry.profit);
            const profEl = document.createElement('span');
            profEl.className = 'qr-item-detail';
            profEl.textContent = entry.profitRate ? `Profit: ${profText} (${entry.profitRate})` : `Profit: ${profText}`;
            targetRow.appendChild(profEl);
        }

        if (hasItemPriceOverride(entry)) {
            const ovEl = document.createElement('span');
            ovEl.className = 'qr-override-badge';
            const ovVal = entry.priceOverride ?? entry.priceOverrideTotal ?? entry.details?.priceOverrideDiscountAppliedPrice;
            const ovRate = entry.details?.priceOverrideDiscountAppliedRate;
            let text = 'Price Override';
            if (typeof ovVal === 'number' || (typeof ovVal === 'string' && ovVal.trim())) {
                const formatted = formatQuoteMoney(ovVal, currency) || (currency ? `${currency} ${ovVal}` : `$${ovVal}`);
                text = ovRate ? `Price Override: ${formatted} (${ovRate})` : `Price Override: ${formatted}`;
            } else if (ovRate) {
                text = `Price Override (${ovRate})`;
            }
            if (entry.reason) {
                text += ` - ${entry.reason}`;
            }
            ovEl.textContent = text;
            targetRow.appendChild(ovEl);
        }
    }

    function cleanSpecText(raw) {
        if (raw === null || raw === undefined) return '';
        return String(raw)
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s*-\s*selected upgrade\s*$/i, '')
            .trim();
    }

    function classifySpecSlot(rawLabel) {
        const label = cleanSpecText(rawLabel).replace(/[:\s]+$/, '').toLowerCase();
        if (!label) return null;
        if (/^(?:processor|cpu)(?:\b|$)/.test(label)) return 'CPU';
        if (/\b(?:memory|ram)\b/.test(label) && !/\b(?:video|graphics?|gpu|cache|optane)\b/.test(label)) {
            return 'RAM';
        }
        if (/\b(?:graphics?(?:\s*card)?|gpu|video(?:\s*card)?)\b/.test(label)) return 'GPU';
        if (
            /\b(?:solid\s*state\s*drive|hard\s*(?:disk\s*)?drive|storage|ssd|hdd)\b/.test(label) &&
            !/\b(?:bay|caddy|bracket|cable|enclosure|adapter|reader)\b/.test(label)
        ) {
            return 'Storage';
        }
        return null;
    }

    function isEmptySpecValue(val) {
        if (!val) return true;
        return /^(?:none|n\/a|-+|no\s+(?:second|2nd|third|3rd|storage|hard\s*drive|solid\s*state\s*drive|ssd|hdd|discrete\s*graphics?|gpu))\b/i.test(
            val
        );
    }

    function extractKeySpecsFromPairs(pairs) {
        const buckets = { CPU: [], RAM: [], GPU: [], Storage: [] };
        for (let i = 0; i < pairs.length; i++) {
            const pair = pairs[i];
            if (!Array.isArray(pair) || pair.length < 2) continue;
            const slot = classifySpecSlot(pair[0]);
            if (!slot) continue;
            const val = cleanSpecText(pair[1]);
            if (isEmptySpecValue(val)) continue;
            if (!buckets[slot].includes(val)) {
                buckets[slot].push(val);
            }
        }

        const result = {};
        const order = ['CPU', 'RAM', 'GPU', 'Storage'];
        let count = 0;
        for (let i = 0; i < order.length; i++) {
            const k = order[i];
            if (buckets[k].length > 0) {
                result[k] = buckets[k].join(' + ');
                count++;
            }
        }
        return count > 0 ? result : null;
    }

    function pushSplitSpecString(rawText, pairs) {
        const text = cleanSpecText(rawText);
        if (!text) return;
        const lines = text.split(/\r?\n|;/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                pairs.push([line.slice(0, colonIdx), line.slice(colonIdx + 1)]);
            }
        }
    }

    function collectJsonSpecPairs(container, pairs, depth = 0) {
        if (!container || depth > 4) return;
        if (typeof container === 'string') {
            const trimmed = container.trim();
            if (!trimmed) return;
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                try {
                    collectJsonSpecPairs(JSON.parse(trimmed), pairs, depth + 1);
                    return;
                } catch (_) {
                }
            }
            pushSplitSpecString(trimmed, pairs);
            return;
        }
        if (Array.isArray(container)) {
            for (let i = 0; i < container.length; i++) {
                const entry = container[i];
                if (typeof entry === 'string') {
                    pushSplitSpecString(entry, pairs);
                } else if (entry && typeof entry === 'object') {
                    const label =
                        entry.label ??
                        entry.name ??
                        entry.title ??
                        entry.categoryName ??
                        entry.groupName ??
                        entry.cvName ??
                        entry.featureName ??
                        entry.attributeName ??
                        entry.specName ??
                        '';
                    const val =
                        entry.value ??
                        entry.cvValue ??
                        entry.val ??
                        entry.description ??
                        entry.text ??
                        entry.optionName ??
                        entry.displayValue ??
                        entry.specValue ??
                        '';
                    if (label && (typeof val === 'string' || typeof val === 'number')) {
                        pairs.push([String(label), String(val)]);
                    } else if (!label && typeof (entry.display || entry.text) === 'string') {
                        pushSplitSpecString(entry.display || entry.text, pairs);
                    }
                    const nested = entry.children || entry.items || entry.values;
                    if (Array.isArray(nested)) {
                        collectJsonSpecPairs(nested, pairs, depth + 1);
                    }
                }
            }
            return;
        }
        if (typeof container === 'object') {
            const keys = Object.keys(container);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const v = container[k];
                if (typeof v === 'string' || typeof v === 'number') {
                    pairs.push([k, String(v)]);
                } else if (v && typeof v === 'object') {
                    collectJsonSpecPairs(v, pairs, depth + 1);
                }
            }
        }
    }

    function extractKeySpecsFromQuoteItem(item) {
        if (!item || typeof item !== 'object') return null;
        const pairs = [];
        const sources = [
            item.cvResult,
            item.details?.cdCtoCvList,
            item.details?.absentCvResult,
            item.specs,
            item.specList,
            item.configItems,
            item.cvItems
        ];
        for (let i = 0; i < sources.length; i++) {
            if (sources[i]) {
                collectJsonSpecPairs(sources[i], pairs);
            }
        }
        return pairs.length > 0 ? extractKeySpecsFromPairs(pairs) : null;
    }

    function extractKeySpecsFromDetailProductDom(productBlockEl) {
        if (!productBlockEl) return null;
        const specNodes = productBlockEl.querySelectorAll('.config-item .item-left');
        if (specNodes.length === 0) return null;

        const pairs = [];
        for (let i = 0; i < specNodes.length; i++) {
            const el = specNodes[i];
            let rawText = '';
            for (let j = 0; j < el.childNodes.length; j++) {
                const child = el.childNodes[j];
                if (child.nodeType === 1 && child.classList?.contains('upgrade')) continue;
                rawText += child.textContent || '';
            }
            const normalized = cleanSpecText(rawText);
            if (!normalized) continue;
            const ariaLabel = cleanSpecText(el.getAttribute('aria-label') || '');
            const colonIdx = normalized.indexOf(':');
            if (colonIdx > 0) {
                const prefix = normalized.slice(0, colonIdx).trim();
                const value = normalized.slice(colonIdx + 1).trim();
                pairs.push([prefix || ariaLabel, value]);
            } else if (ariaLabel) {
                pairs.push([ariaLabel, normalized]);
            }
        }
        return pairs.length > 0 ? extractKeySpecsFromPairs(pairs) : null;
    }

    function createKeySpecsElement(specs) {
        if (!specs) return null;
        const order = ['CPU', 'RAM', 'GPU', 'Storage'];
        const wrap = document.createElement('div');
        wrap.className = SPEC_SUMMARY_CLASS;
        wrap.dataset.qrSpecsSig = JSON.stringify(specs);

        for (let i = 0; i < order.length; i++) {
            const key = order[i];
            if (!specs[key]) continue;

            const chip = document.createElement('span');
            chip.className = 'qr-spec-chip';

            const labelEl = document.createElement('span');
            labelEl.className = 'qr-spec-label';
            labelEl.textContent = `${key}:`;
            chip.appendChild(labelEl);

            const valEl = document.createElement('span');
            valEl.className = 'qr-spec-val';
            valEl.textContent = specs[key];
            chip.appendChild(valEl);

            wrap.appendChild(chip);
        }

        return wrap.childElementCount > 0 ? wrap : null;
    }

    function populateExpandedPanel(panel, quote, rowEl) {
        panel.textContent = '';

        const metaRow = document.createElement('div');
        metaRow.className = 'qr-expand-meta';

        const creatorName = (quote.creatorName || quote.creator || '').trim();
        const creatorDisplay =
            creatorName && quote.creator && quote.creatorName && quote.creator !== quote.creatorName
                ? `${quote.creatorName} (${quote.creator})`
                : creatorName;
        metaRow.appendChild(createMetaField('Creator', creatorDisplay || '—', creatorName || ''));

        const rawRepId = quote.repId || quote.details?.creatorTeleRepId || quote.salesNumber || '';
        const repFullName = [quote.details?.representativeFirstName, quote.details?.representativeLastName]
            .filter(Boolean)
            .join(' ')
            .trim();
        const repDisplay = rawRepId
            ? repFullName
                ? `${rawRepId} (${repFullName})`
                : String(rawRepId)
            : repFullName || quote.details?.representativeEmail || '—';
        metaRow.appendChild(
            createMetaField('Rep ID', repDisplay, rawRepId ? String(rawRepId) : quote.details?.representativeEmail || '')
        );

        const quoteModifier =
            quote.modifier ||
            quote.modifiedBy ||
            quote.lastModifiedBy ||
            quote.updateUser ||
            quote.updatedBy ||
            quote.details?.modifier ||
            quote.details?.modifiedBy ||
            quote.details?.lastModifiedBy ||
            '';
        const itemModifiers = [];
        if (Array.isArray(quote.items)) {
            for (let i = 0; i < quote.items.length; i++) {
                const mod = quote.items[i]?.lastModifiedByFromJDA;
                if (typeof mod === 'string' && mod.trim() && !itemModifiers.includes(mod.trim())) {
                    itemModifiers.push(mod.trim());
                }
            }
        }
        const modifierBase = quoteModifier || itemModifiers.join(', ');
        const modifierDisplay = modifierBase
            ? quote.teleModify
                ? `${modifierBase} (Tele Modified)`
                : modifierBase
            : quote.teleModify
            ? 'Telesales Modified'
            : '—';
        metaRow.appendChild(createMetaField('Modifier', modifierDisplay, modifierBase || ''));

        if (quote.customerId) {
            metaRow.appendChild(createMetaField('Requestor', quote.customerId, quote.customerId));
        }
        if (quote.ecouponApplied) {
            metaRow.appendChild(createMetaField('eCoupon', quote.ecouponApplied, quote.ecouponApplied));
        }

        const items = Array.isArray(quote.items) ? quote.items : [];
        const anyOverride =
            (quote.priceOverride !== null && quote.priceOverride !== undefined && quote.priceOverride !== false) ||
            items.some(
                (it) =>
                    hasItemPriceOverride(it) ||
                    (Array.isArray(it?.subItems) && it.subItems.some((sub) => hasItemPriceOverride(sub)))
            );
        if (anyOverride) {
            const ovBadge = document.createElement('span');
            ovBadge.className = 'qr-override-badge';
            ovBadge.textContent = 'Price Override';
            metaRow.appendChild(ovBadge);
        }

        const copyInstrBtn = document.createElement('button');
        copyInstrBtn.type = 'button';
        copyInstrBtn.className = COPY_ROW_BTN_CLASS;
        copyInstrBtn.textContent = 'Copy Instructions';
        copyInstrBtn.title = 'Copy Quote ID, direct link & steps to convert';
        copyInstrBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const liveRowData = rowEl ? extractQuoteRowData(rowEl) : null;
            const quoteId = liveRowData?.quoteId || quote.quoteId || '';
            const detailUrl = liveRowData?.detailUrl || buildStoreQuoteDetailUrl(quote.id, '');
            const instructions = formatCustomerInstructions({ quoteId, detailUrl });
            copyTextToClipboard(instructions).then(() => flashCopiedButton(copyInstrBtn, 'Copied ✓'));
        });
        metaRow.appendChild(copyInstrBtn);

        panel.appendChild(metaRow);

        const itemsWrap = document.createElement('div');
        itemsWrap.className = 'qr-expand-items';

        const currency = quote.currency || '';
        if (items.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'qr-item-detail';
            emptyEl.textContent = 'No item details returned.';
            itemsWrap.appendChild(emptyEl);
        } else {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item || typeof item !== 'object') continue;

                const row = document.createElement('div');
                row.className = 'qr-expand-item-row';

                const qtyEl = document.createElement('span');
                qtyEl.className = 'qr-item-qty';
                qtyEl.textContent = `${item.qty ?? 1}×`;
                row.appendChild(qtyEl);

                const nameEl = document.createElement('span');
                nameEl.className = 'qr-item-name';
                nameEl.textContent = item.productName || item.partNumber || 'Item';
                row.appendChild(nameEl);

                if (item.partNumber) {
                    const pnEl = document.createElement('span');
                    pnEl.className = 'qr-item-pn';
                    pnEl.textContent = item.partNumber;
                    bindClickToCopy(pnEl, item.partNumber, 'Click to copy Part Number');
                    row.appendChild(pnEl);
                }

                const pricing = resolveMainItemPricing(item, items, quote);
                if (pricing.standalone !== null) {
                    const priceEl = document.createElement('span');
                    priceEl.className = 'qr-item-detail';
                    priceEl.textContent = formatQuoteMoney(pricing.standalone, currency);
                    row.appendChild(priceEl);
                }
                if (pricing.combined !== null) {
                    const combEl = document.createElement('span');
                    combEl.className = 'qr-item-detail';
                    combEl.textContent = `With included: ${formatQuoteMoney(pricing.combined, currency)}`;
                    row.appendChild(combEl);
                }
                if (
                    pricing.list !== null &&
                    ((pricing.standalone === null && pricing.combined === null) ||
                        (pricing.standalone !== null && Math.abs(pricing.list - pricing.standalone) >= 0.01))
                ) {
                    const listEl = document.createElement('span');
                    listEl.className = 'qr-item-detail';
                    listEl.textContent = `List: ${formatQuoteMoney(pricing.list, currency)}`;
                    row.appendChild(listEl);
                }

                if (item.salePriceDiscount) {
                    const discEl = document.createElement('span');
                    discEl.className = 'qr-item-detail';
                    discEl.textContent = `${item.salePriceDiscount} OFF`;
                    row.appendChild(discEl);
                }

                appendProfitAndOverrideDetails(row, item, currency);

                if (item.lastModifiedByFromJDA) {
                    const modEl = document.createElement('span');
                    modEl.className = 'qr-item-detail';
                    modEl.textContent = `Modified by: ${item.lastModifiedByFromJDA}`;
                    row.appendChild(modEl);
                }

                itemsWrap.appendChild(row);

                const itemSpecs = extractKeySpecsFromQuoteItem(item);
                if (itemSpecs) {
                    const specsEl = createKeySpecsElement(itemSpecs);
                    if (specsEl) itemsWrap.appendChild(specsEl);
                }

                const subItems = Array.isArray(item.subItems) ? item.subItems : [];
                for (let j = 0; j < subItems.length; j++) {
                    const sub = subItems[j];
                    if (!sub || typeof sub !== 'object') continue;

                    const subRow = document.createElement('div');
                    subRow.className = 'qr-expand-subitem-row';

                    const subArrow = document.createElement('span');
                    subArrow.textContent = `↳ ${sub.qty ?? 1}×`;
                    subRow.appendChild(subArrow);

                    const subName = document.createElement('span');
                    subName.className = 'qr-item-name';
                    subName.textContent = sub.productName || sub.partNumber || 'Included Item';
                    subRow.appendChild(subName);

                    if (sub.partNumber) {
                        const subPn = document.createElement('span');
                        subPn.className = 'qr-item-pn';
                        subPn.textContent = sub.partNumber;
                        bindClickToCopy(subPn, sub.partNumber, 'Click to copy Part Number');
                        subRow.appendChild(subPn);
                    }

                    const subDirect = getEntryLineTotal(sub);
                    const subList = getEntryListTotal(sub);
                    const subPriceText =
                        subDirect !== null
                            ? formatQuoteMoney(subDirect, currency)
                            : subList !== null
                            ? `List: ${formatQuoteMoney(subList, currency)}`
                            : '';
                    if (subPriceText) {
                        const subPriceEl = document.createElement('span');
                        subPriceEl.className = 'qr-item-detail';
                        subPriceEl.textContent = subPriceText;
                        subRow.appendChild(subPriceEl);
                    }

                    if (sub.salePriceDiscount) {
                        const subDisc = document.createElement('span');
                        subDisc.className = 'qr-item-detail';
                        subDisc.textContent = `${sub.salePriceDiscount} OFF`;
                        subRow.appendChild(subDisc);
                    }

                    appendProfitAndOverrideDetails(subRow, sub, currency);

                    itemsWrap.appendChild(subRow);
                }
            }
        }

        panel.appendChild(itemsWrap);
    }

    function resolveApiQuoteForRow(data) {
        if (!data) return null;
        return (
            (data.quoteId && quoteApiCache.get(data.quoteId.toUpperCase())) ||
            (data.internalId && quoteApiCache.get(String(data.internalId))) ||
            (data.attrInternalId && quoteApiCache.get(String(data.attrInternalId))) ||
            null
        );
    }

    function buildQuotePanelKey(quote) {
        return `${quote?.id ?? ''}:${quote?.quoteId ?? ''}:${quote?.creatorName ?? ''}:${quote?.creator ?? ''}:${
            quote?.totalPrice ?? ''
        }:${Array.isArray(quote?.items) ? quote.items.length : 0}`;
    }

    function attachExpandableDetails(rowEl, data) {
        if (!rowEl || !rowEl.classList?.contains('table-item')) return;

        const apiQuote = resolveApiQuoteForRow(data);
        if (!apiQuote) return;

        rowEl.classList.add('qr-row-host');
        const quoteKey = buildQuotePanelKey(apiQuote);

        let toggleBtn = rowEl.querySelector(`:scope > .${EXPAND_TOGGLE_CLASS}`);
        if (!toggleBtn) {
            toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = EXPAND_TOGGLE_CLASS;
            toggleBtn.textContent = '▸';
            toggleBtn.title = 'Expand Creator, Rep ID, Modifier & Items';
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const latestData = extractQuoteRowData(rowEl);
                const latestQuote = resolveApiQuoteForRow(latestData);
                const latestPanel = rowEl.querySelector(`:scope > .${EXPAND_PANEL_CLASS}`);
                if (latestQuote && latestPanel) {
                    const latestKey = buildQuotePanelKey(latestQuote);
                    if (latestPanel.dataset.qrKey !== latestKey) {
                        latestPanel.dataset.qrKey = latestKey;
                        populateExpandedPanel(latestPanel, latestQuote, rowEl);
                    }
                }
                const expanded = rowEl.classList.toggle('qr-expanded');
                toggleBtn.textContent = expanded ? '▾' : '▸';
                toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            });
            rowEl.appendChild(toggleBtn);
        }

        let panel = rowEl.querySelector(`:scope > .${EXPAND_PANEL_CLASS}`);
        if (!panel) {
            panel = document.createElement('div');
            panel.className = EXPAND_PANEL_CLASS;
            rowEl.appendChild(panel);
        }

        if (panel.dataset.qrKey !== quoteKey) {
            panel.dataset.qrKey = quoteKey;
            rowEl.classList.remove('qr-expanded');
            if (toggleBtn) {
                toggleBtn.textContent = '▸';
                toggleBtn.setAttribute('aria-expanded', 'false');
            }
            populateExpandedPanel(panel, apiQuote, rowEl);
        }
    }

    function sanitizeTsvCell(val) {
        return String(val || '')
            .replace(/[\t\r\n]+/g, ' ')
            .trim();
    }

    function buildExcelTsv(rows) {
        const header = ['Quote ID', 'Date Placed', 'Expiration Date', 'Status', 'Store Name', 'Total Amount', 'Quote Link'];
        const lines = [header.join('\t')];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            lines.push(
                [
                    r.quoteId,
                    r.datePlaced,
                    r.expirationDate,
                    r.status,
                    r.storeName,
                    r.totalAmount,
                    r.detailUrl
                ]
                    .map(sanitizeTsvCell)
                    .join('\t')
            );
        }
        return lines.join('\r\n');
    }

    function updateSavedQuotesListPage() {
        const isListRoute = /\/account\/quote\/list/i.test(window.location.pathname);
        const section = document.querySelector('.filter-result-section');
        if (!section) return !isListRoute;

        injectStyles();

        const resultHeader = section.querySelector('.result-header');
        const sortByResult = resultHeader?.querySelector('.sort-by-result');
        if (resultHeader && sortByResult && !sortByResult.querySelector(`.${COPY_TABLE_BTN_CLASS}`)) {
            const copyTableBtn = document.createElement('button');
            copyTableBtn.type = 'button';
            copyTableBtn.className = COPY_TABLE_BTN_CLASS;
            copyTableBtn.textContent = 'Copy';
            copyTableBtn.title = 'Copy all visible quotes as an Excel table';
            copyTableBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rowContainers = section.querySelectorAll('.result-lists .table-item, .result-lists tr.table-item-base-info');
                const seenRows = new Set();
                const parsedRows = [];
                for (let i = 0; i < rowContainers.length; i++) {
                    const container = rowContainers[i];
                    const itemWrap = container.closest('.table-item') || container;
                    if (seenRows.has(itemWrap)) continue;
                    seenRows.add(itemWrap);
                    const data = extractQuoteRowData(itemWrap);
                    if (data.quoteId || data.detailUrl) {
                        parsedRows.push(data);
                    }
                }
                if (parsedRows.length === 0) return;
                const tsv = buildExcelTsv(parsedRows);
                copyTextToClipboard(tsv).then(() => flashCopiedButton(copyTableBtn, `Copied (${parsedRows.length}) ✓`));
            });
            sortByResult.appendChild(copyTableBtn);
        }

        const items = section.querySelectorAll('.result-lists .table-item');
        const rowEls = items.length > 0 ? items : section.querySelectorAll('.result-lists tr.table-item-base-info');

        for (let i = 0; i < rowEls.length; i++) {
            const rowEl = rowEls[i];
            const data = extractQuoteRowData(rowEl);

            if (data.quoteId && (data.quoteIdAnchor || data.quoteIdTd)) {
                bindClickToCopy(
                    data.quoteIdAnchor || data.quoteIdTd,
                    () => extractQuoteRowData(rowEl).quoteId,
                    'Click to copy Quote ID'
                );
            }

            attachExpandableDetails(rowEl, data);
        }

        return Boolean(resultHeader && rowEls.length > 0);
    }

    function findDetailFieldValueElement(labels) {
        const normalizedTargets = labels.map((l) => l.toLowerCase());
        const candidates = document.querySelectorAll('div, span, td, th, p, label, dt');

        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.closest(`.item-detail, .${QUOTES_LINK_CLASS}, .${COPYABLE_CLASS}`)) continue;
            if (el.querySelector('div, table, button, input, select')) continue;

            const labelText = (el.textContent || '').replace(/[:\s]+$/g, '').trim().toLowerCase();
            if (!labelText || !normalizedTargets.includes(labelText)) continue;

            const nextEl = el.nextElementSibling;
            if (
                nextEl &&
                !nextEl.querySelector('button, table, .item-detail') &&
                (nextEl.textContent || '').trim().length > 0 &&
                (nextEl.textContent || '').trim().length <= 160
            ) {
                return nextEl;
            }

            const parentChildren = el.parentElement?.children;
            if (parentChildren && parentChildren.length === 2 && parentChildren[0] === el) {
                const sibling = parentChildren[1];
                if (
                    sibling &&
                    !sibling.querySelector('button, table, .item-detail') &&
                    (sibling.textContent || '').trim().length > 0 &&
                    (sibling.textContent || '').trim().length <= 160
                ) {
                    return sibling;
                }
            }
        }

        return null;
    }

    function wrapTitleQuoteId() {
        const headings = document.querySelectorAll('h1, h2, [class*="quote-detail"] [class*="title"]');
        for (let i = 0; i < headings.length; i++) {
            const heading = headings[i];
            if (heading.closest('.item-detail') || heading.querySelector(`.${COPYABLE_CLASS}`)) continue;

            const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const txt = node.nodeValue || '';
                const match = txt.match(/^([\s\S]*?\bQuote\s+details\s+)([A-Z0-9-]{6,20})([\s\S]*)$/i);
                if (!match) continue;

                const span = document.createElement('span');
                span.textContent = match[2];
                bindClickToCopy(span, match[2], 'Click to copy Quote ID');

                const frag = document.createDocumentFragment();
                if (match[1]) frag.appendChild(document.createTextNode(match[1]));
                frag.appendChild(span);
                if (match[3]) frag.appendChild(document.createTextNode(match[3]));
                node.parentNode.replaceChild(frag, node);
                return match[2];
            }
        }
        return '';
    }

    function getQuoteDetailMetadata() {
        const quoteIdEl = findDetailFieldValueElement(['Quote ID']);
        const expiryEl = findDetailFieldValueElement(['Expiration Date']);
        const storeNameEl = findDetailFieldValueElement(['Store Name']);
        const requestorEl = findDetailFieldValueElement(['Requestor']);
        const repNameEl = findDetailFieldValueElement(['Representative Name']);
        const repPhoneEl = findDetailFieldValueElement(['Representative Phone Number']);
        const repEmailEl = findDetailFieldValueElement(['Representative Email']);

        let quoteId = (quoteIdEl?.textContent || '').trim();
        if (!quoteId) {
            const headings = document.querySelectorAll('h1, h2');
            for (let i = 0; i < headings.length; i++) {
                const m = (headings[i].textContent || '').match(/\bQuote\s+details\s+([A-Z0-9-]{6,20})\b/i);
                if (m) {
                    quoteId = m[1].trim();
                    break;
                }
            }
        }

        const internalId = new URLSearchParams(window.location.search).get('id') || '';
        const detailUrl = buildStoreQuoteDetailUrl(internalId, window.location.href);

        return {
            quoteId,
            expirationDate: (expiryEl?.textContent || '').trim(),
            storeName: (storeNameEl?.textContent || '').trim(),
            detailUrl,
            elements: {
                quoteIdEl,
                requestorEl,
                repNameEl,
                repPhoneEl,
                repEmailEl
            }
        };
    }

    function findQuoteDetailButtonBar() {
        const targetLabels = [
            'Edit Rep Comment',
            'Download as PDF',
            'Convert To Order',
            'Email Quote',
            'View Quote History',
            'Edit Quote'
        ];
        const controls = document.querySelectorAll('button, a');
        for (let t = 0; t < targetLabels.length; t++) {
            const target = targetLabels[t].toLowerCase();
            for (let i = 0; i < controls.length; i++) {
                const ctrl = controls[i];
                if (ctrl.closest('.item-detail')) continue;
                const label = (ctrl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
                if (label === target && ctrl.parentElement) {
                    return { container: ctrl.parentElement, referenceBtn: ctrl };
                }
            }
        }
        return null;
    }

    function updateQuoteDetailPage() {
        const isDetailRoute = /\/account\/quote\/detail/i.test(window.location.pathname);
        if (!isDetailRoute && !document.querySelector('.item-detail')) {
            return true;
        }

        injectStyles();

        const titleQuoteId = wrapTitleQuoteId();
        const meta = getQuoteDetailMetadata();

        if (!meta.quoteId && titleQuoteId) {
            meta.quoteId = titleQuoteId;
        }

        const { quoteIdEl, requestorEl, repNameEl, repPhoneEl, repEmailEl } = meta.elements;
        if (quoteIdEl) bindClickToCopy(quoteIdEl, () => quoteIdEl.textContent.trim(), 'Click to copy Quote ID');
        if (requestorEl) bindClickToCopy(requestorEl, () => requestorEl.textContent.trim(), 'Click to copy Requestor');
        if (repNameEl) bindClickToCopy(repNameEl, () => repNameEl.textContent.trim(), 'Click to copy Representative Name');
        if (repPhoneEl) bindClickToCopy(repPhoneEl, () => repPhoneEl.textContent.trim(), 'Click to copy Phone Number');
        if (repEmailEl) bindClickToCopy(repEmailEl, () => repEmailEl.textContent.trim(), 'Click to copy Representative Email');

        const buttonBar = findQuoteDetailButtonBar();
        if (buttonBar) {
            buttonBar.container.classList.add('qr-detail-btn-bar');
        }
        if (buttonBar && !buttonBar.container.querySelector(`.${COPY_INSTRUCTIONS_BTN_CLASS}`)) {
            const btn = document.createElement('button');
            btn.type = 'button';

            if (buttonBar.referenceBtn?.tagName === 'BUTTON' && buttonBar.referenceBtn.className) {
                btn.className = `${buttonBar.referenceBtn.className} ${COPY_INSTRUCTIONS_BTN_CLASS}`;
                for (let i = 0; i < buttonBar.referenceBtn.attributes.length; i++) {
                    const attr = buttonBar.referenceBtn.attributes[i];
                    if (attr.name.startsWith('data-v-')) {
                        btn.setAttribute(attr.name, '');
                    }
                }
            } else {
                btn.className = `${COPY_INSTRUCTIONS_BTN_CLASS} qr-fallback-btn`;
            }

            btn.textContent = 'Copy Instructions';
            btn.title = 'Copy Quote ID, store link, and conversion steps';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const latestMeta = getQuoteDetailMetadata();
                const text = formatCustomerInstructions({
                    quoteId: latestMeta.quoteId || titleQuoteId,
                    detailUrl: latestMeta.detailUrl
                });
                copyTextToClipboard(text).then(() => flashCopiedButton(btn, 'Copied ✓', 1400));
            });

            buttonBar.container.appendChild(btn);
        }

        const productCards = document.querySelectorAll('.item-detail .item-detail-list');
        for (let i = 0; i < productCards.length; i++) {
            const cardEl = productCards[i];
            const nameContainer = cardEl.querySelector('.item-detail-list-product-name-container');
            if (!nameContainer) continue;

            const specs = extractKeySpecsFromDetailProductDom(cardEl);
            const existing = nameContainer.querySelector(`:scope > .${SPEC_SUMMARY_CLASS}`);
            if (!specs) {
                if (existing) existing.remove();
                continue;
            }

            const nextSig = JSON.stringify(specs);
            if (existing && existing.dataset.qrSpecsSig === nextSig) continue;
            if (existing) existing.remove();

            const specsEl = createKeySpecsElement(specs);
            if (specsEl) {
                const infoEl = nameContainer.querySelector('.item-detail-list-product-info');
                if (infoEl) {
                    infoEl.insertAdjacentElement('afterend', specsEl);
                } else {
                    nameContainer.appendChild(specsEl);
                }
            }
        }

        return Boolean(buttonBar && (meta.quoteId || quoteIdEl));
    }

    function updateAll() {
        const mastheads = document.querySelectorAll(
            '.popover[data-pname="Account"] .account-menu-masthead, .account-menu-masthead'
        );
        let mastheadDone = mastheads.length > 0;
        for (let i = 0; i < mastheads.length; i++) {
            if (!processPopoverMasthead(mastheads[i])) {
                mastheadDone = false;
            }
        }

        const listDone = updateSavedQuotesListPage();
        const detailDone = updateQuoteDetailPage();

        return mastheadDone && listDone && detailDone;
    }

    function isOwnClass(el) {
        if (!el || el.nodeType !== 1) return false;
        const list = el.classList;
        if (!list) return false;
        return (
            list.contains(QUOTES_LINK_CLASS) ||
            list.contains(COPY_TABLE_BTN_CLASS) ||
            list.contains(COPY_ROW_BTN_CLASS) ||
            list.contains(EXPAND_TOGGLE_CLASS) ||
            list.contains(EXPAND_PANEL_CLASS) ||
            list.contains(COPY_INSTRUCTIONS_BTN_CLASS) ||
            list.contains(COPYABLE_CLASS) ||
            list.contains(SPEC_SUMMARY_CLASS) ||
            list.contains('qr-spec-chip')
        );
    }

    function start() {
        updateAll();

        let attempts = 0;
        const maxAttempts = 40;
        const pollTimer = setInterval(() => {
            attempts++;
            if (updateAll() || attempts >= maxAttempts) {
                clearInterval(pollTimer);
            }
        }, 500);

        window.addEventListener('popstate', updateAll);
        window.addEventListener('hashchange', updateAll);
        document.addEventListener(
            'mouseenter',
            (e) => {
                if (e.target?.nodeType === 1 && e.target.closest('.popover[data-pname="Account"], .account-menu-masthead')) {
                    updateAll();
                }
            },
            true
        );

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let hasRelevantMutation = false;
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                const targetEl = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
                if (
                    targetEl?.closest?.(
                        `.${QUOTES_LINK_CLASS}, .${COPY_TABLE_BTN_CLASS}, .${COPY_ROW_BTN_CLASS}, .${EXPAND_TOGGLE_CLASS}, .${EXPAND_PANEL_CLASS}, .${COPY_INSTRUCTIONS_BTN_CLASS}, .${SPEC_SUMMARY_CLASS}`
                    )
                ) {
                    continue;
                }

                let isOwnNode = false;
                for (let j = 0; j < m.addedNodes.length; j++) {
                    if (isOwnClass(m.addedNodes[j])) {
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
                debounceTimer = setTimeout(updateAll, 150);
            }
        });

        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['data-quoteid', 'href']
            });
        }
    }

    let started = false;
    function initWhenReady() {
        if (started || !document.body || !document.head) return;
        started = true;
        start();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initWhenReady();
    }
    document.addEventListener('DOMContentLoaded', initWhenReady, { once: true });
    window.addEventListener('load', initWhenReady, { once: true });
})();
