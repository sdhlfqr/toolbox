// ==UserScript==
// @name         Toolbox
// @namespace    https://github.com/sdhlfqr/toolbox
// @version      0.1.3
// @description  Minimal bootstrap loader for Toolbox
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lenovo.com
// @match        *://*/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/sdhlfqr/toolbox/main/userscripts/lenovo/toolbox.user.js
// @updateURL    https://raw.githubusercontent.com/sdhlfqr/toolbox/main/userscripts/lenovo/toolbox.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CORE_URL = 'https://raw.githubusercontent.com/sdhlfqr/toolbox/main/userscripts/lenovo/runtime.js';
    const CACHE_KEY = 'ytb_core_cache_v1';
    const TTL = 12 * 60 * 60 * 1000;
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let ran = false;

    const bridge = {
        version: '0.1.3',
        coreUrl: CORE_URL,
        cacheTtlMs: TTL,
        pageWindow: win,
        GM_xmlhttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
        GM_getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
        GM_setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
        GM_deleteValue: typeof GM_deleteValue === 'function' ? GM_deleteValue : null,
        GM_listValues: typeof GM_listValues === 'function' ? GM_listValues : null,
        GM_addValueChangeListener: typeof GM_addValueChangeListener === 'function' ? GM_addValueChangeListener : null,
        GM_registerMenuCommand: typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null,
        refreshCore: () => pull(false)
    };

    function run(code) {
        if (ran || !code) return;
        ran = true;
        try {
            new Function(
                'YOGIS_TOOLBOX_BRIDGE',
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
                code
            )(
                bridge,
                win,
                win,
                win,
                win,
                bridge.GM_xmlhttpRequest,
                bridge.GM_getValue,
                bridge.GM_setValue,
                bridge.GM_deleteValue,
                bridge.GM_listValues,
                bridge.GM_addValueChangeListener,
                bridge.GM_registerMenuCommand
            );
        } catch (e) {
            ran = false;
            console.error(e);
        }
    }

    function pull(exec) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${CORE_URL}?_ts=${Date.now()}`,
                headers: { 'Cache-Control': 'no-cache' },
                onload: (r) => {
                    if (r.status >= 200 && r.status < 300 && r.responseText) {
                        GM_setValue(CACHE_KEY, JSON.stringify({ code: r.responseText, fetchedAt: Date.now() }));
                        if (exec) run(r.responseText);
                        resolve(r.responseText);
                    } else {
                        resolve(null);
                    }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null)
            });
        });
    }

    let cached = null;
    try {
        cached = JSON.parse(GM_getValue(CACHE_KEY, ''));
    } catch (_) {}

    if (cached && cached.code) {
        run(cached.code);
        if (!cached.fetchedAt || Date.now() - cached.fetchedAt >= TTL) pull(false);
    } else {
        pull(true);
    }
})();
