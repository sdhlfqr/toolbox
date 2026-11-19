// ==UserScript==
// @name         Zara Catalog & Material Explorer
// @namespace    https://www.zara.com/
// @version      3.3.0
// @description  Supercharged Zara product explorer. Filter by fabric, composition %, color model, size, discount, price, fit. Includes Outfit Builder Cart & cross-colorway image synchronization.
// @match        https://www.zara.com/*
// @icon         https://www.zara.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(async () => {
    "use strict";

    // Prevent duplicate injection
    if (document.getElementById("zpe-root")) {
        console.log("[Zara Explorer] Already injected. Re-opening...");
        const existingPanel = document.getElementById("zpe-panel");
        const existingTab = document.getElementById("zpe-minimized-tab");
        if (existingPanel) existingPanel.style.display = "flex";
        if (existingTab) existingTab.style.display = "none";
        return;
    }

    /* ==========================================================================
       CONFIGURATION & CONSTANTS
       ========================================================================== */
    const DEFAULT_CATEGORY_ID = 2443335; // Man All Products
    const CONCURRENCY = 8;
    const CHUNK_SIZE = 36; // Number of cards rendered per lazy scroll batch
    const DB_NAME = "ZaraExplorerCache_v5";
    const CACHE_TTL_MATERIALS_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for compositions
    const CACHE_TTL_CATEGORY_MS = 2 * 60 * 60 * 1000;       // 2 hours for category products
    const CACHE_TTL_TREE_MS = 24 * 60 * 60 * 1000;          // 24 hours for category navigation tree

    /* ==========================================================================
       URL & ROUTE DETECTION
       ========================================================================== */
    const detectBasePath = () => {
        const match = window.location.pathname.match(/^\/([a-z]{2}\/[a-z]{2})\b/i);
        return match ? `https://www.zara.com/${match[1]}` : "https://www.zara.com/eg/en";
    };

    const detectCategoryId = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const v1 = urlParams.get("v1") || urlParams.get("v2");
        if (v1 && /^\d+$/.test(v1)) return Number(v1);

        const pathMatch = window.location.pathname.match(/\/category\/(\d+)/i);
        if (pathMatch) return Number(pathMatch[1]);

        return DEFAULT_CATEGORY_ID;
    };

    const detectCategorySeoId = () => {
        const seoMatch = window.location.pathname.match(/-l(\d+)\.html/i);
        return seoMatch ? Number(seoMatch[1]) : null;
    };

    /* ==========================================================================
       PERSISTENT INDEXEDDB MULTI-TIER CACHE
       ========================================================================== */
    class IndexedDbCache {
        constructor() {
            this.db = null;
            this.ready = this.init();
        }

        async init() {
            if (!window.indexedDB) return;
            return new Promise((resolve) => {
                try {
                    const req = indexedDB.open(DB_NAME, 1);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains("product_materials")) {
                            db.createObjectStore("product_materials", { keyPath: "id" });
                        }
                        if (!db.objectStoreNames.contains("category_products")) {
                            db.createObjectStore("category_products", { keyPath: "categoryId" });
                        }
                        if (!db.objectStoreNames.contains("category_tree")) {
                            db.createObjectStore("category_tree", { keyPath: "storeKey" });
                        }
                    };
                    req.onsuccess = () => {
                        this.db = req.result;
                        resolve();
                    };
                    req.onerror = () => resolve();
                } catch {
                    resolve();
                }
            });
        }

        async get(storeName, key) {
            await this.ready;
            if (!this.db) return null;
            return new Promise((resolve) => {
                try {
                    const tx = this.db.transaction(storeName, "readonly");
                    const store = tx.objectStore(storeName);
                    const req = store.get(key);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                } catch {
                    resolve(null);
                }
            });
        }

        async set(storeName, value) {
            await this.ready;
            if (!this.db) return;
            try {
                const tx = this.db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                store.put({ ...value, savedAt: Date.now() });
            } catch (err) {
                console.warn(`[Zara Explorer] Cache set failed in ${storeName}:`, err);
            }
        }

        async clearAll() {
            await this.ready;
            if (!this.db) return;
            try {
                const stores = ["product_materials", "category_products", "category_tree"];
                const tx = this.db.transaction(stores, "readwrite");
                for (const s of stores) {
                    tx.objectStore(s).clear();
                }
            } catch (err) {
                console.warn("[Zara Explorer] Cache clear failed:", err);
            }
        }
    }

    const cache = new IndexedDbCache();

    /* ==========================================================================
       APPLICATION STATE
       ========================================================================== */
    const loadStoredCart = () => {
        try {
            const rawCart = localStorage.getItem("zpe_cart");
            if (rawCart) {
                const parsed = JSON.parse(rawCart);
                if (parsed && Array.isArray(parsed.outfits) && parsed.outfits.length > 0) {
                    parsed.outfits = parsed.outfits.map((o, idx) => ({
                        id: o.id || `outfit-${idx + 1}-${Date.now()}`,
                        name: o.name || `Outfit ${idx + 1}`,
                        items: Array.isArray(o.items) ? o.items : []
                    }));
                    if (!parsed.outfits.some((o) => o.id === parsed.activeOutfitId)) {
                        parsed.activeOutfitId = parsed.outfits[0].id;
                    }
                    return parsed;
                }
            }
            // Migrate legacy zpe_outfit if exists
            const legacyOutfit = JSON.parse(localStorage.getItem("zpe_outfit") || "[]");
            if (Array.isArray(legacyOutfit) && legacyOutfit.length > 0) {
                return {
                    activeOutfitId: "outfit-1",
                    outfits: [
                        {
                            id: "outfit-1",
                            name: "Outfit 1",
                            items: legacyOutfit
                        }
                    ]
                };
            }
        } catch (e) {
            console.warn("[Zara Explorer] Cart load error:", e);
        }
        return {
            activeOutfitId: "outfit-1",
            outfits: [
                {
                    id: "outfit-1",
                    name: "Outfit 1",
                    items: []
                }
            ]
        };
    };

    const state = {
        baseUrl: detectBasePath(),
        categoryId: detectCategoryId(),
        categorySeoId: detectCategorySeoId(),
        sections: [],
        allProducts: [],
        filteredProducts: [],
        cart: loadStoredCart(),
        isOutfitOpen: false,
        renderedCount: 0,
        isScanning: false,
        scannedCount: 0,
        totalCount: 0,
        isFromCache: false,
        abortController: null,
        viewMode: localStorage.getItem("zpe_view_mode") || "drawer", // "drawer" | "fullscreen"
        isMinimized: localStorage.getItem("zpe_minimized") === "true",
        drawerWidth: Number(localStorage.getItem("zpe_drawer_width")) || 540,
        naturalFibers: new Set(["cotton", "linen", "wool", "silk", "cashmere", "alpaca", "mohair", "leather"]),
        syntheticFibers: new Set(["polyester", "polyamide", "elastane", "acrylic", "polyurethane"]),
        knownMaterials: new Set([
            "cotton",
            "linen",
            "wool",
            "viscose",
            "lyocell",
            "polyester",
            "polyamide",
            "elastane",
            "leather",
            "silk",
            "cashmere",
            "acrylic",
            "modal",
            "alpaca",
            "mohair",
            "cupro"
        ]),
        filters: {
            query: "",
            color: "ALL",
            material: "ALL",
            minMaterialPct: 0,
            fabricType: "ALL", // "ALL" | "natural_only" | "pure_only" | "natural_blend"
            family: "ALL",
            subfamily: "ALL",
            size: "ALL",
            discount: "ALL", // "ALL" | "on_sale" | "discount_30" | "discount_50"
            availability: "ALL",
            minPrice: "",
            maxPrice: "",
            sortBy: "material-desc"
        }
    };

    // Backward compatibility: state.outfit mirrors active outfit items
    Object.defineProperty(state, "outfit", {
        get() {
            const active = state.cart.outfits.find((o) => o.id === state.cart.activeOutfitId) || state.cart.outfits[0];
            return active ? active.items : [];
        },
        set(newItems) {
            const active = state.cart.outfits.find((o) => o.id === state.cart.activeOutfitId) || state.cart.outfits[0];
            if (active) active.items = newItems;
        }
    });

    const getActiveOutfit = () => {
        let active = state.cart.outfits.find((o) => o.id === state.cart.activeOutfitId);
        if (!active) {
            if (state.cart.outfits.length === 0) {
                active = { id: `outfit-${Date.now()}`, name: "Outfit 1", items: [] };
                state.cart.outfits.push(active);
            } else {
                active = state.cart.outfits[0];
            }
            state.cart.activeOutfitId = active.id;
        }
        return active;
    };

    const getTotalCartItemsCount = () => {
        return state.cart.outfits.reduce((sum, o) => sum + (o.items?.length || 0), 0);
    };

    const getTotalCartPrice = () => {
        return state.cart.outfits.reduce((sum, o) => {
            const outfitSum = (o.items || []).reduce((acc, item) => acc + (Number(item.price) || 0), 0);
            return sum + outfitSum;
        }, 0);
    };

    window.zaraExplorer = state;
    window.zaraProducts = [];

    /* ==========================================================================
       UI STYLESHEET (Clean Luxury Minimalist Theme)
       ========================================================================== */
    const style = document.createElement("style");
    style.id = "zpe-styles";
    style.textContent = `
        #zpe-root {
            --zpe-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            --zpe-bg: #ffffff;
            --zpe-surface: #f9f9f9;
            --zpe-border: #e6e6e6;
            --zpe-text: #111111;
            --zpe-text-muted: #666666;
            --zpe-primary: #111111;
            --zpe-pure-green: #0b6832;
            --zpe-sale-red: #c91818;
            --zpe-gold: #c29547;
            --zpe-shadow: 0 16px 40px rgba(0, 0, 0, 0.22);
            font-family: var(--zpe-font);
            color: var(--zpe-text);
            z-index: 2147483640;
            position: fixed;
            pointer-events: none;
            inset: 0;
        }

        /* Minimized Tab on the Right Side */
        #zpe-minimized-tab {
            pointer-events: auto;
            position: fixed;
            right: 0;
            top: 42%;
            transform: translateY(-50%);
            background: #111111;
            color: #ffffff;
            padding: 12px 10px;
            border-radius: 8px 0 0 8px;
            box-shadow: -4px 4px 20px rgba(0, 0, 0, 0.3);
            border: 1px solid #333333;
            border-right: none;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), background 0.15s;
            user-select: none;
            z-index: 2147483645;
        }
        #zpe-minimized-tab:hover {
            transform: translateY(-50%) translateX(-4px);
            background: #1f1f1f;
        }
        .zpe-tab-icon {
            font-size: 16px;
            line-height: 1;
        }
        .zpe-tab-text {
            writing-mode: vertical-rl;
            text-orientation: mixed;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            white-space: nowrap;
        }
        .zpe-tab-badge {
            background: #ffffff;
            color: #111111;
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 10px;
            margin-top: 4px;
        }
        .zpe-tab-pulse {
            width: 8px;
            height: 8px;
            background: #10b981;
            border-radius: 50%;
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
            animation: zpe-pulse 1.8s infinite;
        }
        @keyframes zpe-pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }

        /* Main Panel Container */
        #zpe-panel {
            pointer-events: auto;
            position: fixed;
            background: #ffffff;
            display: flex;
            flex-direction: column;
            box-shadow: var(--zpe-shadow);
            border: 1px solid #222222;
            overflow: hidden;
            transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 2147483642;
        }

        /* Drawer Mode (Pinned to Right Side) */
        #zpe-panel.zpe-mode-drawer {
            top: 0;
            right: 0;
            bottom: 0;
            height: 100vh;
            width: 540px;
            max-width: 96vw;
            border-right: none;
            border-top: none;
            border-bottom: none;
        }

        /* Fullscreen Mode */
        #zpe-panel.zpe-mode-fullscreen {
            top: 16px;
            right: 16px;
            bottom: 16px;
            left: 16px;
            max-width: 1540px;
            margin: 0 auto;
            border-radius: 8px;
        }

        /* Resize Handle for Drawer Mode */
        #zpe-resize-handle {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 6px;
            cursor: ew-resize;
            background: transparent;
            z-index: 10;
        }
        #zpe-resize-handle:hover,
        #zpe-resize-handle.active {
            background: rgba(0, 0, 0, 0.25);
        }

        /* Header */
        #zpe-header {
            background: #111111;
            color: #ffffff;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            border-bottom: 1px solid #2a2a2a;
        }
        .zpe-header-title-box {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .zpe-brand {
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            margin: 0;
            white-space: nowrap;
        }
        .zpe-badge-status {
            font-size: 10px;
            background: #262626;
            color: #e5e5e5;
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid #3a3a3a;
            white-space: nowrap;
        }
        .zpe-badge-cached {
            font-size: 9px;
            background: #0b6832;
            color: #ffffff;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }

        .zpe-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .zpe-icon-btn {
            background: #222222;
            color: #ffffff;
            border: 1px solid #444444;
            height: 28px;
            padding: 0 10px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            border-radius: 3px;
            transition: background 0.12s;
        }
        .zpe-icon-btn:hover {
            background: #383838;
            border-color: #666;
        }
        .zpe-icon-btn-highlight {
            background: #ffffff;
            color: #111111;
            border-color: #ffffff;
        }
        .zpe-icon-btn-highlight:hover {
            background: #e5e5e5;
        }
        .zpe-btn-outfit-toggle {
            background: #222222;
            color: #ffffff;
            border-color: #444444;
            font-weight: 600;
        }
        .zpe-btn-outfit-toggle:hover {
            background: #333333;
            border-color: #666666;
        }

        /* Progress Bar */
        #zpe-progress-wrap {
            height: 3px;
            background: #e5e5e5;
            width: 100%;
        }
        #zpe-progress-bar {
            height: 100%;
            background: #111111;
            width: 0%;
            transition: width 0.15s ease;
        }

        /* Category Picker Toolbar */
        #zpe-catalog-bar {
            background: #f7f7f7;
            padding: 8px 16px;
            border-bottom: 1px solid var(--zpe-border);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .zpe-catalog-item {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 11px;
            font-weight: 600;
            color: #444444;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .zpe-catalog-item select,
        .zpe-catalog-item input {
            height: 28px;
            padding: 0 8px;
            font-size: 11px;
            border: 1px solid #cccccc;
            background: #ffffff;
            color: #111111;
            border-radius: 3px;
            outline: none;
        }
        .zpe-catalog-item select:focus,
        .zpe-catalog-item input:focus {
            border-color: #111111;
        }

        /* Filter Controls */
        #zpe-filter-bar {
            padding: 10px 16px;
            background: #fafafa;
            border-bottom: 1px solid var(--zpe-border);
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
            gap: 8px;
            align-items: end;
        }
        .zpe-field {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .zpe-field label {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #555555;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .zpe-field input,
        .zpe-field select {
            height: 30px;
            padding: 0 8px;
            font-size: 11px;
            border: 1px solid #cccccc;
            background: #ffffff;
            color: #111111;
            border-radius: 3px;
            outline: none;
            width: 100%;
            box-sizing: border-box;
        }
        .zpe-field input:focus,
        .zpe-field select:focus {
            border-color: #111111;
        }
        .zpe-price-inputs {
            display: flex;
            gap: 4px;
        }

        /* Product Grid Container */
        #zpe-grid-wrap {
            flex: 1;
            overflow-y: auto;
            padding: 14px;
            background: #fbfbfb;
            display: flex;
            flex-direction: column;
            position: relative;
        }
        #zpe-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 14px;
            align-content: start;
        }
        .zpe-mode-drawer #zpe-grid {
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        }

        /* Product Card */
        .zpe-card {
            background: #ffffff;
            border: 1px solid #e5e5e5;
            display: flex;
            flex-direction: column;
            transition: border-color 0.12s, box-shadow 0.12s;
            position: relative;
        }
        .zpe-card:hover {
            border-color: #111111;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
        }
        .zpe-card-img-wrap {
            position: relative;
            width: 100%;
            aspect-ratio: 3 / 4;
            background: #f0f0f0;
            overflow: hidden;
            display: block;
        }
        .zpe-card-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            transition: transform 0.25s ease, opacity 0.2s ease;
        }
        .zpe-card:hover .zpe-card-img {
            transform: scale(1.02);
        }
        .zpe-badge-mat {
            position: absolute;
            top: 6px;
            left: 6px;
            background: rgba(17, 17, 17, 0.9);
            color: #ffffff;
            padding: 3px 6px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            max-width: calc(100% - 16px);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border-radius: 2px;
        }
        .zpe-badge-mat.pure {
            background: var(--zpe-pure-green);
        }
        .zpe-badge-discount {
            position: absolute;
            top: 6px;
            right: 6px;
            background: var(--zpe-sale-red);
            color: #ffffff;
            padding: 3px 6px;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.05em;
            border-radius: 2px;
        }
        .zpe-badge-stock {
            position: absolute;
            bottom: 6px;
            right: 6px;
            background: rgba(255, 255, 255, 0.92);
            color: #111111;
            border: 1px solid #cccccc;
            padding: 2px 5px;
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
            border-radius: 2px;
        }

        .zpe-card-body {
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 5px;
            flex: 1;
        }
        .zpe-card-meta {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 6px;
            font-size: 9px;
            color: #777777;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .zpe-card-active-color {
            font-weight: 700;
            color: #111111;
            background: #f0f0f0;
            padding: 1px 5px;
            border-radius: 2px;
            letter-spacing: 0.04em;
        }
        .zpe-card-title {
            font-size: 11px;
            font-weight: 700;
            color: #111111;
            text-decoration: none;
            line-height: 1.3;
        }
        .zpe-card-title:hover {
            text-decoration: underline;
        }
        .zpe-price-row {
            display: flex;
            align-items: baseline;
            gap: 6px;
        }
        .zpe-card-price {
            font-size: 12px;
            font-weight: 800;
            color: #111111;
        }
        .zpe-card-old-price {
            font-size: 10px;
            font-weight: 600;
            color: #888888;
            text-decoration: line-through;
        }

        /* Available In-Stock Sizes */
        .zpe-card-sizes {
            display: flex;
            align-items: center;
            gap: 3px;
            flex-wrap: wrap;
            font-size: 8px;
            color: #555555;
            font-weight: 700;
            text-transform: uppercase;
        }
        .zpe-card-sizes span {
            background: #f0f0f0;
            padding: 1px 4px;
            border-radius: 2px;
        }

        /* Interactive Color Swatches */
        .zpe-swatches {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-top: 3px;
        }
        .zpe-swatch-btn {
            background: #f5f5f5;
            border: 1px solid #dddddd;
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 9px;
            font-weight: 600;
            color: #444444;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            transition: all 0.12s ease;
            user-select: none;
        }
        .zpe-swatch-btn:hover {
            border-color: #111111;
            background: #ebebeb;
            color: #111111;
        }
        .zpe-swatch-btn.selected {
            border: 1px solid #111111;
            background: #111111;
            color: #ffffff;
            font-weight: 700;
        }
        .zpe-swatch-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            border: 1px solid rgba(0, 0, 0, 0.25);
            display: inline-block;
            flex-shrink: 0;
        }
        .zpe-swatch-btn.selected .zpe-swatch-dot {
            border-color: #ffffff;
        }

        .zpe-card-materials {
            margin-top: 3px;
            padding: 6px 7px;
            background: #f8f8f8;
            border-left: 2px solid #111111;
            font-size: 10px;
            line-height: 1.35;
            color: #222222;
            max-height: 72px;
            overflow-y: auto;
            white-space: pre-line;
        }
        .zpe-card-footer {
            margin-top: auto;
            padding-top: 6px;
            display: flex;
            gap: 5px;
        }
        .zpe-link-btn {
            flex: 1;
            text-align: center;
            background: #111111;
            color: #ffffff;
            text-decoration: none;
            padding: 6px 8px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            border-radius: 2px;
        }
        .zpe-link-btn:hover {
            background: #333333;
        }
        .zpe-btn-add-outfit {
            background: #f4f4f4;
            color: #111111;
            border: 1px solid #d5d5d5;
            width: 30px;
            height: 27px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            font-weight: 700;
            border-radius: 2px;
            cursor: pointer;
            transition: all 0.12s ease;
            flex-shrink: 0;
            line-height: 1;
        }
        .zpe-btn-add-outfit:hover {
            background: #111111;
            color: #ffffff;
            border-color: #111111;
        }
        .zpe-btn-add-outfit.added {
            background: #0b6832;
            color: #ffffff;
            border-color: #0b6832;
        }

        /* ======================================================================
           OUTFITS CART DRAWER (Clean Luxury Minimalist Theme)
           ====================================================================== */
        #zpe-outfit-drawer {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 380px;
            max-width: 100%;
            background: #ffffff;
            border-left: 1px solid #e0e0e0;
            box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
            z-index: 100;
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
            transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        #zpe-outfit-drawer.open {
            transform: translateX(0);
        }
        .zpe-cart-header {
            background: #ffffff;
            color: #111111;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid #ebebeb;
        }
        .zpe-cart-header-title {
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Cart Tabs Bar (Multiple Outfits) */
        .zpe-cart-tabs-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: #ffffff;
            border-bottom: 1px solid #f0f0f0;
            overflow-x: auto;
            white-space: nowrap;
            scrollbar-width: none;
        }
        .zpe-cart-tabs-bar::-webkit-scrollbar {
            display: none;
        }
        .zpe-cart-tab {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: #f7f7f7;
            border: 1px solid #e5e5e5;
            border-radius: 14px;
            font-size: 11px;
            font-weight: 600;
            color: #555555;
            cursor: pointer;
            transition: all 0.12s ease;
            user-select: none;
            flex-shrink: 0;
        }
        .zpe-cart-tab:hover {
            border-color: #111111;
            color: #111111;
        }
        .zpe-cart-tab.active {
            background: #111111;
            color: #ffffff;
            border-color: #111111;
            font-weight: 700;
        }
        .zpe-cart-tab-count {
            font-size: 10px;
            opacity: 0.75;
        }
        .zpe-cart-tab-add {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            background: #ffffff;
            border: 1px dashed #aaaaaa;
            border-radius: 50%;
            font-size: 14px;
            font-weight: 700;
            color: #555555;
            cursor: pointer;
            transition: all 0.12s ease;
            flex-shrink: 0;
            line-height: 1;
            padding: 0;
        }
        .zpe-cart-tab-add:hover {
            border-color: #111111;
            color: #111111;
            background: #f0f0f0;
        }

        /* Active Outfit Sub-Header & Controls */
        .zpe-active-outfit-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background: #ffffff;
            border-bottom: 1px solid #f0f0f0;
        }
        .zpe-active-outfit-name-box {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            font-weight: 700;
            color: #111111;
            cursor: pointer;
        }
        .zpe-active-outfit-name {
            border-bottom: 1px dashed transparent;
        }
        .zpe-active-outfit-name-box:hover .zpe-active-outfit-name {
            border-bottom-color: #111111;
        }
        .zpe-btn-icon-subtle {
            background: transparent;
            border: none;
            color: #888888;
            cursor: pointer;
            padding: 3px 6px;
            font-size: 13px;
            border-radius: 3px;
            transition: all 0.1s;
        }
        .zpe-btn-icon-subtle:hover {
            color: #c91818;
            background: #f7f7f7;
        }

        /* Outfit Items Body List */
        .zpe-outfit-body {
            flex: 1;
            overflow-y: auto;
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            background: #ffffff;
        }
        .zpe-outfit-empty {
            text-align: center;
            padding: 50px 16px;
            color: #999999;
            font-size: 12px;
            line-height: 1.6;
        }

        /* Individual Item Card with Drag Reorder Handle */
        .zpe-outfit-item {
            display: flex;
            gap: 10px;
            padding: 6px 8px;
            background: #ffffff;
            border: 1px solid #ebebeb;
            border-radius: 4px;
            align-items: center;
            position: relative;
            transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
        }
        .zpe-outfit-item:hover {
            border-color: #cccccc;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
        }

        /* Dragging states */
        .zpe-outfit-item.zpe-is-dragging {
            opacity: 0.3;
            border: 1px dashed #111111;
        }
        .zpe-outfit-item.zpe-drag-top {
            border-top: 2px solid #111111 !important;
        }
        .zpe-outfit-item.zpe-drag-bottom {
            border-bottom: 2px solid #111111 !important;
        }

        .zpe-item-drag-handle {
            color: #bbbbbb;
            cursor: grab;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px 2px;
            touch-action: none;
            user-select: none;
        }
        .zpe-item-drag-handle:hover {
            color: #111111;
        }
        .zpe-item-drag-handle:active {
            cursor: grabbing;
        }
        .zpe-item-drag-handle svg {
            display: block;
        }

        /* Item Image & Details */
        .zpe-outfit-item-img {
            width: 44px;
            height: 58px;
            object-fit: cover;
            border-radius: 2px;
            background: #f5f5f5;
            flex-shrink: 0;
        }
        .zpe-outfit-item-details {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
            font-size: 11px;
            min-width: 0;
        }
        .zpe-outfit-item-title {
            font-weight: 600;
            color: #111111;
            text-decoration: none;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.25;
        }
        .zpe-outfit-item-title:hover {
            text-decoration: underline;
        }
        .zpe-outfit-item-submeta {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
        }
        .zpe-outfit-item-color {
            color: #777777;
            text-transform: uppercase;
        }
        .zpe-outfit-item-price {
            font-weight: 700;
            color: #111111;
        }

        .zpe-outfit-item-remove {
            background: transparent;
            border: none;
            color: #cccccc;
            font-size: 14px;
            cursor: pointer;
            padding: 4px;
            border-radius: 2px;
            transition: color 0.12s;
            flex-shrink: 0;
            line-height: 1;
        }
        .zpe-outfit-item-remove:hover {
            color: #c91818;
        }

        /* Cart Summary & Actions */
        .zpe-outfit-summary {
            padding: 12px 16px;
            background: #ffffff;
            border-top: 1px solid #ebebeb;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .zpe-outfit-total-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            font-size: 12px;
            font-weight: 800;
            text-transform: uppercase;
            color: #111111;
        }
        .zpe-outfit-fabrics {
            font-size: 10px;
            color: #777777;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .zpe-outfit-actions {
            display: flex;
            gap: 8px;
        }
        .zpe-outfit-btn {
            flex: 1;
            background: #111111;
            color: #ffffff;
            border: 1px solid #111111;
            padding: 9px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            cursor: pointer;
            text-align: center;
            border-radius: 3px;
            text-decoration: none;
            transition: all 0.12s;
        }
        .zpe-outfit-btn:hover {
            background: #333333;
            border-color: #333333;
        }
        .zpe-outfit-btn-outline {
            background: #ffffff;
            color: #111111;
            border-color: #cccccc;
        }
        .zpe-outfit-btn-outline:hover {
            background: #f7f7f7;
            border-color: #111111;
        }

        /* Sentinel & Empty State */
        #zpe-sentinel {
            height: 40px;
            width: 100%;
            grid-column: 1 / -1;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #888888;
            font-size: 11px;
        }
        .zpe-empty-state {
            grid-column: 1 / -1;
            text-align: center;
            padding: 50px 20px;
            color: #777777;
            font-size: 12px;
        }
    `;

    /* ==========================================================================
       DOM INJECTION
       ========================================================================== */
    const root = document.createElement("div");
    root.id = "zpe-root";
    root.appendChild(style);

    root.innerHTML += `
        <!-- Minimized Tab on the Right Side -->
        <div id="zpe-minimized-tab" style="display: ${state.isMinimized ? "flex" : "none"};" title="Open Zara Explorer (Alt + Z)">
            <span class="zpe-tab-icon">🧵</span>
            <div id="zpe-tab-pulse" class="zpe-tab-pulse" style="display: none;"></div>
            <span class="zpe-tab-text">Zara Explorer</span>
            <span id="zpe-tab-count" class="zpe-tab-badge">0</span>
        </div>

        <!-- Main Dockable/Fullscreen Panel -->
        <div id="zpe-panel" class="zpe-mode-${state.viewMode}" style="display: ${state.isMinimized ? "none" : "flex"}; ${
            state.viewMode === "drawer" ? `width: ${state.drawerWidth}px;` : ""
        }">
            <div id="zpe-resize-handle" title="Drag to resize panel"></div>

            <!-- Top Header -->
            <div id="zpe-header">
                <div class="zpe-header-title-box">
                    <h2 class="zpe-brand">Zara Catalog Explorer</h2>
                    <span id="zpe-status" class="zpe-badge-status">Initializing...</span>
                    <span id="zpe-cache-badge" class="zpe-badge-cached" style="display: none;">CACHED ⚡</span>
                </div>
                <div class="zpe-header-actions">
                    <button id="zpe-outfit-toggle-btn" class="zpe-icon-btn zpe-btn-outfit-toggle" type="button" title="View Outfits Cart">
                        🛒 Cart (<span id="zpe-outfit-count">${getTotalCartItemsCount()}</span>)
                    </button>
                    <button id="zpe-reload-btn" class="zpe-icon-btn" type="button" title="Bypass cache and fetch fresh data from Zara">
                        ↻ Refresh
                    </button>
                    <button id="zpe-mode-toggle-btn" class="zpe-icon-btn" type="button" title="Toggle Side Drawer / Fullscreen">
                        ${state.viewMode === "drawer" ? "⛶ Maximize" : "◨ Dock Right"}
                    </button>
                    <button id="zpe-export-btn" class="zpe-icon-btn" type="button" title="Export filtered products to JSON">
                        Export JSON
                    </button>
                    <button id="zpe-min-btn" class="zpe-icon-btn zpe-icon-btn-highlight" type="button" title="Minimize to right edge (Alt + Z)">
                        — Minimize
                    </button>
                    <button id="zpe-close-btn" class="zpe-icon-btn" type="button" title="Close Explorer">
                        ✕
                    </button>
                </div>
            </div>

            <!-- Progress Bar -->
            <div id="zpe-progress-wrap">
                <div id="zpe-progress-bar"></div>
            </div>

            <!-- Live Category Collector & Selector -->
            <div id="zpe-catalog-bar">
                <div class="zpe-catalog-item">
                    <span>Section:</span>
                    <select id="zpe-catalog-section">
                        <option value="">Loading tree...</option>
                    </select>
                </div>
                <div class="zpe-catalog-item" style="flex: 1; min-width: 140px;">
                    <span>Category:</span>
                    <select id="zpe-catalog-category" style="width: 100%;">
                        <option value="${state.categoryId}">Current (#${state.categoryId})</option>
                    </select>
                </div>
                <div class="zpe-catalog-item">
                    <span>ID:</span>
                    <input id="zpe-category-input" type="number" value="${state.categoryId}" style="width: 76px;" />
                </div>
                <button id="zpe-scan-btn" class="zpe-icon-btn zpe-icon-btn-highlight" type="button">Load</button>
            </div>

            <!-- Fine-Grained Filtering Controls -->
            <div id="zpe-filter-bar">
                <div class="zpe-field" style="grid-column: span 2;">
                    <label for="zpe-search">Search Keyword</label>
                    <input id="zpe-search" type="text" placeholder="Name, fabric, color, ID..." />
                </div>
                <div class="zpe-field">
                    <label for="zpe-color">Color Model</label>
                    <select id="zpe-color">
                        <option value="ALL">All Colors</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-material">Fiber Composition</label>
                    <select id="zpe-material">
                        <option value="ALL" selected>All Fibers</option>
                        <option value="cotton">Cotton</option>
                        <option value="linen">Linen</option>
                        <option value="wool">Wool</option>
                        <option value="silk">Silk</option>
                        <option value="cashmere">Cashmere</option>
                        <option value="alpaca">Alpaca</option>
                        <option value="mohair">Mohair</option>
                        <option value="leather">Leather</option>
                        <option value="lyocell">Lyocell / Tencel</option>
                        <option value="viscose">Viscose</option>
                        <option value="modal">Modal</option>
                        <option value="polyester">Polyester</option>
                        <option value="polyamide">Polyamide / Nylon</option>
                        <option value="elastane">Elastane</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-min-pct">Min Fiber %</label>
                    <select id="zpe-min-pct">
                        <option value="0" selected>Any %</option>
                        <option value="1">Contains (1%+)</option>
                        <option value="30">30%+</option>
                        <option value="50">50%+</option>
                        <option value="75">75%+</option>
                        <option value="90">90%+</option>
                        <option value="100">100% Pure</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-fabric-type">Fabric Purity</label>
                    <select id="zpe-fabric-type">
                        <option value="ALL" selected>All Fabrics</option>
                        <option value="natural_only">🌿 100% Natural (0% Synthetics)</option>
                        <option value="pure_only">🌿 100% Pure (Single Fiber)</option>
                        <option value="natural_blend">🌿 Natural Blend (No Synthetics)</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-family">Family</label>
                    <select id="zpe-family">
                        <option value="ALL">All Families</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-subfamily">Subfamily / Fit</label>
                    <select id="zpe-subfamily">
                        <option value="ALL">All Subfamilies</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-size">Size (In Stock)</label>
                    <select id="zpe-size">
                        <option value="ALL">All Sizes</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-discount">Discount / Sale</label>
                    <select id="zpe-discount">
                        <option value="ALL">All Items</option>
                        <option value="on_sale">🏷️ On Sale / Discounted</option>
                        <option value="discount_30">🔥 30%+ Off</option>
                        <option value="discount_50">🔥 50%+ Off</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label for="zpe-availability">Stock</label>
                    <select id="zpe-availability">
                        <option value="ALL">All Stock</option>
                        <option value="in_stock">In Stock Only</option>
                    </select>
                </div>
                <div class="zpe-field">
                    <label>Price Range</label>
                    <div class="zpe-price-inputs">
                        <input id="zpe-min-price" type="number" placeholder="Min" min="0" />
                        <input id="zpe-max-price" type="number" placeholder="Max" min="0" />
                    </div>
                </div>
                <div class="zpe-field">
                    <label for="zpe-sort">Sort Order</label>
                    <select id="zpe-sort">
                        <option value="material-desc" selected>Material %: High → Low</option>
                        <option value="discount-desc">Discount %: High → Low</option>
                        <option value="price-asc">Price: Low → High</option>
                        <option value="price-desc">Price: High → Low</option>
                        <option value="name-asc">Name: A → Z</option>
                        <option value="default">Default Order</option>
                    </select>
                </div>
                <div class="zpe-field" style="display: flex; flex-direction: row; gap: 4px;">
                    <button id="zpe-reset-btn" class="zpe-icon-btn" type="button" style="height: 30px; width: 100%;">
                        Reset All Filters
                    </button>
                </div>
            </div>

            <!-- Lazy Rendered Virtual Grid -->
            <div id="zpe-grid-wrap">
                <div id="zpe-grid"></div>
                <div id="zpe-sentinel"></div>

                <!-- Outfits Cart Slide-Over Drawer -->
                <div id="zpe-outfit-drawer">
                    <div class="zpe-cart-header">
                        <div class="zpe-cart-header-title">
                            <span>🛒 Cart</span>
                        </div>
                        <button id="zpe-outfit-close-btn" class="zpe-icon-btn" type="button" title="Close Cart">✕</button>
                    </div>

                    <!-- Outfits Tab Bar -->
                    <div id="zpe-cart-tabs-bar" class="zpe-cart-tabs-bar"></div>

                    <!-- Active Outfit Info & Management Toolbar -->
                    <div id="zpe-active-outfit-toolbar" class="zpe-active-outfit-toolbar"></div>

                    <!-- Items List for Active Outfit -->
                    <div id="zpe-outfit-body" class="zpe-outfit-body"></div>

                    <!-- Cart Summary & Actions -->
                    <div id="zpe-outfit-summary" class="zpe-outfit-summary">
                        <div class="zpe-outfit-total-row">
                            <span id="zpe-outfit-current-title">Total</span>
                            <span id="zpe-outfit-total-price">EGP 0</span>
                        </div>
                        <div id="zpe-outfit-fabrics" class="zpe-outfit-fabrics"></div>
                        <div class="zpe-outfit-actions">
                            <button id="zpe-outfit-open-all-btn" class="zpe-outfit-btn" type="button" title="Open products in Zara">
                                🛍️ Open in Zara ↗
                            </button>
                            <button id="zpe-outfit-copy-btn" class="zpe-outfit-btn zpe-outfit-btn-outline" type="button" title="Copy product links">
                                📋 Copy Links
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(root);

    /* ==========================================================================
       ELEMENT REFERENCES
       ========================================================================== */
    const els = {
        minimizedTab: document.getElementById("zpe-minimized-tab"),
        tabPulse: document.getElementById("zpe-tab-pulse"),
        tabCount: document.getElementById("zpe-tab-count"),
        panel: document.getElementById("zpe-panel"),
        resizeHandle: document.getElementById("zpe-resize-handle"),
        status: document.getElementById("zpe-status"),
        cacheBadge: document.getElementById("zpe-cache-badge"),
        outfitToggleBtn: document.getElementById("zpe-outfit-toggle-btn"),
        outfitCount: document.getElementById("zpe-outfit-count"),
        outfitDrawer: document.getElementById("zpe-outfit-drawer"),
        outfitCloseBtn: document.getElementById("zpe-outfit-close-btn"),
        outfitBody: document.getElementById("zpe-outfit-body"),
        outfitTotalPrice: document.getElementById("zpe-outfit-total-price"),
        outfitFabrics: document.getElementById("zpe-outfit-fabrics"),
        outfitOpenAllBtn: document.getElementById("zpe-outfit-open-all-btn"),
        outfitCopyBtn: document.getElementById("zpe-outfit-copy-btn"),
        cartTabsBar: document.getElementById("zpe-cart-tabs-bar"),
        activeOutfitToolbar: document.getElementById("zpe-active-outfit-toolbar"),
        outfitCurrentTitle: document.getElementById("zpe-outfit-current-title"),
        reloadBtn: document.getElementById("zpe-reload-btn"),
        modeToggleBtn: document.getElementById("zpe-mode-toggle-btn"),
        exportBtn: document.getElementById("zpe-export-btn"),
        minBtn: document.getElementById("zpe-min-btn"),
        closeBtn: document.getElementById("zpe-close-btn"),
        progressBar: document.getElementById("zpe-progress-bar"),
        catalogSection: document.getElementById("zpe-catalog-section"),
        catalogCategory: document.getElementById("zpe-catalog-category"),
        categoryInput: document.getElementById("zpe-category-input"),
        scanBtn: document.getElementById("zpe-scan-btn"),
        search: document.getElementById("zpe-search"),
        color: document.getElementById("zpe-color"),
        material: document.getElementById("zpe-material"),
        minPct: document.getElementById("zpe-min-pct"),
        fabricType: document.getElementById("zpe-fabric-type"),
        family: document.getElementById("zpe-family"),
        subfamily: document.getElementById("zpe-subfamily"),
        size: document.getElementById("zpe-size"),
        discount: document.getElementById("zpe-discount"),
        availability: document.getElementById("zpe-availability"),
        minPrice: document.getElementById("zpe-min-price"),
        maxPrice: document.getElementById("zpe-max-price"),
        sort: document.getElementById("zpe-sort"),
        resetBtn: document.getElementById("zpe-reset-btn"),
        gridWrap: document.getElementById("zpe-grid-wrap"),
        grid: document.getElementById("zpe-grid"),
        sentinel: document.getElementById("zpe-sentinel")
    };

    /* ==========================================================================
       UTILITY HELPERS
       ========================================================================== */
    const escapeHtml = (str) =>
        String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

    const fetchJson = async (url, signal) => {
        const response = await fetch(url, {
            headers: {
                accept: "*/*",
                "accept-language": "en-US,en;q=0.9",
                priority: "u=1, i"
            },
            referrer: window.location.href,
            method: "GET",
            mode: "cors",
            credentials: "include",
            signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    };

    /* ==========================================================================
       HIGH-PRECISION COLOR MEDIA RESOLVER (Crema & Classic Zara Formats)
       ========================================================================== */
    const resolveMediaUrl = (mediaObj, width = "750") => {
        if (!mediaObj) return "";

        // 1. Direct deliveryUrl
        if (mediaObj.extraInfo?.deliveryUrl) {
            return mediaObj.extraInfo.deliveryUrl;
        }

        // 2. Direct url with width replacement
        if (mediaObj.url) {
            return mediaObj.url.replace(/\{width\}/g, width);
        }

        // 3. Crema / Layered format (Modern Zara CDN format)
        if (Array.isArray(mediaObj.layers)) {
            for (const layer of mediaObj.layers) {
                if (layer.type === "vector") continue;
                if (layer.extraInfo?.deliveryUrl) return layer.extraInfo.deliveryUrl;
                if (layer.url) return layer.url.replace(/\{width\}/g, width);
            }
        }

        // 4. Path + Name structure
        if (mediaObj.path && mediaObj.name) {
            const p = mediaObj.path.replace(/^\/+/, "").replace(/\/+$/, "");
            const n = mediaObj.name.replace(/^\/+/, "");
            const ts = mediaObj.timestamp ? `?ts=${mediaObj.timestamp}&w=${width}` : `?w=${width}`;
            return `https://static.zara.net/photos/${p}/${n}.jpg${ts}`;
        }

        return "";
    };

    const extractColorMediaList = (colorObj, product) => {
        const urls = [];
        const add = (u) => {
            if (u && typeof u === "string" && !urls.includes(u)) {
                urls.push(u);
            }
        };

        // 1. Color's own pdpMedia
        add(resolveMediaUrl(colorObj?.pdpMedia));

        // 2. Color's own xmedia array
        const xmediaList = colorObj?.xmedia ?? [];
        for (const m of xmediaList) {
            add(resolveMediaUrl(m));
        }

        // 3. Match from product.xmedia by color ID / code
        const colorId = String(colorObj?.id || colorObj?.colorId || "").trim();
        if (colorId && Array.isArray(product?.xmedia)) {
            for (const m of product.xmedia) {
                const mCode = String(m?.colorCode || m?.extraInfo?.colorCode || m?.stylingId || "").trim();
                const matchesCode = mCode === colorId;
                const matchesPath = m?.path && m.path.includes(`/${colorId}/`);
                const matchesName = m?.name && m.name.includes(colorId);
                if (matchesCode || matchesPath || matchesName) {
                    add(resolveMediaUrl(m));
                }
            }
        }

        // 4. Fallback to product.xmedia root
        if (urls.length === 0 && Array.isArray(product?.xmedia)) {
            for (const m of product.xmedia) {
                add(resolveMediaUrl(m));
            }
        }

        return urls;
    };

    const extractProductColors = (product) => {
        const list = [];
        const seenNames = new Set();

        // 1. Primary: detail.colors
        for (const c of product.detail?.colors ?? []) {
            const name = (c?.name || "").trim();
            if (name && !seenNames.has(name.toLowerCase())) {
                seenNames.add(name.toLowerCase());
                const mediaList = extractColorMediaList(c, product);
                list.push({
                    id: String(c.id || ""),
                    name: name,
                    hex: c.hexColor || "",
                    image: mediaList[0] || "",
                    secondaryImage: mediaList[1] || mediaList[0] || "",
                    price: typeof c.price === "number" ? c.price / 100 : null,
                    availability: c.availability || product.availability || "in_stock",
                    sizes: (c?.sizes ?? []).map((s) => ({
                        name: (s?.name || "").trim(),
                        inStock: s.availability === "in_stock" || !s.availability
                    }))
                });
            }
        }

        return list;
    };

    const extractProductSizes = (product) => {
        const map = new Map();
        for (const c of product.detail?.colors ?? []) {
            for (const s of c?.sizes ?? []) {
                const name = (s?.name || "").trim();
                if (name) {
                    const inStock = s.availability === "in_stock" || !s.availability;
                    map.set(name, (map.get(name) || false) || inStock);
                }
            }
        }
        for (const s of product.sizes ?? []) {
            const name = (s?.name || "").trim();
            if (name) {
                const inStock = s.availability === "in_stock" || !s.availability;
                map.set(name, (map.get(name) || false) || inStock);
            }
        }
        return Array.from(map.entries()).map(([name, inStock]) => ({ name, inStock }));
    };

    const parseMaterialBreakdown = (materials) => {
        const text = materials.join("\n");
        const breakdown = {};
        const regex = /(\d+)\s*%\s*([a-zA-Z][a-zA-Z\s-]{1,30})/g;
        for (const match of text.matchAll(regex)) {
            const pct = Number(match[1]);
            const rawFiber = match[2].trim().toLowerCase();
            breakdown[rawFiber] = Math.max(breakdown[rawFiber] || 0, pct);

            for (const baseFiber of state.knownMaterials) {
                if (rawFiber.includes(baseFiber)) {
                    breakdown[baseFiber] = Math.max(breakdown[baseFiber] || 0, pct);
                }
            }
        }
        return breakdown;
    };

    const getMaterialPercent = (item, fiber) => {
        if (!fiber || fiber === "ALL") {
            const vals = Object.values(item.materialBreakdown || {});
            return vals.length > 0 ? Math.max(...vals) : 0;
        }
        const f = fiber.toLowerCase();
        if (item.materialBreakdown?.[f] !== undefined) {
            return item.materialBreakdown[f];
        }
        for (const [k, v] of Object.entries(item.materialBreakdown || {})) {
            if (k.includes(f)) return v;
        }
        if ((item.materialsText || "").toLowerCase().includes(f)) {
            return 1;
        }
        return 0;
    };

    const is100Natural = (item) => {
        if (!item.materialsLoaded) return false;
        const entries = Object.entries(item.materialBreakdown || {});
        if (entries.length === 0) return false;
        let hasNatural = false;
        for (const [fiber, pct] of entries) {
            if (state.syntheticFibers.has(fiber) && pct > 0) return false;
            if (state.naturalFibers.has(fiber) && pct > 0) hasNatural = true;
        }
        return hasNatural;
    };

    const isPureSingleFiber = (item) => {
        if (!item.materialsLoaded) return false;
        const vals = Object.values(item.materialBreakdown || {});
        return vals.some((v) => v === 100);
    };

    const isNaturalBlend = (item) => {
        if (!item.materialsLoaded) return false;
        const entries = Object.entries(item.materialBreakdown || {});
        if (entries.length < 2) return false;
        let naturalCount = 0;
        for (const [fiber, pct] of entries) {
            if (state.syntheticFibers.has(fiber) && pct > 0) return false;
            if (state.naturalFibers.has(fiber) && pct > 0) naturalCount++;
        }
        return naturalCount >= 2;
    };

    const getPrimaryMaterialBadge = (item) => {
        const selectedMat = state.filters.material;
        if (selectedMat !== "ALL") {
            const pct = getMaterialPercent(item, selectedMat);
            if (pct > 1) return { text: `${pct}% ${selectedMat}`, isPure: pct === 100 };
            if (pct === 1) return { text: selectedMat, isPure: false };
        }
        if (!item.materialsLoaded) {
            return { text: item.family || item.sectionName || "ZARA", isPure: false };
        }
        const entries = Object.entries(item.materialBreakdown || {}).filter(([k]) =>
            state.knownMaterials.has(k)
        );
        if (entries.length > 0) {
            entries.sort((a, b) => b[1] - a[1]);
            return {
                text: `${entries[0][1]}% ${entries[0][0]}`,
                isPure: entries[0][1] === 100
            };
        }
        return { text: item.family || item.sectionName || "ZARA", isPure: false };
    };

    /* ==========================================================================
       CATEGORY TREE COLLECTOR (Uses Cached Navigation Tree)
       ========================================================================== */
    const loadCatalogTree = async (forceRefresh = false) => {
        try {
            const storeKey = state.baseUrl;
            if (!forceRefresh) {
                const cachedTree = await cache.get("category_tree", storeKey);
                if (cachedTree && cachedTree.sections && Date.now() - cachedTree.savedAt < CACHE_TTL_TREE_MS) {
                    state.sections = cachedTree.sections;
                    populateCatalogSectionSelect();
                    return;
                }
            }

            let data = null;
            const queryParams = new URLSearchParams({ ajax: "true" });
            if (state.categoryId) queryParams.set("categoryId", String(state.categoryId));
            if (state.categorySeoId) queryParams.set("categorySeoId", String(state.categorySeoId));

            try {
                data = await fetchJson(`${state.baseUrl}/categories?${queryParams.toString()}`);
            } catch {
                data = await fetchJson(`${state.baseUrl}/categories?ajax=true`);
            }

            const rootCategories = Array.isArray(data?.categories) ? data.categories : [];
            const sections = [];

            for (const sec of rootCategories) {
                if (!sec?.name || sec.name === "JOIN LIFE") continue;
                const flatList = [];
                const seenIds = new Set();

                const walk = (nodes, pathParts) => {
                    for (const node of nodes ?? []) {
                        if (!node?.name || node.visibility === "HIDDEN") continue;
                        const targetId = Number(node.redirectCategoryId || node.id);
                        const nextPath = [...pathParts, node.name];
                        const hasChildren =
                            Array.isArray(node.subcategories) && node.subcategories.length > 0;

                        if (
                            targetId &&
                            !seenIds.has(targetId) &&
                            (!hasChildren || node.isRedirected || /view all/i.test(node.name))
                        ) {
                            seenIds.add(targetId);
                            flatList.push({
                                id: targetId,
                                label: nextPath.join(" › ")
                            });
                        }
                        if (hasChildren) {
                            walk(node.subcategories, nextPath);
                        }
                    }
                };

                walk(sec.subcategories, []);
                if (flatList.length > 0) {
                    sections.push({
                        name: sec.name,
                        id: sec.id,
                        categories: flatList
                    });
                }
            }

            state.sections = sections;
            cache.set("category_tree", { storeKey, sections });
            populateCatalogSectionSelect();
        } catch (err) {
            console.warn("[Zara Explorer] Could not load category tree:", err);
        }
    };

    const populateCatalogSectionSelect = () => {
        if (!state.sections.length) return;
        els.catalogSection.innerHTML = state.sections
            .map(
                (s, idx) =>
                    `<option value="${idx}">${escapeHtml(s.name)} (${s.categories.length})</option>`
            )
            .join("");

        let matchedIdx = state.sections.findIndex((s) =>
            s.categories.some((c) => c.id === state.categoryId)
        );
        if (matchedIdx === -1) {
            matchedIdx = state.sections.findIndex((s) => /man/i.test(s.name));
            if (matchedIdx === -1) matchedIdx = 0;
        }
        els.catalogSection.value = String(matchedIdx);
        populateCatalogCategorySelect(matchedIdx);
    };

    const populateCatalogCategorySelect = (sectionIdx) => {
        const sec = state.sections[sectionIdx];
        if (!sec) return;
        const hasCurrent = sec.categories.some((c) => c.id === state.categoryId);
        els.catalogCategory.innerHTML =
            (!hasCurrent
                ? `<option value="${state.categoryId}">Category #${state.categoryId}</option>`
                : "") +
            sec.categories
                .map(
                    (c) =>
                        `<option value="${c.id}" ${
                            c.id === state.categoryId ? "selected" : ""
                        }>${escapeHtml(c.label)} (#${c.id})</option>`
                )
                .join("");
    };

    /* ==========================================================================
       DYNAMIC DROPDOWNS & FILTERING
       ========================================================================== */
    const populateDynamicDropdowns = () => {
        const colorCounts = new Map();
        const familyCounts = new Map();
        const subfamilyCounts = new Map();
        const sizeCounts = new Map();

        for (const p of state.allProducts) {
            if (p.family) {
                familyCounts.set(p.family, (familyCounts.get(p.family) || 0) + 1);
            }
            if (p.subfamily) {
                subfamilyCounts.set(p.subfamily, (subfamilyCounts.get(p.subfamily) || 0) + 1);
            }
            for (const c of p.colors || []) {
                colorCounts.set(c.name, (colorCounts.get(c.name) || 0) + 1);
            }
            for (const s of p.sizes || []) {
                if (s.inStock) {
                    sizeCounts.set(s.name, (sizeCounts.get(s.name) || 0) + 1);
                }
            }
        }

        const updateSelect = (selectEl, allLabel, countsMap, sortByCount = false) => {
            const prev = selectEl.value;
            const entries = [...countsMap.entries()].sort((a, b) =>
                sortByCount ? b[1] - a[1] || a[0].localeCompare(b[0]) : a[0].localeCompare(b[0])
            );
            selectEl.innerHTML =
                `<option value="ALL">${allLabel} (${state.allProducts.length})</option>` +
                entries
                    .map(
                        ([val, count]) =>
                            `<option value="${escapeHtml(val)}">${escapeHtml(val)} (${count})</option>`
                    )
                    .join("");
            selectEl.value = countsMap.has(prev) ? prev : "ALL";
        };

        updateSelect(els.color, "All Colors", colorCounts, true);
        updateSelect(els.family, "All Families", familyCounts);
        updateSelect(els.subfamily, "All Subfamilies / Fits", subfamilyCounts);
        updateSelect(els.size, "All Sizes", sizeCounts);
    };

    const computeFilteredProducts = () => {
        const q = state.filters.query.trim().toLowerCase();
        const fam = state.filters.family;
        const subfam = state.filters.subfamily;
        const col = state.filters.color.toLowerCase();
        const mat = state.filters.material;
        const minPct = Number(state.filters.minMaterialPct) || 0;
        const fabricType = state.filters.fabricType;
        const chosenSize = state.filters.size;
        const discountType = state.filters.discount;
        const avail = state.filters.availability;
        const minP = state.filters.minPrice !== "" ? Number(state.filters.minPrice) : null;
        const maxP = state.filters.maxPrice !== "" ? Number(state.filters.maxPrice) : null;

        const filtered = state.allProducts.filter((item) => {
            if (avail !== "ALL" && item.availability !== avail) return false;
            if (minP !== null && item.price < minP) return false;
            if (maxP !== null && item.price > maxP) return false;
            if (fam !== "ALL" && item.family !== fam) return false;
            if (subfam !== "ALL" && item.subfamily !== subfam) return false;

            // Strict color model check: must have the color AND a valid resolved photo for that color
            if (col !== "all") {
                const matchingColor = (item.colors || []).find(
                    (c) => c.name.toLowerCase() === col
                );
                if (!matchingColor) return false;
            }

            // Size check
            if (chosenSize !== "ALL") {
                const hasSize = (item.sizes || []).some(
                    (s) => s.name === chosenSize && s.inStock
                );
                if (!hasSize) return false;
            }

            // Discount check
            if (discountType === "on_sale" && (!item.discountPct || item.discountPct <= 0)) return false;
            if (discountType === "discount_30" && (!item.discountPct || item.discountPct < 30)) return false;
            if (discountType === "discount_50" && (!item.discountPct || item.discountPct < 50)) return false;

            // Fabric Purity check
            if (fabricType === "natural_only" && !is100Natural(item)) return false;
            if (fabricType === "pure_only" && !isPureSingleFiber(item)) return false;
            if (fabricType === "natural_blend" && !isNaturalBlend(item)) return false;

            // Material % check
            if (mat !== "ALL" || minPct > 0) {
                if (!item.materialsLoaded) return false;
                const pct = getMaterialPercent(item, mat);
                const threshold = Math.max(minPct, mat !== "ALL" ? 1 : 0);
                if (pct < threshold) return false;
            }

            // Search query
            if (q) {
                const haystack = `${item.id} ${item.name} ${item.family} ${item.subfamily} ${(item.colors || []).map((c) => c.name).join(" ")} ${item.materialsText}`.toLowerCase();
                if (!haystack.includes(q)) return false;
            }

            return true;
        });

        filtered.sort((a, b) => {
            switch (state.filters.sortBy) {
                case "discount-desc":
                    return (b.discountPct || 0) - (a.discountPct || 0) || a.price - b.price;
                case "price-asc":
                    return a.price - b.price;
                case "price-desc":
                    return b.price - a.price;
                case "material-desc":
                    return (
                        getMaterialPercent(b, mat) - getMaterialPercent(a, mat) ||
                        a.price - b.price
                    );
                case "name-asc":
                    return a.name.localeCompare(b.name);
                default:
                    return 0;
            }
        });

        state.filteredProducts = filtered;
    };

    const updateStatusText = () => {
        const scanStatus = state.isScanning
            ? `Scanning: ${state.scannedCount}/${state.totalCount}`
            : `Loaded ${state.allProducts.length}`;
        els.status.textContent = `${scanStatus} • Showing ${state.filteredProducts.length}`;
        els.tabCount.textContent = String(state.filteredProducts.length);
        els.tabPulse.style.display = state.isScanning ? "block" : "none";
        els.cacheBadge.style.display = state.isFromCache ? "inline-block" : "none";

        const pct =
            state.totalCount > 0
                ? Math.round((state.scannedCount / state.totalCount) * 100)
                : 0;
        els.progressBar.style.width = `${pct}%`;
    };

    /* ==========================================================================
       LAZY CHUNKED RENDERING (Zero UI Jank / 60 FPS)
       Presents the exact chosen color model for every product card.
       ========================================================================== */
    const renderCardHtml = (item) => {
        const badge = getPrimaryMaterialBadge(item);

        // Find the active color model: if a specific color is chosen in filters, show that color!
        const selectedCol = state.filters.color.toLowerCase();
        let activeColor = null;
        if (selectedCol !== "all") {
            activeColor = (item.colors || []).find((c) => c.name.toLowerCase() === selectedCol && c.image);
        }
        if (!activeColor) {
            activeColor = item.colors?.find((c) => c.image) || item.colors?.[0] || null;
        }

        // Active image, secondary hover image, and prices
        const displayImage = activeColor?.image || item.image;
        const secondaryImage = activeColor?.secondaryImage || item.secondaryImage || displayImage;
        const displayPrice = typeof activeColor?.price === "number" ? activeColor.price : item.price;
        const displayOldPrice = item.oldPrice;
        const displayDiscountPct = item.discountPct;
        const displayColorName = activeColor?.name || "";

        // Available in-stock sizes
        const inStockSizes = (item.sizes || []).filter((s) => s.inStock).slice(0, 6);
        const sizesHtml = inStockSizes.length > 0
            ? `<div class="zpe-card-sizes">${inStockSizes.map((s) => `<span>${escapeHtml(s.name)}</span>`).join("")}</div>`
            : "";

        // Swatches with click & hover interactivity
        const swatchesHtml = (item.colors || [])
            .slice(0, 8)
            .map((c) => {
                const isSelected = activeColor && c.name.toLowerCase() === activeColor.name.toLowerCase();
                const hasImg = Boolean(c.image);
                return `
                    <button type="button"
                            class="zpe-swatch-btn ${isSelected ? "selected" : ""}"
                            title="${escapeHtml(c.name)}${!hasImg ? " (Catalog color)" : ""}"
                            data-card-id="${escapeHtml(item.id)}"
                            data-color-name="${escapeHtml(c.name)}"
                            data-color-img="${escapeHtml(c.image || item.image)}"
                            data-color-sec="${escapeHtml(c.secondaryImage || c.image || item.image)}"
                            data-color-price="${c.price !== null ? c.price : item.price}">
                        ${c.hex ? `<span class="zpe-swatch-dot" style="background:${escapeHtml(c.hex)}"></span>` : ""}
                        <span>${escapeHtml(c.name)}</span>
                    </button>
                `;
            })
            .join("");

        const materialText = item.materialsLoaded
            ? item.materials?.length > 0
                ? item.materials.join("\n")
                : "No material composition listed"
            : "Scanning material composition...";

        return `
            <div class="zpe-card" id="zpe-card-${escapeHtml(item.id)}">
                <a href="${escapeHtml(item.url)}"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="zpe-card-img-wrap"
                   data-primary-img="${escapeHtml(displayImage)}"
                   data-secondary-img="${escapeHtml(secondaryImage)}">
                    ${
                        displayImage
                            ? `<img class="zpe-card-img" id="zpe-img-${escapeHtml(item.id)}" src="${escapeHtml(displayImage)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
                            : ""
                    }
                    <span class="zpe-badge-mat ${badge.isPure ? "pure" : ""}">${escapeHtml(badge.text)}</span>
                    ${displayDiscountPct && displayDiscountPct > 0 ? `<span class="zpe-badge-discount">-${displayDiscountPct}%</span>` : ""}
                    <span class="zpe-badge-stock">${escapeHtml((activeColor?.availability || item.availability || "").replace(/_/g, " "))}</span>
                </a>
                <div class="zpe-card-body">
                    <div class="zpe-card-meta">
                        <span>${escapeHtml([item.family, item.subfamily].filter(Boolean).join(" • ") || "Zara")}</span>
                        ${displayColorName ? `<span class="zpe-card-active-color" id="zpe-active-color-${escapeHtml(item.id)}">${escapeHtml(displayColorName)}</span>` : ""}
                    </div>
                    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="zpe-card-title">
                        ${escapeHtml(item.name)}
                    </a>
                    <div class="zpe-price-row">
                        <span class="zpe-card-price" id="zpe-price-${escapeHtml(item.id)}">
                            ${typeof displayPrice === "number" ? displayPrice.toLocaleString() : escapeHtml(displayPrice)}
                        </span>
                        ${displayOldPrice && displayOldPrice > displayPrice ? `<span class="zpe-card-old-price">${displayOldPrice.toLocaleString()}</span>` : ""}
                    </div>
                    ${sizesHtml}
                    ${swatchesHtml ? `<div class="zpe-swatches">${swatchesHtml}</div>` : ""}
                    <div class="zpe-card-materials">${escapeHtml(materialText)}</div>
                    <div class="zpe-card-footer">
                        <button type="button"
                                class="zpe-btn-add-outfit"
                                data-card-id="${escapeHtml(item.id)}"
                                title="Add to outfit">+</button>
                        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="zpe-link-btn">
                            Open ↗
                        </a>
                    </div>
                </div>
            </div>
        `;
    };

    const renderNextChunk = () => {
        const total = state.filteredProducts.length;
        if (state.renderedCount >= total) {
            els.sentinel.textContent = total > 0 ? "— End of products —" : "";
            return;
        }

        const nextSlice = state.filteredProducts.slice(
            state.renderedCount,
            state.renderedCount + CHUNK_SIZE
        );
        const html = nextSlice.map(renderCardHtml).join("");
        els.grid.insertAdjacentHTML("beforeend", html);
        state.renderedCount += nextSlice.length;

        els.sentinel.textContent = state.renderedCount < total ? "Loading more products..." : "— End of products —";
    };

    const resetAndRenderGrid = () => {
        computeFilteredProducts();
        updateStatusText();
        els.grid.innerHTML = "";
        state.renderedCount = 0;

        if (state.filteredProducts.length === 0) {
            els.grid.innerHTML = `<div class="zpe-empty-state">${
                state.isScanning
                    ? "Scanning products & materials... matching items will appear automatically."
                    : "No products match your current filters."
            }</div>`;
            els.sentinel.textContent = "";
            return;
        }

        renderNextChunk();
        els.gridWrap.scrollTop = 0;
    };

    // IntersectionObserver for smooth infinite scrolling
    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                renderNextChunk();
            }
        },
        { root: els.gridWrap, rootMargin: "300px" }
    );
    observer.observe(els.sentinel);

    // Interactive card hover for secondary photo
    els.grid.addEventListener("mouseover", (e) => {
        const imgWrap = e.target.closest(".zpe-card-img-wrap");
        if (!imgWrap) return;
        const secImg = imgWrap.dataset.secondaryImg;
        const img = imgWrap.querySelector(".zpe-card-img");
        if (img && secImg && secImg !== img.src) {
            img.src = secImg;
        }
    });

    els.grid.addEventListener("mouseout", (e) => {
        const imgWrap = e.target.closest(".zpe-card-img-wrap");
        if (!imgWrap || imgWrap.contains(e.relatedTarget)) return;
        const priImg = imgWrap.dataset.primaryImg;
        const img = imgWrap.querySelector(".zpe-card-img");
        if (img && priImg && priImg !== img.src) {
            img.src = priImg;
        }
    });

    // Interactive swatch hover/click handler on card with image validation
    const handleSwatchInteraction = (e) => {
        const btn = e.target.closest(".zpe-swatch-btn");
        if (!btn) return;

        const cardId = btn.dataset.cardId;
        const colorName = btn.dataset.colorName;
        const colorImg = btn.dataset.colorImg;
        const colorSec = btn.dataset.colorSec;
        const colorPrice = btn.dataset.colorPrice;

        const card = document.getElementById(`zpe-card-${cardId}`);
        if (!card) return;

        // Switch card image and primary/secondary data attributes
        const imgWrap = card.querySelector(".zpe-card-img-wrap");
        if (imgWrap && colorImg) {
            imgWrap.dataset.primaryImg = colorImg;
            imgWrap.dataset.secondaryImg = colorSec || colorImg;
        }

        const img = card.querySelector(".zpe-card-img");
        if (img && colorImg && img.src !== colorImg) {
            img.src = colorImg;
        }

        // Switch color badge
        const badge = card.querySelector(".zpe-card-active-color");
        if (badge && colorName) {
            badge.textContent = colorName;
        }

        // Switch price if available
        const priceEl = card.querySelector(".zpe-card-price");
        if (priceEl && colorPrice) {
            const numPrice = Number(colorPrice);
            if (!isNaN(numPrice) && numPrice > 0) {
                priceEl.textContent = numPrice.toLocaleString();
            }
        }

        // Highlight selected swatch
        card.querySelectorAll(".zpe-swatch-btn").forEach((s) => s.classList.remove("selected"));
        btn.classList.add("selected");
    };

    els.grid.addEventListener("click", handleSwatchInteraction);
    els.grid.addEventListener("mouseover", handleSwatchInteraction);

    /* ==========================================================================
       OUTFIT BUILDER & CART LOGIC (Multiple Outfits & Reordering)
       ========================================================================== */
    const saveCart = () => {
        localStorage.setItem("zpe_cart", JSON.stringify(state.cart));
        const active = getActiveOutfit();
        localStorage.setItem("zpe_outfit", JSON.stringify(active.items || []));
        updateCartBadge();
    };

    const updateCartBadge = () => {
        const totalItems = getTotalCartItemsCount();
        if (els.outfitCount) {
            els.outfitCount.textContent = String(totalItems);
        }
    };

    const createNewOutfit = (customName) => {
        const nextNum = state.cart.outfits.length + 1;
        const name = customName || prompt("Enter name for new outfit:", `Outfit ${nextNum}`);
        if (name === null) return;
        const finalName = name.trim() || `Outfit ${nextNum}`;

        const newOutfit = {
            id: `outfit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: finalName,
            items: []
        };
        state.cart.outfits.push(newOutfit);
        state.cart.activeOutfitId = newOutfit.id;
        saveCart();
        renderCartDrawer();
    };

    const renameActiveOutfit = () => {
        const active = getActiveOutfit();
        const newName = prompt("Rename outfit:", active.name);
        if (newName && newName.trim() && newName.trim() !== active.name) {
            active.name = newName.trim();
            saveCart();
            renderCartDrawer();
        }
    };

    const deleteActiveOutfit = () => {
        const active = getActiveOutfit();
        if (state.cart.outfits.length <= 1) {
            if (confirm(`Clear all items from "${active.name}"?`)) {
                active.items = [];
                saveCart();
                renderCartDrawer();
            }
            return;
        }

        if (confirm(`Delete "${active.name}" from your cart?`)) {
            const idx = state.cart.outfits.findIndex((o) => o.id === active.id);
            if (idx !== -1) {
                state.cart.outfits.splice(idx, 1);
                state.cart.activeOutfitId = state.cart.outfits[Math.max(0, idx - 1)].id;
                saveCart();
                renderCartDrawer();
            }
        }
    };

    const reorderItemToTarget = (fromIdx, targetIdx, placeAfter) => {
        const active = getActiveOutfit();
        if (!active.items || fromIdx < 0 || fromIdx >= active.items.length) return;
        if (targetIdx < 0 || targetIdx >= active.items.length) return;
        if (fromIdx === targetIdx) return;

        const [moved] = active.items.splice(fromIdx, 1);
        let insertIdx = targetIdx;
        if (fromIdx < targetIdx) {
            insertIdx = placeAfter ? targetIdx : targetIdx - 1;
        } else {
            insertIdx = placeAfter ? targetIdx + 1 : targetIdx;
        }
        insertIdx = Math.max(0, Math.min(insertIdx, active.items.length));
        active.items.splice(insertIdx, 0, moved);
        saveCart();
        renderCartDrawer();
    };

    const renderCartDrawer = () => {
        const activeOutfit = getActiveOutfit();
        const items = activeOutfit.items || [];
        const totalOutfits = state.cart.outfits.length;

        // 1. Render Tabs Bar
        if (els.cartTabsBar) {
            els.cartTabsBar.innerHTML = `
                ${state.cart.outfits
                    .map((o) => {
                        const isActive = o.id === activeOutfit.id;
                        const count = o.items?.length || 0;
                        return `
                            <div class="zpe-cart-tab ${isActive ? "active" : ""}" data-outfit-id="${escapeHtml(o.id)}" title="${escapeHtml(o.name)} (${count})">
                                <span>${escapeHtml(o.name)}</span>
                                <span class="zpe-cart-tab-count">(${count})</span>
                            </div>
                        `;
                    })
                    .join("")}
                <button type="button" id="zpe-cart-tab-add" class="zpe-cart-tab-add" title="New Outfit">+</button>
            `;
        }

        // 2. Render Active Outfit Toolbar
        if (els.activeOutfitToolbar) {
            els.activeOutfitToolbar.innerHTML = `
                <div class="zpe-active-outfit-name-box" id="zpe-rename-box" title="Click to rename">
                    <span class="zpe-active-outfit-name">${escapeHtml(activeOutfit.name)}</span>
                    <span style="font-size:10px;color:#999;">✏️</span>
                </div>
                <button type="button" class="zpe-btn-icon-subtle" id="zpe-btn-delete-outfit" title="${totalOutfits > 1 ? "Delete outfit" : "Clear outfit"}">
                    🗑️
                </button>
            `;
        }

        // 3. Render Items in Active Outfit
        if (items.length === 0) {
            els.outfitBody.innerHTML = `
                <div class="zpe-outfit-empty">
                    This outfit is empty.<br />Click <strong>+</strong> on any product to add it.
                </div>
            `;
            els.outfitTotalPrice.textContent = "EGP 0";
            if (els.outfitFabrics) els.outfitFabrics.textContent = "";
        } else {
            let outfitTotal = 0;
            const fabricMap = new Map();

            els.outfitBody.innerHTML = items
                .map((item, idx) => {
                    const priceNum = Number(item.price) || 0;
                    outfitTotal += priceNum;

                    if (item.materialsText) {
                        for (const m of item.materialsText.split("|")) {
                            const trimmed = m.trim();
                            if (trimmed) fabricMap.set(trimmed, (fabricMap.get(trimmed) || 0) + 1);
                        }
                    }

                    return `
                        <div class="zpe-outfit-item" draggable="true" data-item-idx="${idx}">
                            <div class="zpe-item-drag-handle" title="Drag to reorder">
                                <svg width="10" height="14" viewBox="0 0 20 24" fill="currentColor">
                                    <circle cx="6" cy="4" r="2.5"/>
                                    <circle cx="14" cy="4" r="2.5"/>
                                    <circle cx="6" cy="12" r="2.5"/>
                                    <circle cx="14" cy="12" r="2.5"/>
                                    <circle cx="6" cy="20" r="2.5"/>
                                    <circle cx="14" cy="20" r="2.5"/>
                                </svg>
                            </div>
                            <img class="zpe-outfit-item-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" />
                            <div class="zpe-outfit-item-details">
                                <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="zpe-outfit-item-title">
                                    ${escapeHtml(item.name)}
                                </a>
                                <div class="zpe-outfit-item-submeta">
                                    <span class="zpe-outfit-item-color">${escapeHtml(item.color || item.family || "")}</span>
                                    <span class="zpe-outfit-item-price">${typeof item.price === "number" ? item.price.toLocaleString() : escapeHtml(item.price)}</span>
                                </div>
                            </div>
                            <button type="button" class="zpe-outfit-item-remove" data-outfit-idx="${idx}" title="Remove piece">✕</button>
                        </div>
                    `;
                })
                .join("");

            els.outfitTotalPrice.textContent = outfitTotal > 0 ? `EGP ${outfitTotal.toLocaleString()}` : "EGP 0";

            if (els.outfitFabrics) {
                const topFabrics = Array.from(fabricMap.keys()).slice(0, 3);
                els.outfitFabrics.textContent = topFabrics.length > 0 ? `Fabrics: ${topFabrics.join(" • ")}` : "";
            }
        }

        // 4. Update Summary Info
        if (els.outfitCurrentTitle) {
            els.outfitCurrentTitle.textContent = totalOutfits > 1 ? `${activeOutfit.name} Total` : "Total";
        }

        updateCartBadge();
    };

    const toggleOutfitDrawer = (force) => {
        state.isOutfitOpen = force !== undefined ? force : !state.isOutfitOpen;
        if (state.isOutfitOpen) {
            renderCartDrawer();
            els.outfitDrawer.classList.add("open");
        } else {
            els.outfitDrawer.classList.remove("open");
        }
    };

    els.outfitToggleBtn.addEventListener("click", () => toggleOutfitDrawer());
    els.outfitCloseBtn.addEventListener("click", () => toggleOutfitDrawer(false));

    // Handle Tab Bar & Toolbar clicks via delegation on outfitDrawer
    els.outfitDrawer.addEventListener("click", (e) => {
        const tab = e.target.closest(".zpe-cart-tab");
        if (tab) {
            const outfitId = tab.dataset.outfitId;
            if (outfitId && outfitId !== state.cart.activeOutfitId) {
                state.cart.activeOutfitId = outfitId;
                saveCart();
                renderCartDrawer();
            }
            return;
        }

        const addTabBtn = e.target.closest("#zpe-cart-tab-add");
        if (addTabBtn) {
            createNewOutfit();
            return;
        }

        const renameBtn = e.target.closest("#zpe-rename-box");
        if (renameBtn) {
            renameActiveOutfit();
            return;
        }

        const delBtn = e.target.closest("#zpe-btn-delete-outfit");
        if (delBtn) {
            deleteActiveOutfit();
            return;
        }
    });

    // Handle Drag & Drop reordering in outfitBody
    let draggedItemIdx = null;

    els.outfitBody.addEventListener("dragstart", (e) => {
        if (e.target.closest("button, select, a, input")) {
            e.preventDefault();
            return;
        }
        const itemEl = e.target.closest(".zpe-outfit-item");
        if (!itemEl) return;
        draggedItemIdx = Number(itemEl.dataset.itemIdx);
        itemEl.classList.add("zpe-is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(draggedItemIdx));
    });

    els.outfitBody.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const targetEl = e.target.closest(".zpe-outfit-item");
        if (!targetEl) return;

        els.outfitBody.querySelectorAll(".zpe-outfit-item").forEach((el) => {
            if (el !== targetEl) {
                el.classList.remove("zpe-drag-top", "zpe-drag-bottom");
            }
        });

        const rect = targetEl.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        if (relY < rect.height / 2) {
            targetEl.classList.add("zpe-drag-top");
            targetEl.classList.remove("zpe-drag-bottom");
        } else {
            targetEl.classList.add("zpe-drag-bottom");
            targetEl.classList.remove("zpe-drag-top");
        }
    });

    els.outfitBody.addEventListener("dragleave", (e) => {
        const targetEl = e.target.closest(".zpe-outfit-item");
        if (targetEl && !targetEl.contains(e.relatedTarget)) {
            targetEl.classList.remove("zpe-drag-top", "zpe-drag-bottom");
        }
    });

    els.outfitBody.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetEl = e.target.closest(".zpe-outfit-item");
        if (!targetEl || draggedItemIdx === null) return;

        const targetIdx = Number(targetEl.dataset.itemIdx);
        const placeAfter = targetEl.classList.contains("zpe-drag-bottom");
        targetEl.classList.remove("zpe-drag-top", "zpe-drag-bottom");

        if (!isNaN(targetIdx)) {
            reorderItemToTarget(draggedItemIdx, targetIdx, placeAfter);
        }
        draggedItemIdx = null;
    });

    els.outfitBody.addEventListener("dragend", () => {
        draggedItemIdx = null;
        els.outfitBody.querySelectorAll(".zpe-outfit-item").forEach((el) => {
            el.classList.remove("zpe-is-dragging", "zpe-drag-top", "zpe-drag-bottom");
        });
    });

    // Remove piece (✕) in outfitBody
    els.outfitBody.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".zpe-outfit-item-remove");
        if (removeBtn) {
            const idx = Number(removeBtn.dataset.outfitIdx);
            const active = getActiveOutfit();
            if (!isNaN(idx) && active.items) {
                active.items.splice(idx, 1);
                saveCart();
                renderCartDrawer();
            }
            return;
        }
    });

    // Handle "+" clicks on product cards
    els.grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".zpe-btn-add-outfit");
        if (!btn) return;

        const cardId = Number(btn.dataset.cardId);
        const product = state.allProducts.find((p) => p.id === cardId);
        if (!product) return;

        const card = document.getElementById(`zpe-card-${cardId}`);
        const activeColorBadge = card?.querySelector(".zpe-card-active-color")?.textContent || product.colors[0]?.name || "";
        const activeImg = card?.querySelector(".zpe-card-img")?.src || product.image;
        const activePrice = Number(card?.querySelector(".zpe-card-price")?.textContent?.replace(/[^0-9.]/g, "")) || product.price;

        const activeOutfit = getActiveOutfit();
        if (!activeOutfit.items) activeOutfit.items = [];

        // Add to active outfit
        activeOutfit.items.push({
            id: product.id,
            name: product.name,
            color: activeColorBadge,
            image: activeImg,
            price: activePrice,
            url: product.url,
            family: product.family,
            materialsText: product.materialsText
        });

        saveCart();

        // Visual "+" to "✓" confirmation
        btn.textContent = "✓";
        btn.classList.add("added");
        setTimeout(() => {
            btn.textContent = "+";
            btn.classList.remove("added");
        }, 1000);

        if (state.isOutfitOpen) {
            renderCartDrawer();
        }
    });

    // Open active outfit items in new tabs
    els.outfitOpenAllBtn?.addEventListener("click", () => {
        const active = getActiveOutfit();
        if (!active.items || active.items.length === 0) return;
        for (const item of active.items) {
            window.open(item.url, "_blank", "noopener,noreferrer");
        }
    });

    // Copy active outfit links
    els.outfitCopyBtn?.addEventListener("click", () => {
        const active = getActiveOutfit();
        if (!active.items || active.items.length === 0) return;
        const subtotal = active.items.reduce((s, it) => s + (Number(it.price) || 0), 0);
        const text = [
            `${active.name.toUpperCase()} (Zara)`,
            ...active.items.map((item, i) => `${i + 1}. ${item.name} (${item.color}) - EGP ${item.price}: ${item.url}`),
            `Total: EGP ${subtotal.toLocaleString()}`
        ].join("\n");
        navigator.clipboard.writeText(text);
        els.outfitCopyBtn.textContent = "✓ Copied!";
        setTimeout(() => {
            els.outfitCopyBtn.textContent = "📋 Copy Links";
        }, 1500);
    });

    // Initialize cart badge on start
    updateCartBadge();

    /* ==========================================================================
       SCAN & FETCH ENGINE WITH SIBLING COLOR HYDRATION
       ========================================================================== */
    const startScan = async (categoryId, forceRefresh = false) => {
        if (state.abortController) {
            state.abortController.abort();
        }
        const abortController = new AbortController();
        state.abortController = abortController;
        state.categoryId = categoryId;
        els.categoryInput.value = String(categoryId);
        state.isScanning = true;
        els.scanBtn.textContent = "Stop";

        // Check category-level cache first for instant hydration
        if (!forceRefresh) {
            const cachedCategory = await cache.get("category_products", categoryId);
            if (cachedCategory && Array.isArray(cachedCategory.products) && cachedCategory.products.length > 0) {
                const isFresh = Date.now() - cachedCategory.savedAt < CACHE_TTL_CATEGORY_MS;
                state.allProducts = cachedCategory.products;
                window.zaraProducts = state.allProducts;
                state.totalCount = state.allProducts.length;
                state.scannedCount = state.allProducts.filter((p) => p.materialsLoaded).length;
                state.isFromCache = true;
                populateDynamicDropdowns();
                resetAndRenderGrid();

                // If completely scanned or fresh, load instantly with 0ms delay!
                if (state.scannedCount === state.totalCount || isFresh) {
                    state.isScanning = false;
                    els.scanBtn.textContent = "Load";
                    updateStatusText();
                    console.log(`[Zara Explorer] Loaded ${state.allProducts.length} items from IndexedDB Cache ⚡`);
                    return;
                }
            }
        }

        state.isFromCache = false;
        state.allProducts = [];
        window.zaraProducts = state.allProducts;
        state.scannedCount = 0;
        state.totalCount = 0;
        resetAndRenderGrid();

        try {
            const data = await fetchJson(
                `${state.baseUrl}/category/${categoryId}/products?ajax=true`,
                abortController.signal
            );

            const rawProducts = (data.productGroups ?? [])
                .flatMap((group) => group.elements ?? [])
                .flatMap((element) => element.commercialComponents ?? [])
                .filter(
                    (item) =>
                        item?.type === "Product" &&
                        item?.id &&
                        item?.seo?.keyword &&
                        item?.seo?.seoProductId
                );

            const uniqueProducts = Array.from(
                new Map(rawProducts.map((item) => [item.id, item])).values()
            );

            // ==================================================================
            // PASS 1: Build model color map across all sibling products
            // ==================================================================
            const modelColorMap = new Map(); // modelKey -> Map(colorNameLower -> colorData)
            for (const p of uniqueProducts) {
                const modelKey = (p.detail?.displayReference || p.seo?.keyword || p.name || "").trim().toLowerCase();
                if (!modelKey) continue;
                if (!modelColorMap.has(modelKey)) {
                    modelColorMap.set(modelKey, new Map());
                }
                const colorStore = modelColorMap.get(modelKey);
                const colors = extractProductColors(p);
                for (const c of colors) {
                    if (c.image && c.name) {
                        colorStore.set(c.name.toLowerCase(), c);
                    }
                }
            }

            // ==================================================================
            // PASS 2: Hydrate every product with full sibling colorways & photos
            // ==================================================================
            state.allProducts = uniqueProducts.map((product) => {
                const v1 = product.seo.discernProductId ?? product.id;
                const modelKey = (product.detail?.displayReference || product.seo?.keyword || product.name || "").trim().toLowerCase();
                const knownSiblingColors = modelColorMap.get(modelKey);

                // Build complete enriched color list
                const enrichedColors = [];
                const seenColorNames = new Set();

                // 1. Direct colors from detail.colors
                for (const c of extractProductColors(product)) {
                    seenColorNames.add(c.name.toLowerCase());
                    enrichedColors.push(c);
                }

                // 2. Cross-link colors from availableColors using sibling product images
                for (const ac of product.availableColors ?? []) {
                    const cName = (ac.colorName || "").trim();
                    const cKey = cName.toLowerCase();
                    if (!seenColorNames.has(cKey)) {
                        seenColorNames.add(cKey);
                        const siblingColor = knownSiblingColors?.get(cKey);
                        if (siblingColor) {
                            enrichedColors.push({
                                id: siblingColor.id,
                                name: cName,
                                hex: ac.hexColor || siblingColor.hex || "",
                                image: siblingColor.image,
                                secondaryImage: siblingColor.secondaryImage || siblingColor.image,
                                price: siblingColor.price || (product.price / 100),
                                availability: siblingColor.availability || "in_stock",
                                sizes: siblingColor.sizes || []
                            });
                        } else {
                            enrichedColors.push({
                                id: "",
                                name: cName,
                                hex: ac.hexColor || "",
                                image: "",
                                secondaryImage: "",
                                price: null,
                                availability: "in_stock",
                                sizes: []
                            });
                        }
                    }
                }

                const primaryImage = enrichedColors.find((c) => c.image)?.image || resolveMediaUrl(product.xmedia?.[0]);
                const secondaryImage = enrichedColors.find((c) => c.image)?.secondaryImage || resolveMediaUrl(product.xmedia?.[1]) || primaryImage;
                const price = typeof product.price === "number" ? product.price / 100 : Number(product.price) || 0;
                const oldPrice = typeof product.oldPrice === "number" ? product.oldPrice / 100 : null;
                const discountPct = (oldPrice && oldPrice > price)
                    ? Math.round(((oldPrice - price) / oldPrice) * 100)
                    : (product.displayDiscountPercentage || null);

                return {
                    id: product.id,
                    name: product.name ?? "",
                    price: price,
                    oldPrice: oldPrice,
                    discountPct: discountPct,
                    sectionName: product.sectionName ?? "",
                    family: product.familyName ?? "",
                    subfamily: product.subfamilyName ?? "",
                    availability: product.availability ?? "in_stock",
                    colors: enrichedColors,
                    sizes: extractProductSizes(product),
                    materialsLoaded: false,
                    materials: [],
                    materialsText: "",
                    materialBreakdown: {},
                    image: primaryImage,
                    secondaryImage: secondaryImage,
                    url: `${state.baseUrl}/${product.seo.keyword}-p${product.seo.seoProductId}.html?v1=${v1}&v2=${categoryId}`
                };
            });

            window.zaraProducts = state.allProducts;
            state.totalCount = state.allProducts.length;
            populateDynamicDropdowns();
            resetAndRenderGrid();

            // Hydrate already-cached material compositions
            const pendingFetch = [];
            for (const item of state.allProducts) {
                const cached = await cache.get("product_materials", item.id);
                if (cached && cached.materials && Date.now() - cached.savedAt < CACHE_TTL_MATERIALS_MS) {
                    item.materials = cached.materials;
                    item.materialsText = cached.materials.join(" | ");
                    item.materialBreakdown = parseMaterialBreakdown(cached.materials);
                    item.materialsLoaded = true;
                    state.scannedCount++;
                } else {
                    pendingFetch.push(item);
                }
            }

            if (state.scannedCount > 0) {
                resetAndRenderGrid();
            }

            // Concurrently fetch remaining uncached materials
            let fetchIndex = 0;
            const worker = async () => {
                while (fetchIndex < pendingFetch.length && !abortController.signal.aborted) {
                    const item = pendingFetch[fetchIndex++];
                    try {
                        const extraDetail = await fetchJson(
                            `${state.baseUrl}/product/${item.id}/extra-detail?ajax=true`,
                            abortController.signal
                        );

                        const sections = Array.isArray(extraDetail) ? extraDetail : [];
                        const materialsSection = sections.find(
                            (section) =>
                                section.sectionType === "materials" ||
                                section.sectionType === "composition" ||
                                section.sectionName === "composition"
                        );

                        const targetComponents =
                            materialsSection?.components ??
                            sections.flatMap((section) => section.components ?? []);

                        const materials = targetComponents
                            .map((comp) => comp.text?.value?.trim())
                            .filter(
                                (text) =>
                                    text &&
                                    !text.startsWith("We work with monitoring programs")
                            );

                        item.materials = materials;
                        item.materialsText = materials.join(" | ");
                        item.materialBreakdown = parseMaterialBreakdown(materials);
                        item.materialsLoaded = true;

                        // Save to persistent material cache
                        cache.set("product_materials", { id: item.id, materials });
                    } catch (err) {
                        if (abortController.signal.aborted) return;
                        item.materialsLoaded = true;
                    } finally {
                        if (!abortController.signal.aborted) {
                            state.scannedCount++;
                            if (
                                state.scannedCount % 12 === 0 ||
                                state.scannedCount === state.totalCount
                            ) {
                                resetAndRenderGrid();
                            } else {
                                updateStatusText();
                            }
                        }
                    }
                }
            };

            await Promise.all(
                Array.from(
                    { length: Math.min(CONCURRENCY, pendingFetch.length) },
                    () => worker()
                )
            );

            // Cache the full category dataset in IndexedDB
            if (!abortController.signal.aborted) {
                cache.set("category_products", {
                    categoryId,
                    products: state.allProducts,
                    totalCount: state.allProducts.length
                });
            }
        } catch (err) {
            if (!abortController.signal.aborted) {
                console.error("[Zara Explorer] Scan failed:", err);
                els.status.textContent = `Error: ${err.message}`;
            }
        } finally {
            if (state.abortController === abortController) {
                state.isScanning = false;
                els.scanBtn.textContent = "Load";
                resetAndRenderGrid();
                console.log(
                    `[Zara Explorer] Finished loading ${state.allProducts.length} items. Accessible via window.zaraProducts.`
                );
            }
        }
    };

    /* ==========================================================================
       MINIMIZE & VIEWPORT MANAGEMENT
       ========================================================================== */
    const setMinimized = (minimized) => {
        state.isMinimized = minimized;
        localStorage.setItem("zpe_minimized", String(minimized));
        if (minimized) {
            els.panel.style.display = "none";
            els.minimizedTab.style.display = "flex";
        } else {
            els.minimizedTab.style.display = "none";
            els.panel.style.display = "flex";
        }
    };

    const setViewMode = (mode) => {
        state.viewMode = mode;
        localStorage.setItem("zpe_view_mode", mode);
        els.panel.className = `zpe-mode-${mode}`;
        els.modeToggleBtn.textContent = mode === "drawer" ? "⛶ Maximize" : "◨ Dock Right";
        if (mode === "drawer") {
            els.panel.style.width = `${state.drawerWidth}px`;
        } else {
            els.panel.style.width = "";
        }
    };

    /* ==========================================================================
       RESIZING IN DRAWER MODE
       ========================================================================== */
    let isResizing = false;
    els.resizeHandle.addEventListener("mousedown", () => {
        if (state.viewMode !== "drawer") return;
        isResizing = true;
        els.resizeHandle.classList.add("active");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "ew-resize";
    });

    window.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const newWidth = Math.max(380, Math.min(window.innerWidth - 60, window.innerWidth - e.clientX));
        state.drawerWidth = newWidth;
        els.panel.style.width = `${newWidth}px`;
    });

    window.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            els.resizeHandle.classList.remove("active");
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
            localStorage.setItem("zpe_drawer_width", String(state.drawerWidth));
        }
    });

    /* ==========================================================================
       DRAGGABLE MINIMIZED TAB
       ========================================================================== */
    let isDraggingTab = false;
    let tabStartY = 0;
    let tabStartTop = 0;

    els.minimizedTab.addEventListener("mousedown", (e) => {
        isDraggingTab = false;
        tabStartY = e.clientY;
        const rect = els.minimizedTab.getBoundingClientRect();
        tabStartTop = rect.top;

        const onMouseMove = (moveEv) => {
            if (Math.abs(moveEv.clientY - tabStartY) > 5) {
                isDraggingTab = true;
            }
            if (isDraggingTab) {
                const newTop = Math.max(40, Math.min(window.innerHeight - 80, tabStartTop + (moveEv.clientY - tabStartY)));
                els.minimizedTab.style.top = `${newTop}px`;
                els.minimizedTab.style.transform = "none";
            }
        };

        const onMouseUp = () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    });

    els.minimizedTab.addEventListener("click", () => {
        if (!isDraggingTab) {
            setMinimized(false);
        }
    });

    /* ==========================================================================
       EVENT LISTENERS & FILTER CONTROLS
       ========================================================================== */
    let searchDebounceTimer = null;
    const onFilterChange = () => {
        state.filters.family = els.family.value;
        state.filters.subfamily = els.subfamily.value;
        state.filters.color = els.color.value;
        state.filters.material = els.material.value;
        state.filters.minMaterialPct = Number(els.minPct.value);
        state.filters.fabricType = els.fabricType.value;
        state.filters.size = els.size.value;
        state.filters.discount = els.discount.value;
        state.filters.availability = els.availability.value;
        state.filters.minPrice = els.minPrice.value;
        state.filters.maxPrice = els.maxPrice.value;
        state.filters.sortBy = els.sort.value;
        resetAndRenderGrid();
    };

    els.search.addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            state.filters.query = els.search.value;
            resetAndRenderGrid();
        }, 120);
    });

    els.family.addEventListener("change", onFilterChange);
    els.subfamily.addEventListener("change", onFilterChange);
    els.color.addEventListener("change", onFilterChange);
    els.material.addEventListener("change", onFilterChange);
    els.minPct.addEventListener("change", onFilterChange);
    els.fabricType.addEventListener("change", onFilterChange);
    els.size.addEventListener("change", onFilterChange);
    els.discount.addEventListener("change", onFilterChange);
    els.availability.addEventListener("change", onFilterChange);
    els.minPrice.addEventListener("input", onFilterChange);
    els.maxPrice.addEventListener("input", onFilterChange);
    els.sort.addEventListener("change", onFilterChange);

    els.resetBtn.addEventListener("click", () => {
        els.search.value = "";
        state.filters.query = "";
        els.family.value = "ALL";
        els.subfamily.value = "ALL";
        els.color.value = "ALL";
        els.material.value = "ALL";
        els.minPct.value = "0";
        els.fabricType.value = "ALL";
        els.size.value = "ALL";
        els.discount.value = "ALL";
        els.availability.value = "ALL";
        els.minPrice.value = "";
        els.maxPrice.value = "";
        els.sort.value = "material-desc";
        onFilterChange();
    });

    els.catalogSection.addEventListener("change", () => {
        populateCatalogCategorySelect(Number(els.catalogSection.value));
    });

    els.catalogCategory.addEventListener("change", () => {
        const chosenId = Number(els.catalogCategory.value);
        if (chosenId) {
            els.categoryInput.value = String(chosenId);
            startScan(chosenId);
        }
    });

    els.scanBtn.addEventListener("click", () => {
        if (state.isScanning) {
            state.abortController?.abort();
            state.isScanning = false;
            els.scanBtn.textContent = "Load";
            resetAndRenderGrid();
        } else {
            const catId = Number(els.categoryInput.value) || DEFAULT_CATEGORY_ID;
            startScan(catId);
        }
    });

    els.reloadBtn.addEventListener("click", () => {
        const catId = Number(els.categoryInput.value) || DEFAULT_CATEGORY_ID;
        startScan(catId, true);
    });

    els.modeToggleBtn.addEventListener("click", () => {
        setViewMode(state.viewMode === "drawer" ? "fullscreen" : "drawer");
    });

    els.minBtn.addEventListener("click", () => {
        setMinimized(true);
    });

    els.closeBtn.addEventListener("click", () => {
        state.abortController?.abort();
        root.remove();
    });

    els.exportBtn.addEventListener("click", () => {
        const exportData = state.filteredProducts.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            oldPrice: p.oldPrice,
            discountPct: p.discountPct,
            section: p.sectionName,
            family: p.family,
            subfamily: p.subfamily,
            availability: p.availability,
            sizes: p.sizes,
            colors: p.colors.map((c) => c.name),
            materials: p.materials,
            materialBreakdown: p.materialBreakdown,
            url: p.url,
            image: p.image
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `zara-filtered-${state.categoryId}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Keyboard Shortcut: Alt + Z to toggle minimize/open
    window.addEventListener("keydown", (e) => {
        if (e.altKey && (e.key === "z" || e.key === "Z")) {
            e.preventDefault();
            setMinimized(!state.isMinimized);
        } else if (e.key === "Escape" && !state.isMinimized) {
            setMinimized(true);
        }
    });

    /* ==========================================================================
       BOOTSTRAP & INITIAL SCAN
       ========================================================================== */
    await loadCatalogTree();
    await startScan(state.categoryId);
})();
