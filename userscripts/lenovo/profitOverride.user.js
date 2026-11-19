// ==UserScript==
// @name         Margin Price Override
// @namespace    https://www.lenovo.com/
// @version      0.0.2
// @description  Calculates and applies Telesales margin-based price overrides across regional stores
// @icon         https://www.google.com/s2/favicons?sz=64&domain=lenovo.com
// @match        https://www.lenovo.com/*/cart*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const BOX_CLASS = 'poc-calc-box';
    const STYLE_ID = 'poc-calc-styles';
    const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
    )?.set;

    const STORE_CONFIG = {
        AU: { taxRates: [1.10, 1.00], symbol: '$', decimals: 2 },
        NZ: { taxRates: [1.15, 1.00], symbol: '$', decimals: 2 },
        KR: { taxRates: [1.10, 1.00], symbol: '₩', decimals: 0 },
        PH: { taxRates: [1.12, 1.00], symbol: '₱', decimals: 2 },
        MY: { taxRates: [1.00, 1.06, 1.08], symbol: 'RM', decimals: 2 },
        SG: { taxRates: [1.09, 1.00], symbol: '$', decimals: 2 },
        TW: { taxRates: [1.05, 1.00], symbol: 'NT$', decimals: 0 },
        TH: { taxRates: [1.07, 1.00], symbol: '฿', decimals: 2 },
        HK: { taxRates: [1.00], symbol: 'HK$', decimals: 2 }
    };

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

    function getStoreConfig(telesalesEl) {
        const store = getStoreKey();
        const base = STORE_CONFIG[store] || { taxRates: [1.10, 1.00], symbol: '$', decimals: 2 };

        let decimals = base.decimals;
        if (telesalesEl) {
            const floorText = telesalesEl.querySelector('.floorPrice .value')?.textContent || '';
            if (/\.\d{2}\b/.test(floorText)) {
                decimals = 2;
            } else if (base.decimals === 0 && /\d/.test(floorText) && !/\.\d+/.test(floorText)) {
                decimals = 0;
            }
        }

        return {
            store,
            taxRates: base.taxRates,
            defaultTax: base.taxRates[0],
            symbol: base.symbol,
            decimals
        };
    }

    function roundTo(num, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.round((num + Number.EPSILON) * factor) / factor;
    }

    function floorTo(num, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.floor((num + 1e-9) * factor) / factor;
    }

    function ceilTo(num, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.ceil((num - 1e-9) * factor) / factor;
    }

    function round2(num) {
        return roundTo(num, 2);
    }

    function floor2(num) {
        return floorTo(num, 2);
    }

    function ceil2(num) {
        return ceilTo(num, 2);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${BOX_CLASS} {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                margin: 8px 0 0 0 !important;
                padding: 0 !important;
                border: none !important;
                background: transparent !important;
                font-size: 12px !important;
                line-height: 1 !important;
                color: #333 !important;
                box-sizing: border-box !important;
                min-height: 0 !important;
                height: auto !important;
            }
            .${BOX_CLASS}.poc-hidden {
                display: none !important;
            }
            .${BOX_CLASS} * {
                margin: 0 !important;
                box-sizing: border-box !important;
            }
            .${BOX_CLASS} .poc-label {
                font-weight: 600 !important;
                font-size: 12px !important;
                color: #333 !important;
                white-space: nowrap !important;
                line-height: 1 !important;
            }
            .${BOX_CLASS} .poc-input-wrap {
                position: relative !important;
                display: inline-flex !important;
                align-items: center !important;
                width: 68px !important;
                height: 22px !important;
            }
            .${BOX_CLASS} .poc-input {
                width: 100% !important;
                height: 22px !important;
                min-height: 22px !important;
                padding: 0 16px 0 6px !important;
                border: 1px solid #bbb !important;
                border-radius: 2px !important;
                font-size: 11px !important;
                line-height: 20px !important;
                color: #222 !important;
                background: #fff !important;
                -moz-appearance: textfield !important;
            }
            .${BOX_CLASS} .poc-input::-webkit-outer-spin-button,
            .${BOX_CLASS} .poc-input::-webkit-inner-spin-button {
                -webkit-appearance: none !important;
                margin: 0 !important;
            }
            .${BOX_CLASS} .poc-input:focus {
                outline: none !important;
                border-color: #294e95 !important;
            }
            .${BOX_CLASS} .poc-suffix {
                position: absolute !important;
                right: 5px !important;
                top: 50% !important;
                transform: translateY(-50%) !important;
                color: #666 !important;
                pointer-events: none !important;
                font-size: 11px !important;
                line-height: 1 !important;
            }
            .${BOX_CLASS} .poc-readout {
                display: inline-flex !important;
                align-items: center !important;
                gap: 5px !important;
                font-size: 12px !important;
                color: #444 !important;
                white-space: nowrap !important;
                line-height: 1 !important;
            }
            .${BOX_CLASS} .poc-val {
                font-weight: 700 !important;
                color: #111 !important;
            }
            .poc-toggle-trigger {
                cursor: pointer !important;
            }
        `;
        document.head.appendChild(style);
    }

    function parsePriceNumber(str) {
        if (!str) return NaN;
        const match = str.replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/);
        if (!match) return NaN;
        const num = parseFloat(match[0]);
        if (isNaN(num)) return NaN;
        const isNeg = str.includes('-') && num > 0;
        return isNeg ? -num : num;
    }

    function getItemQuantity(telesalesEl) {
        const itemRoot = telesalesEl.closest('.item, .product-item, li, tr') || telesalesEl.parentElement;
        if (!itemRoot) return 1;
        const qtyInput = itemRoot.querySelector(
            'input.qty, input[name="quantity"], .quantity input, select.qty, select[name="quantity"]'
        );
        if (qtyInput) {
            const q = parseInt(qtyInput.value, 10);
            if (q > 0) return q;
        }
        return 1;
    }

    function extractLineTotal(telesalesEl) {
        const directEl = telesalesEl.querySelector('.lineTotal .value');
        if (directEl) {
            const val = parsePriceNumber(directEl.textContent);
            if (!isNaN(val) && val > 0) return val;
        }

        const titles = telesalesEl.querySelectorAll('.title');
        for (let i = 0; i < titles.length; i++) {
            if (/line\s*total/i.test(titles[i].textContent)) {
                const valEl = titles[i].parentElement?.querySelector('.value');
                const val = parsePriceNumber(valEl?.textContent);
                if (!isNaN(val) && val > 0) return val;
            }
        }

        const itemRoot = telesalesEl.closest('.item, .product-item, li, tr');
        if (itemRoot) {
            const priceEl = itemRoot.querySelector('.finalPrice .value, .yourPrice .value, .salePrice .value');
            const val = parsePriceNumber(priceEl?.textContent);
            if (!isNaN(val) && val > 0) return val;
        }

        return NaN;
    }

    function extractTelesalesMetrics(telesalesEl) {
        const floorPrice = parsePriceNumber(telesalesEl.querySelector('.floorPrice .value')?.textContent);

        const profitValEl = telesalesEl.querySelector('.lineProfit .value');
        const rawProfitText = profitValEl ? profitValEl.textContent.trim() : '';

        let lineProfitPct = NaN;
        let lineProfitPctStr = '';
        const pctMatch = rawProfitText.match(/\(\s*([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*%\s*\)/);
        if (pctMatch) {
            lineProfitPctStr = pctMatch[1].replace(/,/g, '');
            lineProfitPct = parseFloat(lineProfitPctStr);
        } else {
            const bText = profitValEl?.querySelector('b')?.textContent || '';
            const fallbackMatch = bText.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
            if (fallbackMatch) {
                lineProfitPctStr = fallbackMatch[1];
                lineProfitPct = parseFloat(lineProfitPctStr);
            }
        }

        const dollarPart = rawProfitText.replace(/\([^)]*\)/g, '').trim();
        const lineProfitDollar = parsePriceNumber(dollarPart);
        const lineTotal = extractLineTotal(telesalesEl);
        const quantity = getItemQuantity(telesalesEl);
        const storeConfig = getStoreConfig(telesalesEl);

        return {
            floorPrice,
            lineProfitDollar,
            lineProfitPct,
            lineProfitPctStr,
            lineTotal,
            quantity,
            storeConfig
        };
    }

    function resolveCostModel(metrics) {
        const { floorPrice, lineProfitDollar, lineProfitPct, lineTotal, quantity, storeConfig } = metrics;
        const { taxRates, defaultTax, decimals } = storeConfig || getStoreConfig(null);
        const qty = quantity > 0 ? quantity : 1;

        const unitProfit = !isNaN(lineProfitDollar) ? lineProfitDollar / qty : NaN;
        const unitTotal = !isNaN(lineTotal) && lineTotal > 0 ? lineTotal / qty : NaN;

        if (!isNaN(unitProfit)) {
            const candidates = [];

            if (!isNaN(unitTotal) && unitTotal > 0) {
                for (let t = 0; t < taxRates.length; t++) {
                    const rate = taxRates[t];
                    const rawExTax = unitTotal / rate;
                    candidates.push(
                        { r: floorTo(rawExTax, decimals), taxRate: rate, isFloor: true },
                        { r: roundTo(rawExTax, decimals), taxRate: rate, isFloor: false },
                        { r: ceilTo(rawExTax, decimals), taxRate: rate, isFloor: false }
                    );
                    if (decimals === 0) {
                        candidates.push(
                            { r: floor2(rawExTax), taxRate: rate, isFloor: true },
                            { r: round2(rawExTax), taxRate: rate, isFloor: false }
                        );
                    }
                }
            } else if (!isNaN(lineProfitPct) && lineProfitPct !== 0) {
                const rFromPct = roundTo(unitProfit / (lineProfitPct / 100), decimals);
                if (rFromPct > 0) {
                    candidates.push({ r: rFromPct, taxRate: defaultTax, isFloor: true });
                }
            }

            if (candidates.length > 0) {
                let best = candidates[0];
                if (!isNaN(lineProfitPct)) {
                    let minDiff = Infinity;
                    for (let i = 0; i < candidates.length; i++) {
                        const c = candidates[i];
                        if (c.r <= 0) continue;
                        const calcPct = round2((unitProfit / c.r) * 100);
                        const diff = Math.abs(calcPct - lineProfitPct);
                        if (diff < minDiff) {
                            minDiff = diff;
                            best = c;
                        }
                    }
                }
                const unitCostExTax = roundTo(best.r - unitProfit, Math.max(decimals, 2));
                if (unitCostExTax > 0) {
                    return {
                        unitCostExTax,
                        taxRate: best.taxRate,
                        useFloorTax: best.isFloor,
                        decimals
                    };
                }
            }
        }

        if (!isNaN(floorPrice) && floorPrice > 0) {
            return {
                unitCostExTax: floorPrice / defaultTax,
                taxRate: defaultTax,
                useFloorTax: false,
                decimals
            };
        }

        return null;
    }

    function calculateOverridePrice(metrics, desiredProfitPct) {
        if (isNaN(desiredProfitPct) || desiredProfitPct >= 100) return NaN;
        const ratio = 1 - desiredProfitPct / 100;
        if (ratio <= 0) return NaN;

        const model = resolveCostModel(metrics);
        if (!model) return NaN;

        const { unitCostExTax, taxRate, useFloorTax, decimals } = model;
        const targetExTax = unitCostExTax / ratio;
        const rawTargetIncTax = targetExTax * taxRate;

        if (rawTargetIncTax <= 0) return NaN;

        const candidates = [
            floorTo(rawTargetIncTax, decimals),
            roundTo(rawTargetIncTax, decimals),
            ceilTo(rawTargetIncTax, decimals)
        ];

        let bestPrice = roundTo(rawTargetIncTax, decimals);
        let minPctError = Infinity;

        for (let i = 0; i < candidates.length; i++) {
            const p = candidates[i];
            if (p <= 0) continue;
            const r = useFloorTax ? floorTo(p / taxRate, decimals) : roundTo(p / taxRate, decimals);
            if (r <= 0) continue;
            const achievedPct = ((r - unitCostExTax) / r) * 100;
            const err = Math.abs(achievedPct - desiredProfitPct);
            if (err < minPctError) {
                minPctError = err;
                bestPrice = p;
            }
        }

        return bestPrice;
    }

    function formatStorePrice(price, storeConfig) {
        const { decimals } = storeConfig || { decimals: 2 };
        return decimals === 0 ? Math.round(price).toString() : price.toFixed(decimals);
    }

    function setNativeInputValue(input, value) {
        if (!input) return;
        if (NATIVE_VALUE_SETTER) {
            NATIVE_VALUE_SETTER.call(input, value);
        } else {
            input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function selectCategoryOther(telesalesEl) {
        const categoryEl = telesalesEl.querySelector('.category');
        if (!categoryEl) return;

        const selectEl = categoryEl.querySelector('select');
        if (selectEl && selectEl.options.length > 0) {
            const opts = Array.from(selectEl.options);
            const otherOpt =
                opts.find((o) => o.text.trim().toLowerCase() === 'other' || o.value.toLowerCase() === 'other') ||
                opts[opts.length - 1];
            if (otherOpt) {
                selectEl.value = otherOpt.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        const valueEl = categoryEl.querySelector('.value');
        if (valueEl) {
            valueEl.click();
        }

        const items = Array.from(categoryEl.querySelectorAll('.categoryList .item'));
        const itemNodes =
            items.length > 0
                ? items
                : Array.from(categoryEl.querySelectorAll('.categoryList > div, .categoryList li'));

        if (itemNodes.length === 0) return;

        const targetItem =
            itemNodes.find((item) => {
                const labelDiv = item.querySelector('div[aria-label]');
                const aria = labelDiv ? labelDiv.getAttribute('aria-label') : item.getAttribute('aria-label');
                const text = (aria || item.textContent || '').trim().toLowerCase();
                return text === 'other';
            }) || itemNodes[itemNodes.length - 1];

        const targetDiv = targetItem.querySelector('div[aria-label], div') || targetItem;
        const chosenLabel =
            targetDiv.getAttribute('aria-label') ||
            targetItem.getAttribute('aria-label') ||
            targetDiv.textContent.trim();

        targetDiv.click();
        if (targetDiv !== targetItem && valueEl && valueEl.textContent.trim() !== chosenLabel) {
            targetItem.click();
        }

        if (valueEl && chosenLabel && valueEl.textContent.trim() !== chosenLabel) {
            valueEl.textContent = chosenLabel;
            valueEl.setAttribute('aria-label', chosenLabel);
        }
    }

    function applyOverride(telesalesEl, calculatedPrice) {
        if (isNaN(calculatedPrice) || calculatedPrice <= 0) return;

        const storeConfig = getStoreConfig(telesalesEl);
        const formattedPrice = formatStorePrice(calculatedPrice, storeConfig);
        const overrideInput = telesalesEl.querySelector('input[name="priceOverride"]');
        const reasonInput = telesalesEl.querySelector('input[name="teleReason"]');

        setNativeInputValue(overrideInput, formattedPrice);
        setNativeInputValue(reasonInput, 'AD');
        selectCategoryOther(telesalesEl);

        const priceOverrideBlock = telesalesEl.querySelector('.priceOverride');
        const updateBtn =
            telesalesEl.querySelector('button[aria-label="Update"]') ||
            Array.from(telesalesEl.querySelectorAll('button')).find(
                (btn) => btn.textContent.trim().toLowerCase() === 'update'
            ) ||
            (priceOverrideBlock && priceOverrideBlock.closest('.flex')?.querySelector('button'));

        if (updateBtn) {
            setTimeout(() => {
                updateBtn.click();
            }, 50);
        }
    }

    function toggleBoxVisibility(box, forceState) {
        const shouldHide =
            typeof forceState === 'boolean' ? !forceState : !box.classList.contains('poc-hidden');
        box.classList.toggle('poc-hidden', shouldHide);
        if (!shouldHide && typeof box._refresh === 'function') {
            box._refresh();
        }
    }

    function bindToggleTriggers(telesalesEl, box) {
        const triggers = telesalesEl.querySelectorAll('.floorPrice, .lineProfit, .priceOverride .title');
        for (let i = 0; i < triggers.length; i++) {
            const el = triggers[i];
            if (el.dataset.pocBound) continue;
            el.dataset.pocBound = '1';
            el.classList.add('poc-toggle-trigger');
            el.title = 'Click to toggle Price Override Calculator';
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleBoxVisibility(box);
            });
        }
    }

    function createCalcBox(telesalesEl) {
        const box = document.createElement('div');
        box.className = `${BOX_CLASS} poc-hidden`;

        const initialConfig = getStoreConfig(telesalesEl);

        box.innerHTML = `
            <span class="poc-label">[${initialConfig.store}] Desired Profit:</span>
            <div class="poc-input-wrap">
                <input type="number" step="0.01" class="poc-input" placeholder="0.00" aria-label="Desired Line Profit Percentage">
                <span class="poc-suffix">%</span>
            </div>
            <span class="poc-readout">
                <span>→</span>
                <span class="poc-val poc-price-display">${initialConfig.symbol}—</span>
            </span>
        `;

        const inputEl = box.querySelector('.poc-input');
        const priceDisplay = box.querySelector('.poc-price-display');

        function refreshCalculation() {
            const metrics = extractTelesalesMetrics(telesalesEl);
            const { symbol } = metrics.storeConfig;
            if (metrics.lineProfitPctStr && inputEl.placeholder !== metrics.lineProfitPctStr) {
                inputEl.placeholder = metrics.lineProfitPctStr;
            }

            const rawVal = inputEl.value.trim();
            if (rawVal === '') {
                priceDisplay.textContent = `${symbol}—`;
                return;
            }

            const desiredPct = parseFloat(rawVal);
            const calcPrice = calculateOverridePrice(metrics, desiredPct);
            priceDisplay.textContent = isNaN(calcPrice)
                ? `${symbol}—`
                : `${symbol}${formatStorePrice(calcPrice, metrics.storeConfig)}`;
        }

        inputEl.addEventListener('focus', refreshCalculation);
        inputEl.addEventListener('input', refreshCalculation);

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const metrics = extractTelesalesMetrics(telesalesEl);
                const desiredPct = parseFloat(inputEl.value.trim());
                const calcPrice = calculateOverridePrice(metrics, desiredPct);
                if (!isNaN(calcPrice) && calcPrice > 0) {
                    applyOverride(telesalesEl, calcPrice);
                }
            }
        });

        box._refresh = refreshCalculation;
        refreshCalculation();

        return box;
    }

    function hasLoadedTelesalesData(telesalesEl) {
        const metrics = extractTelesalesMetrics(telesalesEl);
        return !isNaN(metrics.lineProfitDollar) || (!isNaN(metrics.floorPrice) && metrics.floorPrice > 0);
    }

    function updateAllItems() {
        const telesalesBlocks = document.querySelectorAll('.productTelesales');
        if (telesalesBlocks.length === 0) return false;

        injectStyles();
        let allReady = true;

        for (let i = 0; i < telesalesBlocks.length; i++) {
            const telesalesEl = telesalesBlocks[i];
            if (!hasLoadedTelesalesData(telesalesEl)) {
                allReady = false;
                continue;
            }

            const priceOverrideEl = telesalesEl.querySelector('.priceOverride');
            const targetFlex = priceOverrideEl ? priceOverrideEl.closest('.flex') : null;
            if (!targetFlex || !targetFlex.parentNode) continue;

            let box = telesalesEl.querySelector(`.${BOX_CLASS}`);
            if (!box) {
                box = createCalcBox(telesalesEl);
                targetFlex.parentNode.insertBefore(box, targetFlex);
            } else if (!box.classList.contains('poc-hidden') && typeof box._refresh === 'function') {
                box._refresh();
            }

            bindToggleTriggers(telesalesEl, box);
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

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            let hasRelevantMutation = false;
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                const targetEl = m.target?.nodeType === 1 ? m.target : m.target?.parentElement;
                if (targetEl?.closest?.(`.${BOX_CLASS}`)) continue;

                let isOwnBox = false;
                for (let j = 0; j < m.addedNodes.length; j++) {
                    const node = m.addedNodes[j];
                    if (node.nodeType === 1 && node.classList?.contains(BOX_CLASS)) {
                        isOwnBox = true;
                        break;
                    }
                }
                if (!isOwnBox) {
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

    if (document.readyState === 'complete') {
        startWhenDataReady();
    } else {
        window.addEventListener('load', startWhenDataReady, { once: true });
    }
})();
