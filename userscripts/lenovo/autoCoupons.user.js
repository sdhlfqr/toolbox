// ==UserScript==
// @name         Coupons Optimizer
// @namespace    https://www.lenovo.com/
// @version      0.0.2
// @description  Auto-tests, stacks, and maximizes Lenovo eCoupon savings across regional stores
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lenovo.com
// @match        https://www.lenovo.com/*/cart*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORE_COUPONS = {
        COMMON: {
            '2%': [
                'FIRSTBUY'
            ],
            '5%': [
                'ANAC71026',
                'ANAC71027',
                'ANAC1426',
                'ANWEL10126',
                'ANWEL10127',
                'NB71026',
                'NB71027',
                'BULK5',
                'UNBOX5CTO',
                'BLC5'
            ],
            'EDU': [
                'EDUAUG8JCDNDU',
                'UNIDAYSBLACKFRIDAY'
            ],
            'Blackfriday': [
                'BLACKFRIDAY',
                'BFEARLYACCESS',
                'BFCM26',
                'BFEA'
            ],
            'Monthly': [
                'MAY26',
                'AUG26',
                'SEP26',
                'OCT26',
                'NOV26',
                'AUGUST',
                'SEPTEMBER',
                'OCTOBER',
                'LATENIGHTAUG',
                'LATENIGHTOCTOBER'
            ],
            'Weekend': [
                'WEND',
                'WEEKENDSAVINGS',
                '2DAYSALE',
                'LATENIGHT',
                'AFTER10DEAL'
            ],
            'EOFY': [
                'EOFY26',
                'EOFY'
            ],
            'Other': [
                'LENOVODO',
                'EXTRASAVINGS',
                'TABSPECIAL',
                'TABLETS',
                'VISUALS',
                'NIGHT'
            ]
        },
        AU: {
            '2%': [],
            '5%': [
                'LISAACCAU',
                'ANAC10126',
                'AUPA130310'
            ],
            'EDU': [],
            'Blackfriday': [
                'BFCM25',
                'ATOLLSBFCM26'
            ],
            'Monthly': [],
            'Weekend': [],
            'EOFY': [
                'EOFY-E'
            ],
            'Other': [
                'AUPSPRINGSALE',
                'BSA20',
                'TA-EPIC495'
            ]
        },
        NZ: {
            '2%': [],
            '5%': [
                'LISAACCNZ',
                'LISANZ'
            ],
            'EDU': [],
            'Blackfriday': [
                'EARLYACCESSNZ'
            ],
            'Monthly': [
                'JUNENZCARTOFFAUG'
            ],
            'Weekend': [],
            'EOFY': [],
            'Other': [
                'XMASGOLD20',
                'NZCARTOFFER'
            ]
        },
        KR: {
            'General': [
                'KREDMNOV',
                'LPROMEMBERKR',
                'LVLINKPRICE',
                'KRLPRO',
                'LVSUN',
                'LVSALE',
                'KRSBAFFLE',
                'LVHJ',
                'KREDUC',
                '1111SALE'
            ]
        },
        PH: {
            'General': [
                'PHEDMNOV',
                'EASTERPH',
                'EDUPH',
                'ISRPH',
                'TECHSALEPH',
                'BFCMSALE',
                '1111SALE'
            ]
        },
        MY: {
            'General': [
                'MYEDMNOV',
                'MYLPRO',
                'MYEDUC',
                'HARIRAYAMY',
                'LPROMEMBERMY',
                'EPPSALEMY',
                'ISRDEALMY',
                '1111SALE',
                'BTSMY'
            ]
        },
        SG: {
            'General': [
                'SGEDMNOV',
                'SGLPRO',
                'ISRDEALSG',
                'SGEDUC',
                'SGCONSMTM',
                'EDUPERKSG',
                '1111SALE',
                'PERKEDUSG',
                'LVLINKPRICE'
            ]
        },
        TW: {
            'General': [
                'TWEDMNOV',
                'ICTW3OFF',
                'TWLPRO',
                'TWEDUC',
                'LPROMEMBERTW',
                'EDUPERKTW'
            ]
        },
        TH: {
            'General': [
                'THEDMNOV',
                'TECHSALETH',
                'SONGKRAN',
                'ISRTH',
                'THEDUC',
                '1111SALE',
                'MIDNIGHT',
                'PAYDAYTH'
            ]
        },
        HK: {
            'General': [
                'HKEDMNOV',
                'HKLPRO',
                'CS26S',
                'LPROMEMBERHK',
                'HKEDUC',
                'DEALSHK',
                'THINKNOV',
                'EDUPERKHK',
                'CITI2026',
                'FLASHSALE04',
                '1111SALE'
            ]
        }
    };

    const ANZ_STORES = new Set(['AU', 'NZ']);
    const DEFAULT_ACTIVE_GROUPS = ['2%', '5%', 'General'];

    const WRAPPER_CLASS = 'lct-wrapper';
    const PANEL_CLASS = 'lct-panel';
    const GROUPS_PANEL_CLASS = 'lct-groups-panel';
    const NUDGE_CLASS = 'lct-admin-nudge';
    const PROGRESS_ID = 'lct-top-progress';
    const STYLE_ID = 'lct-styles';
    const DISCOVERED_STORAGE_KEY = 'lct_discovered_coupons_v1';
    const DISMISSED_STORAGE_KEY = 'lct_dismissed_coupons_v1';

    const APPLY_CLICK_DELAY_MS = 100;
    const INVALID_WAIT_MS = 1000;
    const MAX_TEST_WAIT_MS = 3800;
    const POLL_INTERVAL_MS = 150;
    const VALUE_SETTLE_DELAY_MS = 500;
    const BETWEEN_COUPONS_DELAY_MS = 150;

    let isTesting = false;
    let stopRequested = false;
    let isTesterOpen = false;
    let isGroupsOpen = false;
    const testedDiscounts = {};
    const acceptedCoupons = new Set();
    const stackedCoupons = new Set();
    let bestCombo = { codes: [], totalSavings: 0 };
    const activeGroups = new Set(DEFAULT_ACTIVE_GROUPS);

    function roundCurrency(num) {
        return Math.round((num + Number.EPSILON) * 100) / 100;
    }

    function getStoreKey() {
        const path = (window.location.pathname || '').toLowerCase();
        const storeKeys = ['AU', 'NZ', 'KR', 'PH', 'MY', 'SG', 'TW', 'TH', 'HK'];

        for (const key of storeKeys) {
            const lowerKey = key.toLowerCase();
            if (path.startsWith(`/${lowerKey}/`) || path.includes(`/${lowerKey}/`)) {
                return key;
            }
        }

        const match = path.match(/^\/([a-z]{2})\//);
        if (match) {
            return match[1].toUpperCase();
        }

        return 'AU';
    }

    function getAllKnownStoreCoupons(store) {
        const known = new Set();
        const addFromObj = (obj) => {
            if (!obj) return;
            Object.values(obj).forEach((arr) => {
                if (Array.isArray(arr)) {
                    arr.forEach((c) => {
                        const clean = (c || '').trim().toUpperCase();
                        if (clean) known.add(clean);
                    });
                }
            });
        };
        if (ANZ_STORES.has(store)) {
            addFromObj(STORE_COUPONS.COMMON);
        }
        addFromObj(STORE_COUPONS[store]);
        return known;
    }

    function loadJsonStorage(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function saveJsonStorage(key, val) {
        try {
            window.localStorage.setItem(key, JSON.stringify(val));
        } catch (_) {
        }
    }

    function getGroupCoupons(groupName) {
        const store = getStoreKey();
        const useCommon = ANZ_STORES.has(store);
        const commonList = useCommon && STORE_COUPONS.COMMON ? STORE_COUPONS.COMMON[groupName] || [] : [];
        const storeList = (STORE_COUPONS[store] && STORE_COUPONS[store][groupName]) || [];
        const combined = [...commonList, ...storeList];
        return Array.from(new Set(combined.map((c) => c.trim().toUpperCase()).filter(Boolean)));
    }

    function getAvailableGroups() {
        const store = getStoreKey();
        const useCommon = ANZ_STORES.has(store);
        const groupSet = new Set([
            ...(useCommon ? Object.keys(STORE_COUPONS.COMMON || {}) : []),
            ...Object.keys(STORE_COUPONS[store] || {})
        ]);
        return Array.from(groupSet).filter((group) => getGroupCoupons(group).length > 0);
    }

    function getActiveCoupons() {
        const groups = getAvailableGroups().filter((group) => activeGroups.has(group));
        const stackableOrder = ['5%', '2%'];
        const mainGroups = groups.filter((g) => !stackableOrder.includes(g));
        const stackGroups = stackableOrder.filter((g) => groups.includes(g));
        const orderedGroups = [...mainGroups, ...stackGroups];

        const combined = [];
        orderedGroups.forEach((group) => {
            combined.push(...getGroupCoupons(group));
        });
        return Array.from(new Set(combined));
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${WRAPPER_CLASS} {
                display: block !important;
                box-sizing: border-box !important;
            }
            .${WRAPPER_CLASS}.lct-hidden {
                display: none !important;
            }
            .${WRAPPER_CLASS} * {
                margin: 0 !important;
                box-sizing: border-box !important;
            }
            .${PANEL_CLASS} {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                margin-bottom: 15px !important;
                background: transparent !important;
                border: none !important;
                font-size: 12px !important;
                line-height: 1.2 !important;
                color: #333 !important;
                box-sizing: border-box !important;
                padding-left: 20.5px;
                padding-right: 11.5px;
                flex-wrap: wrap !important;
            }
            .${GROUPS_PANEL_CLASS} {
                display: flex !important;
                flex-wrap: wrap !important;
                gap: 4px !important;
                align-items: center !important;
                margin-top: -8px !important;
                margin-bottom: 15px !important;
                padding-left: 20.5px !important;
                padding-right: 11.5px !important;
                box-sizing: border-box !important;
            }
            .${GROUPS_PANEL_CLASS}.lct-hidden {
                display: none !important;
            }
            .${GROUPS_PANEL_CLASS} .lct-group-tag {
                display: inline-flex !important;
                align-items: center !important;
                height: 20px !important;
                padding: 0 7px !important;
                border: 1px solid #c4c9d0 !important;
                border-radius: 3px !important;
                background: #f3f5f8 !important;
                color: #555 !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                line-height: 18px !important;
                cursor: pointer !important;
                user-select: none !important;
                white-space: nowrap !important;
                transition: all 0.12s ease !important;
            }
            .${GROUPS_PANEL_CLASS} .lct-group-tag:hover {
                border-color: #294e95 !important;
                color: #294e95 !important;
            }
            .${GROUPS_PANEL_CLASS} .lct-group-tag.lct-active {
                background: #294e95 !important;
                border-color: #294e95 !important;
                color: #fff !important;
            }
            .${PANEL_CLASS} .lct-store {
                font-weight: 700 !important;
                font-size: 11px !important;
                color: #555 !important;
            }
            .${PANEL_CLASS} .lct-btn {
                height: 22px !important;
                min-height: 22px !important;
                padding: 0 10px !important;
                border: 1px solid #294e95 !important;
                border-radius: 2px !important;
                background: #294e95 !important;
                color: #fff !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                line-height: 20px !important;
                cursor: pointer !important;
                white-space: nowrap !important;
            }
            .${PANEL_CLASS} .lct-btn:hover:not(:disabled) {
                background: #1f3c73 !important;
                border-color: #1f3c73 !important;
            }
            .${PANEL_CLASS} .lct-btn:disabled {
                opacity: 0.5 !important;
                cursor: not-allowed !important;
            }
            .${PANEL_CLASS} .lct-btn-secondary {
                background: #f3f5f8 !important;
                color: #294e95 !important;
                border: 1px solid #294e95 !important;
                padding: 0 7px !important;
            }
            .${PANEL_CLASS} .lct-btn-secondary:hover:not(:disabled) {
                background: #e4eaf4 !important;
                color: #1f3c73 !important;
            }
            .${PANEL_CLASS} .lct-readout {
                display: inline-flex !important;
                align-items: center !important;
                flex-wrap: wrap !important;
                gap: 5px !important;
                font-size: 11px !important;
                color: #333 !important;
                white-space: normal !important;
            }
            .${PANEL_CLASS} .lct-idle-empty {
                color: #888 !important;
                font-size: 11px !important;
            }
            .${PANEL_CLASS} .lct-code-pill {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                height: 20px !important;
                padding: 0 6px !important;
                background: #eaf6ee !important;
                border: 1px solid #a7d7b8 !important;
                border-radius: 3px !important;
                color: #155724 !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                line-height: 18px !important;
            }
            .${PANEL_CLASS} .lct-code-pill .lct-pill-amt {
                color: #1a7f37 !important;
                font-weight: 700 !important;
            }
            .${PANEL_CLASS} .lct-plus {
                color: #666 !important;
                font-weight: 700 !important;
                font-size: 11px !important;
            }
            .${PANEL_CLASS} .lct-total-pill {
                display: inline-flex !important;
                align-items: center !important;
                height: 20px !important;
                padding: 0 6px !important;
                background: #1a7f37 !important;
                border-radius: 3px !important;
                color: #fff !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                line-height: 20px !important;
            }
            .${PANEL_CLASS} .lct-step-badge {
                display: inline-flex !important;
                align-items: center !important;
                height: 18px !important;
                padding: 0 5px !important;
                background: #eef1f6 !important;
                border: 1px solid #d0d7de !important;
                border-radius: 2px !important;
                color: #444 !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                line-height: 16px !important;
            }
            .${PANEL_CLASS} .lct-testing-code {
                font-weight: 700 !important;
                color: #294e95 !important;
            }
            .${PANEL_CLASS} .lct-hit-amt {
                font-weight: 700 !important;
                color: #1a7f37 !important;
            }
            .${PANEL_CLASS} .lct-miss-amt {
                color: #888 !important;
            }
            .${NUDGE_CLASS} {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 6px !important;
                margin: 0 11.5px 10px 20.5px !important;
                padding: 6px 8px !important;
                background: #fff8e6 !important;
                border: 1px solid #f0b429 !important;
                border-radius: 3px !important;
                font-size: 11px !important;
                line-height: 1.3 !important;
                color: #7c4a03 !important;
                box-sizing: border-box !important;
            }
            .${NUDGE_CLASS}.lct-hidden {
                display: none !important;
            }
            .${NUDGE_CLASS} * {
                margin: 0 !important;
                box-sizing: border-box !important;
            }
            .${NUDGE_CLASS} .lct-nudge-text {
                flex: 1 !important;
                word-break: break-word !important;
            }
            .${NUDGE_CLASS} .lct-nudge-code {
                font-weight: 700 !important;
                color: #294e95 !important;
            }
            .${NUDGE_CLASS} .lct-nudge-actions {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                flex-shrink: 0 !important;
            }
            .${NUDGE_CLASS} .lct-nudge-copy {
                height: 20px !important;
                padding: 0 6px !important;
                border: 1px solid #d99b26 !important;
                border-radius: 2px !important;
                background: #fff !important;
                color: #7c4a03 !important;
                font-size: 10px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                white-space: nowrap !important;
            }
            .${NUDGE_CLASS} .lct-nudge-copy:hover {
                background: #fef0c7 !important;
            }
            .${NUDGE_CLASS} .lct-nudge-dismiss {
                border: none !important;
                background: transparent !important;
                color: #9c6515 !important;
                font-size: 13px !important;
                font-weight: 700 !important;
                line-height: 1 !important;
                padding: 0 3px !important;
                cursor: pointer !important;
            }
            #${PROGRESS_ID} {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 3px !important;
                background: rgba(225, 37, 27, 0.14) !important;
                z-index: 2147483647 !important;
                pointer-events: none !important;
                overflow: hidden !important;
            }
            #${PROGRESS_ID}.lct-hidden {
                display: none !important;
            }
            #${PROGRESS_ID} .lct-progress-fill {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                bottom: 0 !important;
                height: 100% !important;
                width: 0%;
                background: #e1251b !important;
                box-shadow: 0 0 6px rgba(225, 37, 27, 0.65) !important;
                transition: width 0.25s ease !important;
            }
            .lct-title-trigger {
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);
    }

    function updateTopProgress(percent, visible) {
        let bar = document.getElementById(PROGRESS_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = PROGRESS_ID;
            bar.className = 'lct-hidden';
            bar.innerHTML = '<div class="lct-progress-fill"></div>';
            document.body.appendChild(bar);
        }

        if (!visible) {
            bar.classList.add('lct-hidden');
            const fill = bar.querySelector('.lct-progress-fill');
            if (fill) {
                fill.style.setProperty('width', '0%', 'important');
            }
            return;
        }

        const clamped = Math.max(2, Math.min(100, Math.round(percent)));
        bar.classList.remove('lct-hidden');
        const fill = bar.querySelector('.lct-progress-fill');
        if (fill) {
            fill.style.setProperty('width', `${clamped}%`, 'important');
        }
    }

    function keepDiscountAreaInFocus() {
        const targetEl = document.getElementById('eCoupon') || document.querySelector('.summaryTotalHeader');
        if (!targetEl) return;

        const rect = targetEl.getBoundingClientRect();
        const viewHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < 60 || rect.bottom > viewHeight - 40) {
            targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
    }

    function parseCurrencyAmount(str) {
        if (!str) return 0;
        const cleaned = str.replace(/[^0-9.]/g, '');
        const val = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    function getAppliedCouponsMap() {
        const map = {};
        const items = document.querySelectorAll(
            '#eCoupon .eCopounList .item, #eCoupon .eCouponList .item, #eCoupon [class*="CopounList"] .item, #eCoupon [class*="CouponList"] .item'
        );
        items.forEach((item) => {
            const codeEl =
                item.querySelector('.label .txt') ||
                item.querySelector('.txt') ||
                item.querySelector('.label');
            const valEl = item.querySelector('.value');
            const code = codeEl ? codeEl.textContent.trim().toUpperCase() : '';
            if (code) {
                map[code] = parseCurrencyAmount(valEl ? valEl.textContent : '');
            }
        });
        return map;
    }

    function getSummarySavings() {
        const ecouponEls = document.querySelectorAll('.summaryTotalHeader .ECouponSaving .value');
        let ecouponSavings = 0;
        ecouponEls.forEach((el) => {
            ecouponSavings += parseCurrencyAmount(el.textContent);
        });
        ecouponSavings = roundCurrency(ecouponSavings);

        const totalDiscountEl = document.querySelector('.summaryTotalBody .discount .value');
        const totalYouAreSaving = parseCurrencyAmount(totalDiscountEl ? totalDiscountEl.textContent : '');

        return {
            ecouponSavings,
            totalYouAreSaving
        };
    }

    function readCartState() {
        const rawMap = getAppliedCouponsMap();
        const summary = getSummarySavings();
        const codes = Object.keys(rawMap);

        let rawItemSum = 0;
        codes.forEach((c) => {
            if (rawMap[c] > 0) {
                rawItemSum += rawMap[c];
            }
        });
        rawItemSum = roundCurrency(rawItemSum);

        const totalSavings = Math.max(summary.ecouponSavings, rawItemSum);
        return { rawMap, codes, summary, totalSavings };
    }

    function syncAppliedDiscounts() {
        const { rawMap, codes, summary, totalSavings } = readCartState();
        const currentMap = { ...rawMap };

        codes.forEach((c) => {
            if (currentMap[c] > 0) {
                testedDiscounts[c] = currentMap[c];
            } else if (testedDiscounts[c] > 0) {
                currentMap[c] = testedDiscounts[c];
            }
        });

        if (codes.length === 1 && totalSavings > 0) {
            const singleCode = codes[0];
            if (!(rawMap[singleCode] > 0)) {
                currentMap[singleCode] = totalSavings;
                testedDiscounts[singleCode] = totalSavings;
            }
        } else if (totalSavings > 0 && codes.length > 1) {
            const zeroCodes = codes.filter((c) => !(currentMap[c] > 0));
            if (zeroCodes.length === 1) {
                const targetCode = zeroCodes[0];
                let knownOtherSum = 0;
                codes.forEach((c) => {
                    if (c !== targetCode) {
                        knownOtherSum += currentMap[c] || 0;
                    }
                });
                if (totalSavings > knownOtherSum) {
                    const inferred = roundCurrency(totalSavings - knownOtherSum);
                    currentMap[targetCode] = inferred;
                    testedDiscounts[targetCode] = inferred;
                }
            }
        }

        let mapSum = 0;
        codes.forEach((c) => {
            mapSum += currentMap[c] || 0;
        });
        mapSum = roundCurrency(mapSum);

        return {
            currentMap,
            totalSavings: Math.max(totalSavings, mapSum),
            summary
        };
    }

    function setNativeInputValue(input, value) {
        if (!input) return;
        const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function computeSettledDiscount(code, beforeState) {
        const afterState = readCartState();
        const { rawMap, codes, summary, totalSavings } = afterState;

        if (rawMap[code] === undefined) {
            return 0;
        }

        codes.forEach((c) => {
            if (rawMap[c] > 0) {
                testedDiscounts[c] = rawMap[c];
            }
        });

        if (rawMap[code] > 0) {
            testedDiscounts[code] = rawMap[code];
            return rawMap[code];
        }

        if (codes.length === 1 && totalSavings > 0) {
            testedDiscounts[code] = totalSavings;
            return totalSavings;
        }

        let otherKnownSum = 0;
        codes.forEach((c) => {
            if (c !== code) {
                otherKnownSum += rawMap[c] > 0 ? rawMap[c] : (testedDiscounts[c] || 0);
            }
        });

        const inferredFromTotal =
            totalSavings > otherKnownSum ? roundCurrency(totalSavings - otherKnownSum) : 0;
        const ecouponDelta = roundCurrency(totalSavings - beforeState.totalSavings);
        const totalSavingDelta = roundCurrency(
            summary.totalYouAreSaving - beforeState.summary.totalYouAreSaving
        );

        const bestVal = Math.max(inferredFromTotal, ecouponDelta, totalSavingDelta, 0);
        if (bestVal > 0) {
            testedDiscounts[code] = bestVal;
        }
        return bestVal;
    }

    async function applySingleCoupon(code, forceSubmit) {
        keepDiscountAreaInFocus();

        let eCouponRoot = document.getElementById('eCoupon');
        if (!eCouponRoot) return 0;

        const beforeState = readCartState();

        if (!forceSubmit && beforeState.rawMap[code] !== undefined) {
            acceptedCoupons.add(code);
            if (beforeState.codes.length > 1) {
                beforeState.codes.forEach((c) => stackedCoupons.add(c));
            }
            if (beforeState.rawMap[code] > 0) {
                testedDiscounts[code] = beforeState.rawMap[code];
                return beforeState.rawMap[code];
            }
            if (beforeState.codes.length === 1 && beforeState.totalSavings > 0) {
                testedDiscounts[code] = beforeState.totalSavings;
                return beforeState.totalSavings;
            }
            if (testedDiscounts[code] > 0) {
                return testedDiscounts[code];
            }
        }

        const input = eCouponRoot.querySelector('.eCouponEnter input[type="text"]');
        const applyBtn = eCouponRoot.querySelector('.eCouponEnter button.apply');
        if (!input || !applyBtn) return 0;

        setNativeInputValue(input, code);
        await sleep(APPLY_CLICK_DELAY_MS);
        applyBtn.click();

        const start = Date.now();
        let valueReady = false;

        while (Date.now() - start < MAX_TEST_WAIT_MS) {
            if (stopRequested) break;
            await sleep(POLL_INTERVAL_MS);

            const elapsed = Date.now() - start;
            const nowState = readCartState();
            const isCodeInList = nowState.rawMap[code] !== undefined;
            const savingsChanged =
                nowState.totalSavings !== beforeState.totalSavings ||
                nowState.summary.totalYouAreSaving !== beforeState.summary.totalYouAreSaving;

            if (isCodeInList) {
                const hasExplicitItemVal = nowState.rawMap[code] > 0;
                const settledByTime = elapsed >= 850;

                if (hasExplicitItemVal || savingsChanged || (beforeState.totalSavings === 0 && nowState.totalSavings > 0) || settledByTime) {
                    valueReady = true;
                    break;
                }
            } else if (elapsed >= INVALID_WAIT_MS) {
                break;
            }
        }

        if (valueReady && !stopRequested) {
            await sleep(VALUE_SETTLE_DELAY_MS);
        }

        keepDiscountAreaInFocus();
        return computeSettledDiscount(code, beforeState);
    }

    function formatAmount(num) {
        return Number.isInteger(num) ? num.toString() : num.toFixed(2);
    }

    function renderCouponPillsHtml(codes, amountsMap, totalSavings) {
        if (!codes || codes.length === 0) {
            return '<span class="lct-idle-empty">Ready</span>';
        }

        const pills = codes.map((c) => {
            const amt = amountsMap[c] || 0;
            const amtHtml = amt > 0 ? `<span class="lct-pill-amt">-$${formatAmount(amt)}</span>` : '';
            return `<span class="lct-code-pill"><span>${c}</span>${amtHtml}</span>`;
        });

        const joined = pills.join('<span class="lct-plus">+</span>');
        if (codes.length > 1 && totalSavings > 0) {
            return `${joined}<span class="lct-total-pill">-$${formatAmount(totalSavings)}</span>`;
        }
        return joined;
    }

    function formatAppliedAndBestSummaryHtml() {
        const { currentMap, totalSavings } = syncAppliedDiscounts();
        const appliedCodes = Object.keys(currentMap);

        if (appliedCodes.length > 0) {
            return renderCouponPillsHtml(appliedCodes, currentMap, totalSavings);
        }

        if (bestCombo.codes.length > 0) {
            return renderCouponPillsHtml(bestCombo.codes, testedDiscounts, bestCombo.totalSavings);
        }

        return '<span class="lct-idle-empty">Ready</span>';
    }

    function setReadoutHtml(html) {
        initCouponTester();
        const el = document.querySelector(`#eCoupon .${WRAPPER_CLASS} .lct-readout`);
        if (el) {
            el.innerHTML = html;
        }
    }

    function getUnlistedDiscoveredCoupons(store) {
        const knownSet = getAllKnownStoreCoupons(store);
        const discoveredAll = loadJsonStorage(DISCOVERED_STORAGE_KEY, {});
        const dismissedAll = loadJsonStorage(DISMISSED_STORAGE_KEY, {});
        const storeDiscovered = discoveredAll[store] || {};
        const storeDismissed = new Set(Array.isArray(dismissedAll[store]) ? dismissedAll[store] : []);

        const result = [];
        Object.entries(storeDiscovered).forEach(([code, amount]) => {
            const upper = (code || '').trim().toUpperCase();
            if (upper && !knownSet.has(upper) && !storeDismissed.has(upper)) {
                result.push({ code: upper, amount: Number(amount) || 0 });
            }
        });
        return result;
    }

    function scanForNewCouponsInBackground() {
        const store = getStoreKey();
        const knownSet = getAllKnownStoreCoupons(store);
        const { currentMap, totalSavings } = syncAppliedDiscounts();
        const appliedCodes = Object.keys(currentMap);

        appliedCodes.forEach((c) => acceptedCoupons.add(c));
        if (appliedCodes.length > 1) {
            appliedCodes.forEach((c) => stackedCoupons.add(c));
        }
        if (totalSavings > bestCombo.totalSavings && appliedCodes.length > 0) {
            bestCombo = {
                codes: [...appliedCodes],
                totalSavings
            };
        }

        let foundNew = false;
        const discoveredAll = loadJsonStorage(DISCOVERED_STORAGE_KEY, {});
        if (!discoveredAll[store]) {
            discoveredAll[store] = {};
        }

        appliedCodes.forEach((code) => {
            if (!knownSet.has(code)) {
                const disc = currentMap[code] > 0 ? currentMap[code] : totalSavings;
                if (discoveredAll[store][code] === undefined || disc > discoveredAll[store][code]) {
                    discoveredAll[store][code] = disc;
                    foundNew = true;
                }
            }
        });

        if (foundNew) {
            saveJsonStorage(DISCOVERED_STORAGE_KEY, discoveredAll);
        }

        renderAdminNudge();
    }

    function renderAdminNudge() {
        const eCouponRoot = document.getElementById('eCoupon');
        if (!eCouponRoot) return;
        const enterBlock = eCouponRoot.querySelector('.eCouponEnter');
        if (!enterBlock || !enterBlock.parentNode) return;

        const store = getStoreKey();
        const unlisted = getUnlistedDiscoveredCoupons(store);

        let nudgeEl = eCouponRoot.querySelector(`.${NUDGE_CLASS}`);
        if (unlisted.length === 0) {
            if (nudgeEl) {
                nudgeEl.classList.add('lct-hidden');
            }
            return;
        }

        if (!nudgeEl) {
            nudgeEl = document.createElement('div');
            nudgeEl.className = NUDGE_CLASS;
            enterBlock.parentNode.insertBefore(nudgeEl, enterBlock);
        }

        const formattedList = unlisted
            .map((item) =>
                item.amount > 0
                    ? `<span class="lct-nudge-code">${item.code}</span> (-$${formatAmount(item.amount)})`
                    : `<span class="lct-nudge-code">${item.code}</span>`
            )
            .join(', ');

        const plainReport = `[${store}] New coupon(s) to add to listing: ${unlisted
            .map((item) => (item.amount > 0 ? `${item.code} (-$${formatAmount(item.amount)})` : item.code))
            .join(', ')}`;

        nudgeEl.classList.remove('lct-hidden');
        nudgeEl.innerHTML = `
            <span class="lct-nudge-text">New <b>[${store}]</b> coupon detected: ${formattedList} — Please send to Admin to update the listing!</span>
            <span class="lct-nudge-actions">
                <button type="button" class="lct-nudge-copy" title="Copy coupon details for Admin">Copy for Admin</button>
                <button type="button" class="lct-nudge-dismiss" title="Dismiss notification">×</button>
            </span>
        `;

        const copyBtn = nudgeEl.querySelector('.lct-nudge-copy');
        const dismissBtn = nudgeEl.querySelector('.lct-nudge-dismiss');

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(plainReport).then(() => {
                        copyBtn.textContent = 'Copied!';
                        setTimeout(() => {
                            copyBtn.textContent = 'Copy for Admin';
                        }, 1800);
                    });
                }
            });
        }

        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                const dismissedAll = loadJsonStorage(DISMISSED_STORAGE_KEY, {});
                const list = Array.isArray(dismissedAll[store]) ? dismissedAll[store] : [];
                unlisted.forEach((item) => {
                    if (!list.includes(item.code)) list.push(item.code);
                });
                dismissedAll[store] = list;
                saveJsonStorage(DISMISSED_STORAGE_KEY, dismissedAll);
                nudgeEl.classList.add('lct-hidden');
            });
        }
    }

    function createPanel() {
        const wrapper = document.createElement('div');
        wrapper.className = `${WRAPPER_CLASS}${isTesterOpen ? '' : ' lct-hidden'}`;

        const store = getStoreKey();
        const groups = getAvailableGroups();

        const groupsHtml = groups
            .map((group) => {
                const isActive = activeGroups.has(group);
                const count = getGroupCoupons(group).length;
                return `<span class="lct-group-tag${isActive ? ' lct-active' : ''}" data-group="${group}" title="${group} (${count} coupon${count === 1 ? '' : 's'})">${group}</span>`;
            })
            .join('');

        wrapper.innerHTML = `
            <div class="${PANEL_CLASS}">
                <span class="lct-store">[${store}]</span>
                <button type="button" class="lct-btn lct-test-btn">${isTesting ? 'Stop' : 'Test'}</button>
                <button type="button" class="lct-btn lct-btn-secondary lct-groups-toggle-btn" title="Coupons">${isGroupsOpen ? 'Coupons ▴' : 'Coupons ▾'}</button>
                <div class="lct-readout"><span class="lct-idle-empty">Ready</span></div>
            </div>
            <div class="${GROUPS_PANEL_CLASS}${isGroupsOpen ? '' : ' lct-hidden'}">${groupsHtml}</div>
        `;

        const testBtn = wrapper.querySelector('.lct-test-btn');
        const groupsToggleBtn = wrapper.querySelector('.lct-groups-toggle-btn');
        const groupsPanel = wrapper.querySelector(`.${GROUPS_PANEL_CLASS}`);
        const readoutEl = wrapper.querySelector('.lct-readout');
        const groupTags = wrapper.querySelectorAll('.lct-group-tag');

        function updateTestButtonState() {
            if (!isTesting) {
                const activeCouponList = getActiveCoupons();
                testBtn.disabled = activeCouponList.length === 0;
                testBtn.title =
                    activeCouponList.length > 0
                        ? `Test ${activeCouponList.length} coupon(s) from selected groups`
                        : 'Select at least one group to test';
            }
        }

        groupsToggleBtn.addEventListener('click', () => {
            const isHidden = groupsPanel.classList.toggle('lct-hidden');
            isGroupsOpen = !isHidden;
            groupsToggleBtn.textContent = isHidden ? 'Coupons ▾' : 'Coupons ▴';
        });

        groupTags.forEach((tag) => {
            tag.addEventListener('click', () => {
                if (isTesting) return;
                const group = tag.dataset.group;
                if (!group) return;
                if (activeGroups.has(group)) {
                    activeGroups.delete(group);
                    tag.classList.remove('lct-active');
                } else {
                    activeGroups.add(group);
                    tag.classList.add('lct-active');
                }
                updateTestButtonState();
            });
        });

        function refreshBestDisplay() {
            readoutEl.innerHTML = formatAppliedAndBestSummaryHtml();
            updateTestButtonState();
        }

        testBtn.addEventListener('click', async () => {
            if (isTesting) {
                stopRequested = true;
                return;
            }

            const coupons = getActiveCoupons();
            if (coupons.length === 0) return;

            isTesting = true;
            stopRequested = false;
            isTesterOpen = true;
            testBtn.textContent = 'Stop';
            updateTopProgress(3, true);
            keepDiscountAreaInFocus();

            const initialSync = syncAppliedDiscounts();
            Object.keys(initialSync.currentMap).forEach((c) => acceptedCoupons.add(c));
            if (Object.keys(initialSync.currentMap).length > 1) {
                Object.keys(initialSync.currentMap).forEach((c) => stackedCoupons.add(c));
            }
            if (initialSync.totalSavings > bestCombo.totalSavings && Object.keys(initialSync.currentMap).length > 0) {
                bestCombo = {
                    codes: Object.keys(initialSync.currentMap),
                    totalSavings: initialSync.totalSavings
                };
            }

            for (let i = 0; i < coupons.length; i++) {
                if (stopRequested) break;
                const code = coupons[i];
                const stepStr = `${i + 1}/${coupons.length}`;
                updateTopProgress(Math.round((i / coupons.length) * 80) + 5, true);
                setReadoutHtml(
                    `<span class="lct-step-badge">${stepStr}</span><span class="lct-testing-code">${code}</span>`
                );

                const discount = await applySingleCoupon(code, false);
                if (discount > (testedDiscounts[code] || 0)) {
                    testedDiscounts[code] = discount;
                }

                const { currentMap, totalSavings } = syncAppliedDiscounts();
                const currentCodes = Object.keys(currentMap);

                if (currentMap[code] !== undefined || discount > 0) {
                    acceptedCoupons.add(code);
                }
                currentCodes.forEach((c) => acceptedCoupons.add(c));

                if (currentCodes.length > 1) {
                    currentCodes.forEach((c) => stackedCoupons.add(c));
                }

                if (totalSavings > bestCombo.totalSavings && currentCodes.length > 0) {
                    bestCombo = {
                        codes: [...currentCodes],
                        totalSavings
                    };
                }

                if (discount > 0 || currentMap[code] !== undefined) {
                    const shownDisc = discount > 0 ? discount : (currentMap[code] || 0);
                    const stackHtml =
                        currentCodes.length > 1
                            ? `<span class="lct-total-pill">${currentCodes.join('+')} -$${formatAmount(totalSavings)}</span>`
                            : '';
                    setReadoutHtml(
                        `<span class="lct-step-badge">${stepStr}</span><span class="lct-testing-code">${code}</span><span class="lct-hit-amt">-$${formatAmount(shownDisc)}</span>${stackHtml}`
                    );
                } else {
                    setReadoutHtml(
                        `<span class="lct-step-badge">${stepStr}</span><span class="lct-testing-code">${code}</span><span class="lct-miss-amt">$0</span>`
                    );
                }

                updateTopProgress(Math.round(((i + 1) / coupons.length) * 80) + 5, true);

                if (!stopRequested && i < coupons.length - 1) {
                    await sleep(BETWEEN_COUPONS_DELAY_MS);
                }
            }

            if (!stopRequested && acceptedCoupons.size > 0) {
                updateTopProgress(88, true);
                const acceptedList = Array.from(acceptedCoupons).sort(
                    (a, b) => (testedDiscounts[b] || 0) - (testedDiscounts[a] || 0)
                );

                const topCoupon = acceptedList[0];
                let currentState = syncAppliedDiscounts();

                if (currentState.currentMap[topCoupon] === undefined) {
                    setReadoutHtml(
                        `<span class="lct-step-badge">Base</span><span class="lct-testing-code">${topCoupon}</span>`
                    );
                    await applySingleCoupon(topCoupon, true);
                    currentState = syncAppliedDiscounts();
                }

                const baseCodes = Object.keys(currentState.currentMap);
                if (baseCodes.length > 1) {
                    baseCodes.forEach((c) => stackedCoupons.add(c));
                }
                if (currentState.totalSavings > bestCombo.totalSavings && baseCodes.length > 0) {
                    bestCombo = {
                        codes: [...baseCodes],
                        totalSavings: currentState.totalSavings
                    };
                }

                for (let i = 1; i < acceptedList.length; i++) {
                    if (stopRequested) break;
                    const candidate = acceptedList[i];
                    updateTopProgress(88 + Math.round((i / acceptedList.length) * 10), true);
                    const beforeTry = syncAppliedDiscounts();

                    if (beforeTry.currentMap[candidate] !== undefined) {
                        const codesNow = Object.keys(beforeTry.currentMap);
                        if (codesNow.length > 1) {
                            codesNow.forEach((c) => stackedCoupons.add(c));
                        }
                        if (beforeTry.totalSavings >= bestCombo.totalSavings && codesNow.length > 0) {
                            bestCombo = {
                                codes: [...codesNow],
                                totalSavings: beforeTry.totalSavings
                            };
                        }
                        continue;
                    }

                    setReadoutHtml(
                        `<span class="lct-step-badge">Stack</span><span class="lct-testing-code">+ ${candidate}</span>`
                    );
                    await applySingleCoupon(candidate, true);
                    const afterTry = syncAppliedDiscounts();
                    const afterCodes = Object.keys(afterTry.currentMap);

                    if (afterCodes.length > 1 && afterTry.currentMap[candidate] !== undefined) {
                        afterCodes.forEach((c) => stackedCoupons.add(c));
                    }

                    if (afterTry.totalSavings > bestCombo.totalSavings && afterCodes.length > 0) {
                        bestCombo = {
                            codes: [...afterCodes],
                            totalSavings: afterTry.totalSavings
                        };
                    } else if (afterTry.totalSavings < beforeTry.totalSavings && !stopRequested) {
                        for (let j = 0; j < bestCombo.codes.length; j++) {
                            if (stopRequested) break;
                            const restoreCode = bestCombo.codes[j];
                            if (readCartState().rawMap[restoreCode] === undefined) {
                                setReadoutHtml(
                                    `<span class="lct-step-badge">Best</span><span class="lct-testing-code">${restoreCode}</span>`
                                );
                                await applySingleCoupon(restoreCode, true);
                            }
                        }
                    }
                }

                const finalCheck = readCartState();
                const missingCodes = bestCombo.codes.filter((c) => finalCheck.rawMap[c] === undefined);
                if (missingCodes.length > 0 && !stopRequested) {
                    for (let i = 0; i < bestCombo.codes.length; i++) {
                        if (stopRequested) break;
                        const c = bestCombo.codes[i];
                        if (readCartState().rawMap[c] === undefined) {
                            setReadoutHtml(
                                `<span class="lct-step-badge">Best</span><span class="lct-testing-code">${c}</span>`
                            );
                            await applySingleCoupon(c, true);
                        }
                    }
                }
            }

            updateTopProgress(100, true);
            setTimeout(() => updateTopProgress(100, false), 350);

            isTesting = false;
            stopRequested = false;
            initCouponTester();
            const liveBtn = document.querySelector(`#eCoupon .${WRAPPER_CLASS} .lct-test-btn`);
            if (liveBtn) liveBtn.textContent = 'Test';
            keepDiscountAreaInFocus();
            const liveWrapper = document.querySelector(`#eCoupon .${WRAPPER_CLASS}`);
            if (liveWrapper && typeof liveWrapper._refresh === 'function') {
                liveWrapper._refresh();
            }
        });

        wrapper._refresh = refreshBestDisplay;
        refreshBestDisplay();

        return wrapper;
    }

    function isCartSummaryLoaded() {
        const summaryVals = document.querySelectorAll('.summaryTotalHeader .value, .summaryTotalBody .value');
        for (let i = 0; i < summaryVals.length; i++) {
            if (/\d/.test(summaryVals[i].textContent || '')) {
                return true;
            }
        }
        return false;
    }

    function initCouponTester() {
        const eCouponRoot = document.getElementById('eCoupon');
        if (!eCouponRoot) return false;

        if (!isTesting && !isCartSummaryLoaded()) return false;

        const enterBlock = eCouponRoot.querySelector('.eCouponEnter');
        if (!enterBlock || !enterBlock.parentNode) return false;

        injectStyles();

        if (!isTesting) {
            scanForNewCouponsInBackground();
        }

        let wrapper = eCouponRoot.querySelector(`.${WRAPPER_CLASS}`);
        if (!wrapper) {
            wrapper = createPanel();
            enterBlock.parentNode.insertBefore(wrapper, enterBlock);
        } else if (!wrapper.classList.contains('lct-hidden') && typeof wrapper._refresh === 'function' && !isTesting) {
            wrapper._refresh();
        }

        const titleEl = eCouponRoot.querySelector('.eCouponTitle .title');
        if (titleEl && !titleEl.dataset.lctBound) {
            titleEl.dataset.lctBound = '1';
            titleEl.classList.add('lct-title-trigger');
            titleEl.title = 'Click to toggle Coupon Tester';
            titleEl.addEventListener('click', () => {
                const currentWrapper = eCouponRoot.querySelector(`.${WRAPPER_CLASS}`);
                if (!currentWrapper) return;
                const isHidden = currentWrapper.classList.toggle('lct-hidden');
                isTesterOpen = !isHidden;
                if (!isHidden && typeof currentWrapper._refresh === 'function' && !isTesting) {
                    currentWrapper._refresh();
                }
            });
        }

        return true;
    }

    function startWhenReady() {
        let attempts = 0;
        const poll = setInterval(() => {
            attempts++;
            if (initCouponTester() || attempts >= 60) {
                clearInterval(poll);
            }
        }, 500);

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (isTesting) return;

            let hasRelevantMutation = false;
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                const el = m.target && m.target.nodeType === 1 ? m.target : m.target?.parentElement;
                if (
                    el &&
                    el.closest &&
                    (el.closest(`.${WRAPPER_CLASS}`) ||
                        el.closest(`.${NUDGE_CLASS}`) ||
                        el.closest(`#${PROGRESS_ID}`))
                ) {
                    continue;
                }

                let isOwnNode = false;
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (
                        node.nodeType === 1 &&
                        (node.id === PROGRESS_ID ||
                            (node.classList &&
                                (node.classList.contains(WRAPPER_CLASS) ||
                                    node.classList.contains(NUDGE_CLASS))))
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
                debounceTimer = setTimeout(initCouponTester, 200);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    if (document.readyState === 'complete') {
        startWhenReady();
    } else {
        window.addEventListener('load', startWhenReady, { once: true });
    }
})();
