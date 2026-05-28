/* =============================================================================
 * NovaScotiaVoyage — single-page-app shell + interactive map.
 * Tabs (Home / Map / Discover / Planner) share a single Mapbox instance that
 * is moved between view containers so we never re-init Mapbox on tab switch.
 * ============================================================================= */
(function () {
  "use strict";

  var DATA = window.VOYAGER_DATA;
  var POIS = window.VOYAGER_POIS;
  if (!DATA || !POIS) {
    showError(
      "Voyager data missing",
      "Could not load /map/data.js or /map/pois.js. Hard reload (Ctrl+Shift+R)."
    );
    return;
  }

  enrichPOIs();

  var els = {
    counterStrip:    document.getElementById("counter-strip"),
    counterText:     document.getElementById("counter-text"),
    themeToggle:     document.getElementById("theme-toggle"),
    homeSearchForm:  document.getElementById("home-search-form"),
    homeSearch:      document.getElementById("home-search"),
    popularChips:    document.getElementById("popular-chips"),
    statExperiences: document.getElementById("stat-experiences"),
    statRegions:     document.getElementById("stat-regions"),
    statCategories:  document.getElementById("stat-categories"),
    hotZones:        document.getElementById("hot-zones-grid"),
    mapPoiPanel:     document.getElementById("map-poi-panel"),
    mapPoiEmpty:     document.getElementById("map-poi-empty"),
    mapCardsGrid:    document.getElementById("map-cards-grid"),
    themeBar:        document.getElementById("theme-bar"),
    discoverSearch:  document.getElementById("discover-search"),
    activityChips:   document.getElementById("activity-chips"),
    regionChips:     document.getElementById("region-chips"),
    browseList:      document.getElementById("browse-theme-list"),
    hiddenSwitch:    document.getElementById("hidden-gem-switch"),
    hiddenToggle:    document.getElementById("hidden-gem-toggle"),
    verifiedSwitch:  document.getElementById("verified-switch"),
    verifiedToggle:  document.getElementById("verified-toggle"),
    discoverCards:   document.getElementById("discover-cards-grid"),
    discoverEmpty:   document.getElementById("discover-empty"),
    discoverMapBox:  document.getElementById("discover-map-box"),
    discoverMapSwitch: document.getElementById("discover-map-switch"),
    discoverMapToggle: document.getElementById("discover-map-toggle"),
    resultsCount:    document.getElementById("results-count"),
    resetFilters:    document.getElementById("reset-filters"),
    poiModal:        document.getElementById("poi-modal"),
    poiModalBody:    document.getElementById("poi-modal-body"),
    poiModalClose:   document.getElementById("poi-modal-close"),
    hoverCard:       document.getElementById("hover-card"),
    boot:            document.getElementById("voyager-boot"),
    error:           document.getElementById("voyager-error"),
    errorTitle:      document.getElementById("voyager-error-title"),
    errorMsg:        document.getElementById("voyager-error-msg"),
    voyagerMap:      document.getElementById("voyager-map"),
    layerHeatMap:    document.getElementById("layer-heat-map"),
    layerPoisMap:    document.getElementById("layer-pois-map"),
    layerRegionsMap: document.getElementById("layer-regions-map"),
    layerHeatDisc:   document.getElementById("layer-heat-disc"),
    layerPoisDisc:   document.getElementById("layer-pois-disc"),
    layerRegionsDisc:document.getElementById("layer-regions-disc")
  };

  var state = {
    view: null,
    showHeatmap: true,
    showPOIs: true,
    showRegions: true,
    selectedRegion: null,
    activeCategory: null,
    hiddenOnly: false,
    verifiedOnly: false,
    searchQuery: "",
    selectedPOI: null,
    discoverMapVisible: true,
    map: null,
    mapLoaded: false,
    mapReady: false,
    poisIndex: new Map()
  };

  POIS.forEach(function (p) { state.poisIndex.set(p.id, p); });

  initShell();
  initView();
  loadMap().catch(function (err) {
    console.error("[voyager] boot failed", err);
    showError("Voyager could not start", "Map failed to initialize: " + (err && err.message ? err.message : err));
  });
  loadDiscoveredPOIs(); // background fetch — merges scraped data once available

  function loadDiscoveredPOIs() {
    fetch("/api/voyager/pois", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) {
          console.warn("[voyager] /api/voyager/pois returned HTTP", r.status);
          return null;
        }
        return r.json();
      })
      .then(function (payload) {
        if (!payload) return;
        if (!Array.isArray(payload.pois)) {
          console.warn("[voyager] /api/voyager/pois payload missing pois[]");
          return;
        }
        if (payload.pois.length === 0) {
          console.warn("[voyager] /api/voyager/pois returned 0 records");
          return;
        }
        var keyOf = function (p) {
          return String(p.name || "").toLowerCase().replace(/\s+/g, " ").trim();
        };
        var curatedKeys = new Set(POIS.map(keyOf));
        var added = 0;
        payload.pois.forEach(function (p) {
          if (!p || !p.id || !Array.isArray(p.coordinates)) return;
          if (curatedKeys.has(keyOf(p))) return;     // curated wins
          if (state.poisIndex.has(p.id)) return;      // already merged
          POIS.push(p);
          state.poisIndex.set(p.id, p);
          added++;
        });
        if (!added) return;
        console.log("[voyager] merged", added, "discovered POIs (" + payload.attribution + ")");
        if (els.statExperiences) els.statExperiences.textContent = String(POIS.length) + "+";
        if (els.counterText)     els.counterText.textContent     = POIS.length + " experiences across Nova Scotia";
        if (state.mapLoaded) syncFilteredData();
        if (state.view === "discover") {
          renderDiscoverCards();
          renderActivityChips();
          renderRegionChips();
          renderBrowseList();
          updateResultsCount();
        } else if (state.view === "map") {
          renderMapCards();
          renderThemeBar();
        } else if (state.view === "home") {
          renderHotZones();
        }
      })
      .catch(function (err) {
        console.warn("[voyager] discovered POIs unavailable:", err && err.message);
      });
  }

  /* =====================================================================
   * SHELL — header tabs, theme toggle, counter, home search, browse list
   * ===================================================================== */
  function initShell() {
    document.querySelectorAll(".nsv-tab").forEach(function (a) {
      a.addEventListener("click", function (e) {
        var view = a.getAttribute("data-view");
        if (view) {
          e.preventDefault();
          setView(view);
        }
      });
    });
    window.addEventListener("hashchange", function () {
      setView(parseHash());
    });

    var stored = null;
    try { stored = localStorage.getItem("nsv-theme"); } catch (_) {}
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
    if (els.themeToggle) {
      els.themeToggle.addEventListener("click", function () {
        var current = document.documentElement.getAttribute("data-theme") || "dark";
        var next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem("nsv-theme", next); } catch (_) {}
      });
    }

    if (els.homeSearchForm) {
      els.homeSearchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = (els.homeSearch && els.homeSearch.value || "").trim();
        state.searchQuery = q;
        if (els.discoverSearch) els.discoverSearch.value = q;
        setView("discover");
      });
    }
    if (els.popularChips) {
      els.popularChips.querySelectorAll(".popular-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var q = chip.getAttribute("data-q") || chip.textContent.trim();
          if (els.homeSearch) els.homeSearch.value = q;
          state.searchQuery = q;
          if (els.discoverSearch) els.discoverSearch.value = q;
          setView("discover");
        });
      });
    }

    if (els.statExperiences) els.statExperiences.textContent = String(POIS.length) + "+";
    if (els.statRegions)     els.statRegions.textContent     = String(DATA.regions.length);
    if (els.statCategories)  els.statCategories.textContent  = String(Object.keys(DATA.categoryLabels).length);
    if (els.counterText)     els.counterText.textContent     = POIS.length + " experiences across Nova Scotia";

    renderHotZones();
    renderActivityChips();
    renderRegionChips();
    renderBrowseList();
    renderThemeBar();
    bindDiscoverFilters();
    bindMapViewLayers();
    bindModalDismiss();
  }

  function bindModalDismiss() {
    if (!els.poiModal) return;
    els.poiModal.querySelectorAll("[data-modal-close]").forEach(function (n) {
      n.addEventListener("click", closeModal);
    });
    if (els.poiModalClose) els.poiModalClose.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function closeModal() {
    if (els.poiModal) {
      els.poiModal.classList.remove("is-open");
      els.poiModal.setAttribute("aria-hidden", "true");
    }
  }

  /* =====================================================================
   * VIEW ROUTER
   * ===================================================================== */
  function parseHash() {
    var h = (window.location.hash || "").replace(/^#/, "").trim();
    if (h === "home" || h === "map" || h === "discover" || h === "planner") return h;
    return "home";
  }

  function initView() {
    setView(parseHash(), { replaceHash: true });
  }

  function setView(view, opts) {
    if (!view) view = "home";
    if (state.view === view) return;
    state.view = view;

    document.querySelectorAll(".nsv-view").forEach(function (v) {
      v.classList.toggle("is-active", v.getAttribute("data-view") === view);
    });
    document.querySelectorAll(".nsv-tab").forEach(function (a) {
      a.classList.toggle("is-active", a.getAttribute("data-view") === view);
    });
    if (els.counterStrip) {
      els.counterStrip.style.display = (view === "home" || view === "planner") ? "none" : "flex";
    }

    var target = (opts && opts.replaceHash ? null : "#" + view);
    if (target && window.location.hash !== target) {
      try { window.history.replaceState({}, "", target); } catch (_) {}
    } else if (opts && opts.replaceHash) {
      try { window.history.replaceState({}, "", "#" + view); } catch (_) {}
    }

    moveMapForView(view);

    if (view === "discover") {
      applyFilters();
    } else if (view === "map") {
      renderThemeBar();
      renderMapCards();
    }

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* =====================================================================
   * MAP — shared instance moved between view containers
   * ===================================================================== */
  function moveMapForView(view) {
    if (!els.voyagerMap) return;
    var slot = null;
    if (view === "map") slot = document.querySelector('.view-map [data-map-slot="map"]');
    else if (view === "discover") slot = document.querySelector('.view-discover [data-map-slot="discover"]');

    if (slot && els.voyagerMap.parentNode !== slot) {
      slot.appendChild(els.voyagerMap);
      els.voyagerMap.removeAttribute("data-parked");
    } else if (!slot && els.voyagerMap.parentNode !== document.body) {
      document.body.appendChild(els.voyagerMap);
      els.voyagerMap.setAttribute("data-parked", "true");
    } else if (!slot) {
      els.voyagerMap.setAttribute("data-parked", "true");
    } else {
      els.voyagerMap.removeAttribute("data-parked");
    }
    if (state.map && state.mapLoaded) {
      window.requestAnimationFrame(function () {
        try { state.map.resize(); } catch (_) {}
      });
    }
  }

  async function loadMap() {
    var token = await fetchMapboxToken();
    if (!token) {
      showError(
        "Mapbox token missing",
        "Set MAPBOX_ACCESS_TOKEN in your server environment. The /api/voyager/config endpoint is returning an empty token."
      );
      return;
    }
    if (!window.mapboxgl) {
      showError("Mapbox library missing", "mapbox-gl-js could not be loaded from the CDN.");
      return;
    }

    moveMapForView(state.view);

    window.mapboxgl.accessToken = token;
    var map = new window.mapboxgl.Map({
      container: els.voyagerMap,
      style: DATA.mapboxStyle,
      center: DATA.defaultCenter,
      zoom: DATA.defaultZoom,
      maxBounds: [
        [DATA.bounds[0][0] - 1, DATA.bounds[0][1] - 1],
        [DATA.bounds[1][0] + 1, DATA.bounds[1][1] + 1]
      ],
      attributionControl: false
    });
    map.addControl(new window.mapboxgl.NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new window.mapboxgl.AttributionControl({ compact: true }), "bottom-left");
    state.map = map;

    map.on("load", function () {
      installSourcesAndLayers(map);
      bindMapInteractions(map);
      map.fitBounds(DATA.bounds, { padding: 60, duration: 0 });
      state.mapLoaded = true;
      state.mapReady = true;
      hideBoot();
      try { map.resize(); } catch (_) {}
    });
    map.on("error", function (e) {
      var msg = e && e.error ? e.error.message : (e && e.message ? e.message : null);
      if (msg) console.warn("[voyager] map error:", msg);
    });
  }

  async function fetchMapboxToken() {
    try {
      var res = await fetch("/api/voyager/config", { credentials: "same-origin" });
      if (res.ok) {
        var json = await res.json();
        if (json && json.mapboxToken) return json.mapboxToken;
      }
    } catch (e) {
      console.warn("[voyager] /api/voyager/config not reachable:", e && e.message);
    }
    if (window.VOYAGER_PUBLIC_TOKEN) return window.VOYAGER_PUBLIC_TOKEN;
    return null;
  }

  function enrichPOIs() {
    var overrides = DATA.linkOverrides || {};
    POIS.forEach(function (poi) {
      var o = overrides[poi.id];
      if (!o) return;
      if (poi.websiteUrl == null && o.websiteUrl) poi.websiteUrl = o.websiteUrl;
      if (poi.instagramUrl == null && o.instagramUrl) poi.instagramUrl = o.instagramUrl;
      if (poi.facebookUrl == null && o.facebookUrl) poi.facebookUrl = o.facebookUrl;
      if (poi.bookingUrl == null && o.bookingUrl) poi.bookingUrl = o.bookingUrl;
    });
  }

  /* =====================================================================
   * MAP SOURCES + LAYERS
   * ===================================================================== */
  function buildPoisGeoJSON(poiList) {
    return {
      type: "FeatureCollection",
      features: poiList.map(function (poi) {
        return {
          type: "Feature",
          id: poi.id,
          properties: {
            id: poi.id, name: poi.name, category: poi.category,
            regionId: poi.regionId, rating: poi.rating, priceRange: poi.priceRange
          },
          geometry: { type: "Point", coordinates: poi.coordinates }
        };
      })
    };
  }

  function pseudoRandom(seed) {
    var x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function generateClusterPoints(center, regionId, count, baseWeight, seedOffset) {
    var pts = [];
    for (var i = 0; i < count; i++) {
      var r1 = pseudoRandom(seedOffset + i * 2);
      var r2 = pseudoRandom(seedOffset + i * 2 + 1);
      var r3 = pseudoRandom(seedOffset + i * 3);
      pts.push({
        coordinates: [center[0] + (r1 - 0.5) * 0.15, center[1] + (r2 - 0.5) * 0.12],
        weight: baseWeight * (0.4 + r3 * 0.6),
        regionId: regionId
      });
    }
    return pts;
  }
  function buildHeatGeoJSON(poiList) {
    var clusterPoints = [];
    DATA.heatClusterCenters.forEach(function (cc, idx) {
      clusterPoints = clusterPoints.concat(
        generateClusterPoints(cc.center, cc.regionId, cc.count, cc.weight, idx * 100)
      );
    });
    var poiHeat = poiList.map(function (poi) {
      return { coordinates: poi.coordinates, weight: poi.rating / 5, regionId: poi.regionId };
    });
    var allPoints = clusterPoints.concat(poiHeat);
    var regionIds = new Set(poiList.map(function (p) { return p.regionId; }));
    var filtered = allPoints.filter(function (p) { return regionIds.has(p.regionId); });
    return {
      type: "FeatureCollection",
      features: filtered.map(function (pt, idx) {
        return {
          type: "Feature",
          properties: { weight: pt.weight, regionId: pt.regionId, id: "heat-" + idx },
          geometry: { type: "Point", coordinates: pt.coordinates }
        };
      })
    };
  }

  function buildCategoryMatchExpression() {
    var pairs = [];
    Object.keys(DATA.categoryColors).forEach(function (cat) {
      pairs.push(cat, DATA.categoryColors[cat]);
    });
    return ["match", ["get", "category"]].concat(pairs).concat(["#06b6d4"]);
  }

  function installSourcesAndLayers(map) {
    var poisFc = buildPoisGeoJSON(getFilteredPOIs());
    var heatFc = buildHeatGeoJSON(getFilteredPOIs());

    map.addSource("regions", { type: "geojson", data: DATA.regionsGeoJSON, promoteId: "id" });
    map.addSource("heat",    { type: "geojson", data: heatFc });
    map.addSource("pois",    { type: "geojson", data: poisFc, promoteId: "id" });

    map.addLayer({
      id: "regions-fill", type: "fill", source: "regions",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 0.35,
          ["boolean", ["feature-state", "hover"], false], 0.25,
          0.08
        ]
      }
    });
    map.addLayer({
      id: "regions-outline", type: "line", source: "regions",
      paint: {
        "line-color": ["get", "color"],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2.5,
          ["boolean", ["feature-state", "hover"], false], 2,
          1
        ],
        "line-opacity": 0.8
      }
    });
    map.addLayer({
      id: "heatmap", type: "heatmap", source: "heat",
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 9, 2],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0,   "rgba(6, 78, 120, 0)",
          0.2, "rgba(14, 116, 144, 0.5)",
          0.4, "rgba(20, 184, 166, 0.6)",
          0.6, "rgba(249, 115, 22, 0.7)",
          0.8, "rgba(239, 68, 68, 0.75)",
          1,   "rgba(255, 255, 255, 0.85)"
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 9, 24],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.35]
      }
    });

    var catExpr = buildCategoryMatchExpression();
    map.addLayer({
      id: "poi-markers", type: "circle", source: "pois",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 8, 11, 12, 14],
        "circle-color": catExpr,
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 1,
        "circle-pitch-alignment": "map"
      }
    });
    map.addLayer({
      id: "poi-hit-area", type: "circle", source: "pois",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 18, 12, 26],
        "circle-opacity": 0
      }
    });
  }

  function bindMapInteractions(map) {
    var hoveredRegionId = null;
    var hoveredPoiId = null;

    map.on("click", "regions-fill", function (e) {
      if (!e.features || !e.features[0]) return;
      var rid = e.features[0].properties.id;
      selectRegion(state.selectedRegion === rid ? null : rid);
    });

    map.on("mousemove", "regions-fill", function (e) {
      if (!e.features || !e.features[0]) return;
      var rid = e.features[0].properties.id;
      if (hoveredRegionId !== rid) {
        if (hoveredRegionId) map.setFeatureState({ source: "regions", id: hoveredRegionId }, { hover: false });
        hoveredRegionId = rid;
        map.setFeatureState({ source: "regions", id: rid }, { hover: true });
      }
    });
    map.on("mouseleave", "regions-fill", function () {
      if (hoveredRegionId) map.setFeatureState({ source: "regions", id: hoveredRegionId }, { hover: false });
      hoveredRegionId = null;
    });
    map.on("mouseenter", "regions-fill", function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "regions-fill", function () { if (!state.selectedPOI) map.getCanvas().style.cursor = ""; });

    var POI_LAYER = "poi-hit-area";
    map.on("click", POI_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (!f) return;
      var poi = state.poisIndex.get(f.properties.id);
      if (poi) selectPOI(poi);
    });
    map.on("mouseenter", POI_LAYER, function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", POI_LAYER, function () {
      map.getCanvas().style.cursor = "";
      hoveredPoiId = null;
      hideHoverCard();
    });
    map.on("mousemove", POI_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (!f) return;
      var pid = f.properties.id;
      if (hoveredPoiId !== pid) {
        hoveredPoiId = pid;
        var poi = state.poisIndex.get(pid);
        if (poi) showHoverCard(poi, e.originalEvent);
      }
    });
  }

  /* =====================================================================
   * LAYER TOGGLES — bind both Map view + Discover view layer panels
   * ===================================================================== */
  function bindMapViewLayers() {
    bindLayerRow(els.layerHeatMap,    "showHeatmap");
    bindLayerRow(els.layerPoisMap,    "showPOIs");
    bindLayerRow(els.layerRegionsMap, "showRegions");
    bindLayerRow(els.layerHeatDisc,    "showHeatmap");
    bindLayerRow(els.layerPoisDisc,    "showPOIs");
    bindLayerRow(els.layerRegionsDisc, "showRegions");
    syncAllLayerToggles();
  }
  function bindLayerRow(rowEl, key) {
    if (!rowEl) return;
    function activate() {
      state[key] = !state[key];
      syncAllLayerToggles();
      applyLayerVisibility();
    }
    rowEl.addEventListener("click", activate);
    rowEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
    });
  }
  function syncAllLayerToggles() {
    [els.layerHeatMap, els.layerHeatDisc].forEach(function (n) { syncToggle(n, state.showHeatmap); });
    [els.layerPoisMap, els.layerPoisDisc].forEach(function (n) { syncToggle(n, state.showPOIs); });
    [els.layerRegionsMap, els.layerRegionsDisc].forEach(function (n) { syncToggle(n, state.showRegions); });
  }
  function syncToggle(rowEl, on) {
    if (!rowEl) return;
    var t = rowEl.querySelector(".toggle");
    if (t) t.setAttribute("data-on", on ? "true" : "false");
  }
  function applyLayerVisibility() {
    var map = state.map;
    if (!map || !state.mapLoaded) return;
    var v = function (b) { return b ? "visible" : "none"; };
    if (map.getLayer("heatmap")) map.setLayoutProperty("heatmap", "visibility", v(state.showHeatmap));
    if (map.getLayer("poi-markers")) map.setLayoutProperty("poi-markers", "visibility", v(state.showPOIs));
    if (map.getLayer("poi-hit-area")) map.setLayoutProperty("poi-hit-area", "visibility", v(state.showPOIs));
    if (map.getLayer("regions-fill")) map.setLayoutProperty("regions-fill", "visibility", v(state.showRegions));
    if (map.getLayer("regions-outline")) map.setLayoutProperty("regions-outline", "visibility", v(state.showRegions));
  }

  /* =====================================================================
   * FILTER STATE
   * ===================================================================== */
  function getFilteredPOIs() {
    var q = (state.searchQuery || "").toLowerCase().trim();
    return POIS.filter(function (poi) {
      if (state.selectedRegion && poi.regionId !== state.selectedRegion) return false;
      if (state.activeCategory && poi.category !== state.activeCategory) return false;
      if (state.hiddenOnly && !poi.isHiddenGem) return false;
      if (state.verifiedOnly && !poi.websiteUrl && !poi.bookingUrl) return false;
      if (q) {
        var hay = (poi.name + " " + (poi.description || "") + " " + (poi.tags || []).join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function applyFilters() {
    syncFilteredData();
    renderActivityChips();
    renderRegionChips();
    renderBrowseList();
    renderThemeBar();
    renderDiscoverCards();
    renderMapCards();
    updateResultsCount();
  }

  function syncFilteredData() {
    var map = state.map;
    if (!map || !state.mapLoaded) return;
    var filtered = getFilteredPOIs();
    var poisSrc = map.getSource("pois");
    var heatSrc = map.getSource("heat");
    if (poisSrc) poisSrc.setData(buildPoisGeoJSON(filtered));
    if (heatSrc) heatSrc.setData(buildHeatGeoJSON(filtered));
  }

  function updateResultsCount() {
    var n = getFilteredPOIs().length;
    if (els.resultsCount) els.resultsCount.textContent = String(n);
    if (els.discoverEmpty) els.discoverEmpty.classList.toggle("hidden", n > 0);
  }

  /* =====================================================================
   * RENDER — chips, lists, cards
   * ===================================================================== */
  function renderHotZones() {
    if (!els.hotZones) return;
    var html = DATA.regions.map(function (r) {
      var count = countPOIsByRegion(r.id);
      return (
        '<a class="hot-zone" href="#map" data-region="' + r.id + '" style="--zone-color:' + r.color + '">' +
          '<div class="zone-name"><span class="zone-swatch"></span>' + escapeHtml(r.name) + '</div>' +
          '<div class="zone-tag">' + escapeHtml(r.tagline) + '</div>' +
          '<div class="zone-meta"><span><strong>' + count + '</strong>experiences</span></div>' +
        '</a>'
      );
    }).join("");
    els.hotZones.innerHTML = html;
    els.hotZones.querySelectorAll(".hot-zone").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var rid = a.getAttribute("data-region");
        state.selectedRegion = rid;
        applyFilters();
        flyToRegion(rid);
        setView("map");
      });
    });
  }

  function renderActivityChips() {
    if (!els.activityChips) return;
    var labels = DATA.categoryLabels;
    var counts = computeCategoryCounts();
    var parts = [
      '<button type="button" class="chip" data-cat="" data-active="' + (state.activeCategory ? "false" : "true") + '">All</button>'
    ];
    Object.keys(labels).forEach(function (cat) {
      var color = DATA.categoryColors[cat];
      var active = state.activeCategory === cat;
      var n = counts[cat] || 0;
      parts.push(
        '<button type="button" class="chip" data-cat="' + cat + '" data-cat-color="" data-active="' + (active ? "true" : "false") + '" style="--cat-color:' + color + '">' +
          escapeHtml(labels[cat]) + (n ? ' <span class="chip-count">' + n + '</span>' : '') +
        '</button>'
      );
    });
    els.activityChips.innerHTML = parts.join("");
    els.activityChips.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-cat") || "";
        state.activeCategory = c || null;
        applyFilters();
      });
    });
  }

  function renderRegionChips() {
    if (!els.regionChips) return;
    var parts = [
      '<button type="button" class="chip" data-region="" data-active="' + (state.selectedRegion ? "false" : "true") + '">All</button>'
    ];
    DATA.regions.forEach(function (r) {
      var active = state.selectedRegion === r.id;
      parts.push(
        '<button type="button" class="chip" data-region="' + r.id + '" data-active="' + (active ? "true" : "false") + '" style="--cat-color:' + r.color + '">' +
          escapeHtml(shortRegionName(r.name)) +
        '</button>'
      );
    });
    els.regionChips.innerHTML = parts.join("");
    els.regionChips.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var rid = b.getAttribute("data-region") || "";
        state.selectedRegion = rid || null;
        applyFilters();
        if (rid) flyToRegion(rid);
        else if (state.map && state.mapLoaded) state.map.fitBounds(DATA.bounds, { padding: 60, duration: 900 });
      });
    });
  }
  function shortRegionName(name) {
    if (!name) return "";
    if (/halifax/i.test(name)) return "Halifax";
    if (/south/i.test(name)) return "South";
    if (/annapolis/i.test(name)) return "Annapolis";
    if (/fundy/i.test(name)) return "Bay";
    if (/eastern/i.test(name)) return "Eastern";
    if (/cape/i.test(name)) return "Cape";
    if (/yarmouth/i.test(name)) return "Yarmouth";
    return name.split(/\s+/)[0];
  }

  function renderBrowseList() {
    if (!els.browseList) return;
    var counts = computeCategoryCounts();
    var entries = Object.keys(DATA.categoryLabels).map(function (cat) {
      return { cat: cat, label: DATA.categoryLabels[cat], color: DATA.categoryColors[cat], count: counts[cat] || 0 };
    });
    entries.sort(function (a, b) { return b.count - a.count; });
    els.browseList.innerHTML = entries.map(function (e) {
      var active = state.activeCategory === e.cat;
      return (
        '<li><button type="button" class="theme-item" data-cat="' + e.cat + '" data-active="' + (active ? "true" : "false") + '" style="--cat-color:' + e.color + '">' +
          '<span class="name"><span class="swatch"></span>' + escapeHtml(e.label) + '</span>' +
          '<span class="count">' + e.count + '</span>' +
        '</button></li>'
      );
    }).join("");
    els.browseList.querySelectorAll(".theme-item").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-cat");
        state.activeCategory = state.activeCategory === c ? null : c;
        applyFilters();
      });
    });
  }

  function renderThemeBar() {
    if (!els.themeBar) return;
    var counts = computeCategoryCounts();
    var entries = Object.keys(DATA.categoryLabels).map(function (cat) {
      return { cat: cat, label: DATA.categoryLabels[cat], color: DATA.categoryColors[cat], icon: DATA.categoryIcons[cat] || "", count: counts[cat] || 0 };
    });
    var html = '<button type="button" class="category-pill" data-cat="" data-active="' + (state.activeCategory ? "false" : "true") + '"><span>All</span></button>';
    html += entries.map(function (e) {
      var active = state.activeCategory === e.cat;
      return (
        '<button type="button" class="category-pill" data-cat="' + e.cat + '" data-active="' + (active ? "true" : "false") + '" style="--cat-color:' + e.color + '">' +
          '<span class="icon">' + e.icon + '</span>' +
          '<span>' + escapeHtml(e.label) + '</span>' +
          '<span class="count">' + e.count + '</span>' +
        '</button>'
      );
    }).join("");
    els.themeBar.innerHTML = html;
    els.themeBar.querySelectorAll(".category-pill").forEach(function (b) {
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-cat") || "";
        state.activeCategory = c || null;
        applyFilters();
      });
    });
  }

  function computeCategoryCounts() {
    var src = POIS.filter(function (p) {
      if (state.selectedRegion && p.regionId !== state.selectedRegion) return false;
      if (state.hiddenOnly && !p.isHiddenGem) return false;
      var q = (state.searchQuery || "").toLowerCase().trim();
      if (q) {
        var hay = (p.name + " " + (p.description || "") + " " + (p.tags || []).join(" ")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var counts = {};
    src.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    return counts;
  }

  function countPOIsByRegion(rid) {
    return POIS.filter(function (p) { return p.regionId === rid; }).length;
  }

  /* =====================================================================
   * CARD GRIDS — Map view + Discover view
   * ===================================================================== */
  function renderMapCards() {
    if (!els.mapCardsGrid) return;
    var list = getFilteredPOIs().slice(0, 18);
    els.mapCardsGrid.innerHTML = list.map(buildPoiCard).join("");
    bindCardClicks(els.mapCardsGrid);
  }

  function renderDiscoverCards() {
    if (!els.discoverCards) return;
    var list = getFilteredPOIs();
    els.discoverCards.innerHTML = list.map(buildPoiCard).join("");
    bindCardClicks(els.discoverCards);
  }

  function buildPoiCard(poi) {
    var color = DATA.categoryColors[poi.category] || "#14b8a6";
    var icon = DATA.categoryIcons[poi.category] || "";
    var label = DATA.categoryLabels[poi.category] || poi.category;
    var tags = (poi.tags || []).slice(0, 3).map(function (t) {
      return '<span class="tag">' + escapeHtml(t) + '</span>';
    }).join("");
    var hasRating = poi.rating != null && poi.rating !== "";
    return (
      '<button type="button" class="poi-card" data-id="' + poi.id + '" style="--cat-color:' + color + '">' +
        '<span class="badge">' + icon + ' ' + escapeHtml(label) + '</span>' +
        '<div class="title">' + escapeHtml(poi.name) + '</div>' +
        '<div class="desc">' + escapeHtml(poi.description || "") + '</div>' +
        '<div class="meta">' +
          (hasRating ? '<span class="star">★ ' + poi.rating + '</span>' : "") +
          (hasRating && poi.reviewCount ? '<span>(' + formatCount(poi.reviewCount) + ' reviews)</span>' : "") +
          (hasRating && poi.priceRange ? '<span>·</span>' : "") +
          priceHtml(poi.priceRange) +
        '</div>' +
        '<div class="tags">' + tags + '</div>' +
      '</button>'
    );
  }

  function bindCardClicks(root) {
    root.querySelectorAll(".poi-card").forEach(function (c) {
      c.addEventListener("click", function () {
        var poi = state.poisIndex.get(c.getAttribute("data-id"));
        if (!poi) return;
        if (state.view === "map") {
          selectPOI(poi);
        } else {
          renderPoiModal(poi);
          if (state.map && state.mapLoaded) {
            state.map.flyTo({ center: poi.coordinates, zoom: 11, duration: 900, essential: true });
          }
        }
      });
    });
  }

  function isFreePrice(p) { return /^free$/i.test(String(p || "")); }
  function priceHtml(price) {
    if (!price) return "";
    return '<span class="price' + (isFreePrice(price) ? ' is-free' : '') + '">' + escapeHtml(price) + '</span>';
  }

  function formatCount(n) {
    if (!n) return "0";
    if (n >= 10000) return (Math.round(n / 100) / 10).toFixed(1) + "k";
    if (n >= 1000) return (Math.round(n / 100) / 10).toFixed(1) + "k";
    return String(n);
  }

  /* =====================================================================
   * SELECTION + DETAIL PANEL + MODAL
   * ===================================================================== */
  function selectRegion(rid) {
    state.selectedRegion = rid;
    if (state.map && state.mapLoaded) {
      DATA.regionsGeoJSON.features.forEach(function (f) {
        var id = f.properties.id;
        state.map.setFeatureState({ source: "regions", id: id }, { selected: id === rid });
      });
      if (rid) flyToRegion(rid);
      else state.map.fitBounds(DATA.bounds, { padding: 60, duration: 900 });
    }
    applyFilters();
  }

  function flyToRegion(rid) {
    if (!state.map || !state.mapLoaded) return;
    var r = DATA.regions.find(function (x) { return x.id === rid; });
    if (r) state.map.flyTo({ center: r.center, zoom: r.zoom, duration: 1100, essential: true });
  }

  function selectPOI(poi) {
    state.selectedPOI = poi;
    if (state.view === "map") {
      renderPoiDetailPanel(poi);
    } else {
      renderPoiModal(poi);
    }
    if (state.map && state.mapLoaded) {
      state.map.flyTo({ center: poi.coordinates, zoom: 11, duration: 900, essential: true });
    }
  }

  function clearPoi() {
    state.selectedPOI = null;
    if (els.mapPoiPanel) {
      els.mapPoiPanel.innerHTML = "";
      if (els.mapPoiEmpty) els.mapPoiPanel.appendChild(els.mapPoiEmpty);
    }
  }

  function renderPoiDetailPanel(poi) {
    if (!els.mapPoiPanel) return;
    els.mapPoiPanel.innerHTML = buildPoiRich(poi, true);
    var closeBtn = els.mapPoiPanel.querySelector(".poi-close");
    if (closeBtn) closeBtn.addEventListener("click", clearPoi);
  }

  function renderPoiModal(poi) {
    if (!els.poiModal || !els.poiModalBody) return;
    els.poiModalBody.innerHTML = buildPoiRich(poi, false);
    els.poiModal.classList.add("is-open");
    els.poiModal.setAttribute("aria-hidden", "false");
  }

  function buildPoiRich(poi, withClose) {
    var color = DATA.categoryColors[poi.category] || "#14b8a6";
    var icon = DATA.categoryIcons[poi.category] || "";
    var label = DATA.categoryLabels[poi.category] || poi.category;
    var region = DATA.regions.find(function (r) { return r.id === poi.regionId; });
    var seasonText = (poi.season || []).map(capitalize).join(", ");

    var primary = poi.bookingUrl || poi.websiteUrl;
    var links = [];
    if (primary) links.push({ url: primary, label: poi.bookingUrl ? "Book or visit site" : "Visit site", primary: true });
    if (poi.websiteUrl && primary !== poi.websiteUrl) links.push({ url: poi.websiteUrl, label: "Website" });
    if (poi.instagramUrl) links.push({ url: poi.instagramUrl, label: "Instagram" });
    if (poi.facebookUrl)  links.push({ url: poi.facebookUrl, label: "Facebook" });

    return (
      '<div class="poi-rich" style="--cat-color:' + color + '">' +
        '<div class="head">' +
          (withClose ? '<button class="poi-close poi-modal-close" type="button" aria-label="Close">✕</button>' : '') +
          '<span class="badge">' + icon + ' ' + escapeHtml(label) + '</span>' +
          '<h2>' + escapeHtml(poi.name) + '</h2>' +
          '<p class="desc">' + escapeHtml(poi.description || "") + '</p>' +
        '</div>' +
        '<div class="body">' +
          '<div class="row-meta">' +
            (poi.rating != null && poi.rating !== "" ? '<span class="pill-chip rating">★ ' + poi.rating + '</span>' : "") +
            (poi.priceRange ? '<span class="pill-chip' + (isFreePrice(poi.priceRange) ? ' free' : '') + '">' + escapeHtml(poi.priceRange) + '</span>' : "") +
            (region ? '<span class="pill-chip">' + escapeHtml(region.name) + '</span>' : "") +
            (seasonText ? '<span class="pill-chip">' + escapeHtml(seasonText) + '</span>' : "") +
            (poi.accessibility ? '<span class="pill-chip">♿ accessible</span>' : "") +
            (poi.skillLevel ? '<span class="pill-chip">' + escapeHtml(capitalize(poi.skillLevel)) + ' level</span>' : "") +
          '</div>' +
          (links.length
            ? '<div class="links">' +
                links.map(function (l) {
                  return '<a class="link-btn' + (l.primary ? ' primary' : '') + '" target="_blank" rel="noopener noreferrer" href="' + l.url + '">' + escapeHtml(l.label) + '</a>';
                }).join("") +
              '</div>'
            : '<div class="row-meta"><span class="pill-chip">No public booking page</span></div>') +
        '</div>' +
      '</div>'
    );
  }

  /* =====================================================================
   * DISCOVER FILTERS — search input, hidden gems, map toggle, reset
   * ===================================================================== */
  function bindDiscoverFilters() {
    if (els.discoverSearch) {
      var t = null;
      els.discoverSearch.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          state.searchQuery = els.discoverSearch.value || "";
          applyFilters();
        }, 140);
      });
    }
    // NOTE: each switch is a <label> wrapping a hidden <input type=checkbox>.
    // Clicking the label already toggles the checkbox exactly once, so we drive
    // state from the checkbox's `change` event (the single source of truth) and
    // only mirror the on/off look onto the .switch element. Binding a `click`
    // handler to the .switch as well caused a double-toggle that cancelled
    // itself out — the reason these filters appeared dead.
    bindSwitch(els.hiddenToggle, els.hiddenSwitch, function (on) {
      state.hiddenOnly = on;
      applyFilters();
    });
    bindSwitch(els.verifiedToggle, els.verifiedSwitch, function (on) {
      state.verifiedOnly = on;
      applyFilters();
    });
    bindSwitch(els.discoverMapToggle, els.discoverMapSwitch, function (on) {
      state.discoverMapVisible = on;
      if (els.discoverMapBox) els.discoverMapBox.classList.toggle("is-hidden", !on);
      if (on && state.map && state.mapLoaded) {
        window.requestAnimationFrame(function () { try { state.map.resize(); } catch (_) {} });
      }
    });
    if (els.resetFilters) {
      els.resetFilters.addEventListener("click", function () {
        state.searchQuery = "";
        state.activeCategory = null;
        state.selectedRegion = null;
        state.hiddenOnly = false;
        state.verifiedOnly = false;
        if (els.discoverSearch) els.discoverSearch.value = "";
        if (els.hiddenSwitch) els.hiddenSwitch.setAttribute("data-on", "false");
        if (els.hiddenToggle) els.hiddenToggle.checked = false;
        if (els.verifiedSwitch) els.verifiedSwitch.setAttribute("data-on", "false");
        if (els.verifiedToggle) els.verifiedToggle.checked = false;
        applyFilters();
      });
    }
  }

  /**
   * Wire a checkbox-backed toggle. `cb` is the real <input type=checkbox>,
   * `visual` is the pill we paint with [data-on]. The label wrapping them
   * toggles the checkbox natively, so we only react to `change`.
   */
  function bindSwitch(cb, visual, onChange) {
    if (!cb) return;
    function paint() {
      if (visual) visual.setAttribute("data-on", cb.checked ? "true" : "false");
    }
    paint();
    cb.addEventListener("change", function () {
      paint();
      onChange(cb.checked);
    });
  }

  /* =====================================================================
   * HOVER CARD (map cursor preview)
   * ===================================================================== */
  function showHoverCard(poi, mouseEvt) {
    if (!els.hoverCard) return;
    if (state.selectedPOI && state.view === "map") { hideHoverCard(); return; }
    var color = DATA.categoryColors[poi.category] || "#14b8a6";
    var icon = DATA.categoryIcons[poi.category] || "";
    var label = DATA.categoryLabels[poi.category] || poi.category;
    els.hoverCard.style.setProperty("--cat-color", color);
    els.hoverCard.innerHTML =
      '<div class="badge">' + icon + ' ' + escapeHtml(label) + '</div>' +
      '<div class="name">' + escapeHtml(poi.name) + '</div>' +
      '<div class="desc">' + escapeHtml(poi.description || "") + '</div>' +
      '<div class="meta">' +
        (poi.rating != null && poi.rating !== "" ? '<span class="star">★ ' + poi.rating + '</span><span>·</span>' : "") +
        priceHtml(poi.priceRange) +
      '</div>';
    els.hoverCard.classList.remove("hidden");
    if (mouseEvt) {
      var x = (mouseEvt.clientX || 0) + 14;
      var y = (mouseEvt.clientY || 0) + 14;
      var w = els.hoverCard.offsetWidth || 240;
      var h = els.hoverCard.offsetHeight || 120;
      if (x + w > window.innerWidth - 12) x = (mouseEvt.clientX || 0) - w - 14;
      if (y + h > window.innerHeight - 12) y = (mouseEvt.clientY || 0) - h - 14;
      els.hoverCard.style.left = Math.max(8, x) + "px";
      els.hoverCard.style.top  = Math.max(8, y) + "px";
    }
  }
  function hideHoverCard() {
    if (els.hoverCard) els.hoverCard.classList.add("hidden");
  }

  /* =====================================================================
   * UTILITIES
   * ===================================================================== */
  function showError(title, msg) {
    if (!els.error) return;
    if (els.errorTitle) els.errorTitle.textContent = title;
    if (els.errorMsg) els.errorMsg.textContent = msg;
    els.error.classList.add("visible");
    if (els.boot) els.boot.classList.add("hidden");
  }
  function hideBoot() { if (els.boot) els.boot.classList.add("hidden"); }
  function escapeHtml(value) {
    if (value == null) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
})();

