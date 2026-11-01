/* Menu site: loads data/menu.json and renders a searchable, filterable menu.
   No dependencies and no build step. All menu text is inserted as text nodes,
   never as HTML. */
(function () {
  "use strict";

  var DATA_URL = "data/menu.json";

  var FILTERS = {
    vegan: { label: "Vegan", short: "V", cls: "tag--v" },
    vegetarian: { label: "Vegetarian", short: "Veg", cls: "tag--veg" },
    glutenFree: { label: "Gluten-free", short: "GF", cls: "tag--gf" }
  };

  var state = { query: "", vegan: false, vegetarian: false, glutenFree: false };
  var menu = null;
  var index = []; // [{ item, section, li, nameEl, descEl, haystack }]
  var sectionEls = []; // [{ section, el, link }]

  var $ = function (id) { return document.getElementById(id); };
  var els = {};

  /* ---------- helpers ---------- */

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function normalize(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }

  function formatPrice(price, currency) {
    if (typeof price !== "number" || !isFinite(price)) return null;
    var whole = Math.round(price * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2
      }).format(price);
    } catch (e) {
      return "$" + (whole ? String(price) : price.toFixed(2));
    }
  }

  // Strip a trailing "Contains gluten" phrase; it is shown as a badge instead.
  function displayDescription(item) {
    var d = item.description || "";
    if (item.containsGluten) d = d.replace(/[\s.\-–—]*contains gluten\.?\s*$/i, "");
    return d.trim();
  }

  // Fill `el` with `text`, wrapping case/diacritic-insensitive matches of any term in <mark>.
  function setHighlighted(el, text, terms) {
    el.textContent = "";
    if (!terms.length || !text) { el.textContent = text; return; }
    var norm = normalize(text);
    // NFD + stripping marks can change length for accented input; fall back to plain text then.
    if (norm.length !== text.length) { el.textContent = text; return; }
    var ranges = [];
    terms.forEach(function (t) {
      var from = 0, at;
      while (t && (at = norm.indexOf(t, from)) !== -1) {
        ranges.push([at, at + t.length]);
        from = at + t.length;
      }
    });
    if (!ranges.length) { el.textContent = text; return; }
    ranges.sort(function (a, b) { return a[0] - b[0] || b[1] - a[1]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    var pos = 0;
    merged.forEach(function (r) {
      if (r[0] > pos) el.appendChild(document.createTextNode(text.slice(pos, r[0])));
      el.appendChild(h("mark", null, [text.slice(r[0], r[1])]));
      pos = r[1];
    });
    if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
  }

  function tagEls(item) {
    var d = item.dietary || {};
    var out = [];
    if (d.vegan) out.push(h("span", { class: "tag tag--v", title: "Vegan" }, ["V"]));
    else if (d.vegetarian) out.push(h("span", { class: "tag tag--veg", title: "Vegetarian" }, ["Veg"]));
    if (d.glutenFree) out.push(h("span", { class: "tag tag--gf", title: "Gluten-free" }, ["GF"]));
    if (!out.length) return null;
    var labels = [];
    if (d.vegan) labels.push("vegan");
    else if (d.vegetarian) labels.push("vegetarian");
    if (d.glutenFree) labels.push("gluten-free");
    var wrap = h("span", { class: "tags" }, out);
    out.forEach(function (t) { t.setAttribute("aria-hidden", "true"); });
    wrap.appendChild(h("span", { class: "visually-hidden" }, [" (" + labels.join(", ") + ")"]));
    return wrap;
  }

  /* ---------- rendering ---------- */

  function renderMeta() {
    var r = menu.restaurant || {};
    if (r.name) {
      els.name.textContent = r.name;
      document.title = r.name + " — Menu";
    }

    els.legend.textContent = "";
    Object.keys(FILTERS).forEach(function (key) {
      var f = FILTERS[key];
      var text = key === "vegan" ? "Vegan (also vegetarian)" : f.label;
      els.legend.appendChild(h("li", null, [h("span", { class: "tag " + f.cls }, [f.short]), text]));
    });

    els.policies.textContent = "";
    (menu.policies || []).forEach(function (p) {
      els.policies.appendChild(h("li", null, [p]));
    });
    if (menu.allergyNotice) {
      els.policies.appendChild(h("li", { class: "policies__allergy" }, [menu.allergyNotice]));
    }
  }

  function renderSections() {
    var frag = document.createDocumentFragment();
    var navFrag = document.createDocumentFragment();
    index = [];
    sectionEls = [];

    (menu.sections || []).forEach(function (section) {
      var headingId = "h-" + section.id;
      var notes = (section.notes || []).map(function (n) {
        return h("li", { class: "menu-section__note" }, [n]);
      });
      var list = h("ul", { class: "items" });

      (section.items || []).forEach(function (item) {
        var nameEl = h("h3", { class: "item__name" }, [item.name]);
        var priceText = formatPrice(item.price, menu.currency);
        var priceEl = priceText
          ? h("span", { class: "item__price" }, [priceText])
          : h("span", { class: "item__price item__price--ask" }, ["Ask your server"]);
        var desc = displayDescription(item);
        var descEl = desc ? h("p", { class: "item__desc" }, [desc]) : null;
        var warnEl = item.containsGluten ? h("span", { class: "item__warn" }, ["Contains gluten"]) : null;

        var li = h("li", { class: "item", id: "item-" + item.id }, [
          h("div", { class: "item__head" }, [
            h("div", { class: "item__title" }, [nameEl, tagEls(item)]),
            priceEl
          ]),
          descEl,
          warnEl
        ]);
        list.appendChild(li);

        index.push({
          item: item,
          section: section,
          li: li,
          nameEl: nameEl,
          descEl: descEl,
          desc: desc,
          haystack: normalize([item.name, item.description, section.name].join(" • "))
        });
      });

      var el = h("section", { class: "menu-section", id: section.id, "aria-labelledby": headingId }, [
        h("header", { class: "menu-section__header" }, [
          h("h2", { class: "menu-section__title", id: headingId }, [section.name]),
          notes.length ? h("ul", { class: "menu-section__notes" }, notes) : null
        ]),
        list
      ]);
      frag.appendChild(el);

      var a = h("a", { href: "#" + section.id }, [section.name]);
      var li = h("li", null, [a]);
      navFrag.appendChild(li);
      sectionEls.push({ section: section, el: el, link: a, navItem: li });
    });

    els.sections.textContent = "";
    els.sections.appendChild(frag);
    els.sectionLinks.textContent = "";
    els.sectionLinks.appendChild(navFrag);
  }

  /* ---------- filtering ---------- */

  function terms() {
    return normalize(state.query).split(/\s+/).filter(Boolean);
  }

  function matches(entry, t) {
    var d = entry.item.dietary || {};
    if (state.vegan && !d.vegan) return false;
    if (state.vegetarian && !d.vegetarian) return false;
    if (state.glutenFree && !d.glutenFree) return false;
    for (var i = 0; i < t.length; i++) {
      if (entry.haystack.indexOf(t[i]) === -1) return false;
    }
    return true;
  }

  function anyActive() {
    return !!(state.query.trim() || state.vegan || state.vegetarian || state.glutenFree);
  }

  function apply() {
    var t = terms();
    var shown = 0;
    var perSection = {};

    index.forEach(function (entry) {
      var ok = matches(entry, t);
      entry.li.hidden = !ok;
      if (ok) {
        shown++;
        perSection[entry.section.id] = (perSection[entry.section.id] || 0) + 1;
        setHighlighted(entry.nameEl, entry.item.name, t);
        if (entry.descEl) setHighlighted(entry.descEl, entry.desc, t);
      }
    });

    sectionEls.forEach(function (s) {
      var visible = !!perSection[s.section.id];
      s.el.hidden = !visible;
      s.navItem.hidden = !visible;
    });

    var total = index.length;
    els.empty.hidden = shown !== 0;
    if (!anyActive()) {
      els.status.textContent = total + " dishes";
    } else {
      var parts = [];
      Object.keys(FILTERS).forEach(function (k) { if (state[k]) parts.push(FILTERS[k].label.toLowerCase()); });
      var desc = parts.length ? " · " + parts.join(", ") : "";
      var q = state.query.trim() ? " matching “" + state.query.trim() + "”" : "";
      els.status.textContent = "Showing " + shown + " of " + total + " dishes" + q + desc;
    }

    syncUrl();
    updateSpy();
  }

  function syncUrl() {
    try {
      var params = new URLSearchParams(location.search);
      if (state.query.trim()) params.set("q", state.query.trim()); else params.delete("q");
      var diet = Object.keys(FILTERS).filter(function (k) { return state[k]; });
      if (diet.length) params.set("diet", diet.join(",")); else params.delete("diet");
      var qs = params.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    } catch (e) { /* history may be unavailable (e.g. sandboxed iframes) */ }
  }

  function readUrl() {
    try {
      var params = new URLSearchParams(location.search);
      state.query = params.get("q") || "";
      (params.get("diet") || "").split(",").forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(FILTERS, k)) state[k] = true;
      });
    } catch (e) { /* ignore */ }
  }

  function syncControls() {
    els.search.value = state.query;
    els.chips.forEach(function (chip) {
      chip.setAttribute("aria-pressed", state[chip.getAttribute("data-filter")] ? "true" : "false");
    });
  }

  /* ---------- scroll spy, sticky offset, back-to-top ---------- */

  var spyTick = false;
  function updateSpy() {
    if (spyTick) return;
    spyTick = true;
    requestAnimationFrame(function () {
      spyTick = false;
      var offset = els.toolbar.getBoundingClientRect().bottom + 24;
      var current = null;
      for (var i = 0; i < sectionEls.length; i++) {
        var s = sectionEls[i];
        if (s.el.hidden) continue;
        if (s.el.getBoundingClientRect().top <= offset) current = s;
        else if (!current) { current = s; break; }
        else break;
      }
      sectionEls.forEach(function (s) {
        if (s === current) {
          if (s.link.getAttribute("aria-current") !== "true") {
            s.link.setAttribute("aria-current", "true");
            scrollNavTo(s.link);
          }
        } else {
          s.link.removeAttribute("aria-current");
        }
      });
      els.toTop.hidden = window.scrollY < 600;
    });
  }

  function scrollNavTo(link) {
    var nav = els.nav;
    if (nav.scrollWidth <= nav.clientWidth) return; // wrapped (desktop): nothing to scroll
    var navRect = nav.getBoundingClientRect();
    var linkRect = link.getBoundingClientRect();
    var left = nav.scrollLeft + (linkRect.left - navRect.left) - nav.clientWidth / 2 + linkRect.width / 2;
    try { nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" }); }
    catch (e) { nav.scrollLeft = Math.max(0, left); }
  }

  function trackToolbarHeight() {
    var set = function () {
      document.documentElement.style.setProperty("--toolbar-h", els.toolbar.offsetHeight + "px");
    };
    set();
    if ("ResizeObserver" in window) new ResizeObserver(set).observe(els.toolbar);
    else window.addEventListener("resize", set);
  }

  /* ---------- wiring ---------- */

  function bind() {
    var debounce;
    els.search.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        state.query = els.search.value;
        apply();
      }, 80);
    });
    els.search.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && els.search.value) {
        els.search.value = "";
        state.query = "";
        apply();
      }
    });

    els.chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var key = chip.getAttribute("data-filter");
        state[key] = !state[key];
        chip.setAttribute("aria-pressed", state[key] ? "true" : "false");
        apply();
      });
    });

    els.clear.addEventListener("click", function () {
      state.query = "";
      Object.keys(FILTERS).forEach(function (k) { state[k] = false; });
      syncControls();
      apply();
      els.search.focus();
    });

    els.toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });

    window.addEventListener("scroll", updateSpy, { passive: true });
    window.addEventListener("resize", updateSpy);
  }

  function showError(err) {
    els.sections.textContent = "";
    var msg = location.protocol === "file:"
      ? "The menu data could not be loaded because this page was opened directly from disk. " +
        "Serve the folder with a local web server (for example: python3 -m http.server) and open http://localhost:8000."
      : "Sorry, the menu could not be loaded right now. Please refresh the page.";
    els.sections.appendChild(h("p", { class: "notice", role: "alert" }, [msg]));
    els.status.textContent = "";
    if (window.console) console.error(err);
  }

  function init() {
    els = {
      name: $("restaurant-name"),
      search: $("search"),
      chips: Array.prototype.slice.call(document.querySelectorAll(".chip[data-filter]")),
      sections: $("sections"),
      sectionLinks: $("section-links"),
      nav: document.querySelector(".sections-nav"),
      toolbar: $("toolbar"),
      status: $("status"),
      empty: $("empty"),
      clear: $("clear-filters"),
      legend: $("legend"),
      policies: $("policies"),
      toTop: $("to-top")
    };

    trackToolbarHeight();
    readUrl();
    syncControls();
    bind();

    fetch(DATA_URL, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " loading " + DATA_URL);
        return res.json();
      })
      .then(function (data) {
        menu = data;
        renderMeta();
        renderSections();
        apply();
        // Honour a #section hash on first load once the content exists.
        if (location.hash.length > 1) {
          var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
          if (target) target.scrollIntoView();
        }
      })
      .catch(showError);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
