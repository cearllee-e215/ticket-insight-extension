// Content Script - Ticket Insight
// Injects XHR interceptor, processes ISMDS data, renders Price Points overlay
// with seat map shading, popup inventory display, and secondary market comparison
(function() {
  "use strict";

  // Inject XHR interceptor into page context
  var s = document.createElement("script");
  s.src = chrome.runtime.getURL("inject/xhr.js");
  s.onload = function() { this.remove(); };
  (document.head || document.documentElement).appendChild(s);

  var facetsData = null;
  var overlayEl = null;
  var chunkedData = "";
  var selectedBucketIdx = null;
  var processedData = null;

  // Color gradient: green (cheap) -> orange -> red (expensive)
  function getPriceColor(idx, total) {
    if (total <= 1) return "rgb(138,233,138)";
    var ratio = idx / (total - 1);
    var C = [
      [138,233,138], [0,116,0], [159,170,80], [255,193,76],
      [255,160,0], [255,140,0], [255,106,106], [255,36,36], [139,0,0]
    ];
    var sl = 1/(C.length-1);
    var si = Math.min(Math.floor(ratio/sl), C.length-2);
    var sr = (ratio - si*sl)/sl;
    var a=C[si], b=C[si+1];
    return "rgb("+Math.round(a[0]+(b[0]-a[0])*sr)+","+Math.round(a[1]+(b[1]-a[1])*sr)+","+Math.round(a[2]+(b[2]-a[2])*sr)+")";
  }

  function getPriceColorHex(idx, total) {
    if (total <= 1) return "#8ae98a";
    var ratio = idx / (total - 1);
    var C = [
      [138,233,138], [0,116,0], [159,170,80], [255,193,76],
      [255,160,0], [255,140,0], [255,106,106], [255,36,36], [139,0,0]
    ];
    var sl = 1/(C.length-1);
    var si = Math.min(Math.floor(ratio/sl), C.length-2);
    var sr = (ratio - si*sl)/sl;
    var a=C[si], b=C[si+1];
    var r = Math.round(a[0]+(b[0]-a[0])*sr);
    var g = Math.round(a[1]+(b[1]-a[1])*sr);
    var b2 = Math.round(a[2]+(b[2]-a[2])*sr);
    return "#" + ((1<<24)+(r<<16)+(g<<8)+b2).toString(16).slice(1);
  }

  // ========== SEAT MAP SHADING ==========
  function buildSectionPriceMap(p) {
    var sectionMap = {};
    if (!p || !p.sections || !p.priceBuckets) return sectionMap;
    p.sections.forEach(function(sec) {
      var price = sec.minTotal !== Infinity ? sec.minTotal : sec.minList;
      var bucket = Math.ceil(price / 10) * 10;
      for (var i = 0; i < p.priceBuckets.length; i++) {
        if (p.priceBuckets[i].bucket === bucket) {
          sectionMap[sec.section] = i;
          break;
        }
      }
      if (sectionMap[sec.section] === undefined) {
        var closest = 0, closestDiff = Infinity;
        for (var k = 0; k < p.priceBuckets.length; k++) {
          var diff = Math.abs(p.priceBuckets[k].bucket - bucket);
          if (diff < closestDiff) { closestDiff = diff; closest = k; }
        }
        sectionMap[sec.section] = closest;
      }
    });
    return sectionMap;
  }

  function normalizeSectionId(raw) {
    if (!raw) return null;
    return raw.toString().replace(/^0+/, "").trim().toUpperCase();
  }

  function shadeSeatMap(p, activeBucketIdx) {
    if (!p) return;
    var sectionMap = buildSectionPriceMap(p);
    var total = p.priceBuckets.length;
    var normalizedMap = {};
    Object.keys(sectionMap).forEach(function(k) {
      normalizedMap[normalizeSectionId(k)] = sectionMap[k];
    });

    // Find all section-like elements in the page
    var selectors = [
      "[data-section-id]", "[data-section]", "g[id*='section']", "g[id*='Section']",
      "g[id*='sec']", "g[id*='Sec']", "[class*='section']", "[class*='Section']",
      "path[data-section]", "polygon[data-section]", "[data-component='section']"
    ];
    var elements = [];
    selectors.forEach(function(sel) {
      try {
        var found = document.querySelectorAll(sel);
        for (var i = 0; i < found.length; i++) elements.push(found[i]);
      } catch(e) {}
    });

    elements.forEach(function(el) {
      var secId = el.getAttribute("data-section-id") ||
                  el.getAttribute("data-section") || "";
      if (!secId && el.id) {
        var m = el.id.match(/sec(?:tion)?[-_]?(\w+)/i);
        if (m) secId = m[1];
      }
      var nid = normalizeSectionId(secId);
      if (nid && normalizedMap[nid] !== undefined) {
        var bucketIdx = normalizedMap[nid];
        var color = getPriceColorHex(bucketIdx, total);
        if (activeBucketIdx !== null && activeBucketIdx !== undefined) {
          if (bucketIdx === activeBucketIdx) {
            el.style.fill = color;
            el.style.opacity = "0.85";
            el.style.stroke = "#1a73e8";
            el.style.strokeWidth = "2";
          } else {
            el.style.fill = "#e0e0e0";
            el.style.opacity = "0.3";
            el.style.stroke = "";
            el.style.strokeWidth = "";
          }
        } else {
          el.style.fill = color;
          el.style.opacity = "0.7";
          el.style.stroke = "";
          el.style.strokeWidth = "";
        }
      }
    });

    // Color individual seat circles/dots
    var allCircles = document.querySelectorAll("svg circle, svg ellipse");
    allCircles.forEach(function(circle) {
      var sectionId = null;
      for (var p2 = circle.parentElement; p2 && p2.tagName !== "svg"; p2 = p2.parentElement) {
        sectionId = p2.getAttribute("data-section-id") ||
                    p2.getAttribute("data-section") ||
                    (p2.id && p2.id.match(/sec(?:tion)?[-_]?(\w+)/i) ? p2.id.match(/sec(?:tion)?[-_]?(\w+)/i)[1] : null);
        if (sectionId) break;
      }
      var nid = normalizeSectionId(sectionId);
      if (nid && normalizedMap[nid] !== undefined) {
        var bucketIdx = normalizedMap[nid];
        var color = getPriceColorHex(bucketIdx, total);
        if (activeBucketIdx !== null && activeBucketIdx !== undefined) {
          if (bucketIdx === activeBucketIdx) {
            circle.setAttribute("fill", color);
            circle.setAttribute("opacity", "1");
          } else {
            circle.setAttribute("fill", "#d0d0d0");
            circle.setAttribute("opacity", "0.2");
          }
        } else {
          circle.setAttribute("fill", color);
          circle.setAttribute("opacity", "0.85");
        }
      }
    });

    console.log("[TicketInsight] Seat map shaded: " + Object.keys(sectionMap).length + " sections mapped" +
      (activeBucketIdx !== null ? ", highlighting bucket " + activeBucketIdx : ", showing all"));
  }

  function clearSeatShading() {
    var selectors = [
      "[data-section-id]", "[data-section]", "g[id*='section']", "g[id*='Section']",
      "g[id*='sec']", "[class*='section']"
    ];
    selectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          el.style.fill = "";
          el.style.opacity = "";
          el.style.stroke = "";
          el.style.strokeWidth = "";
        });
      } catch(e) {}
    });
  }

  // ========== SECONDARY MARKET OVERLAY ==========
  function extractEventName() {
    var el = document.querySelector("h1, [data-testid='event-title'], .event-name");
    return el ? el.textContent.trim() : document.title.split("|")[0].trim();
  }

  function renderSecondaryMarketOverlay() {
    var existing = document.getElementById("ticket-insight-secondary");
    if (existing) { existing.remove(); return; }

    var eventName = extractEventName();
    var encodedName = encodeURIComponent(eventName);

    var container = document.createElement("div");
    container.id = "ticket-insight-secondary";
    container.style.cssText = "position:fixed;top:160px;left:50%;transform:translateX(-50%);z-index:10001;" +
      "background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:16px;padding:16px 20px;" +
      "box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:Averta,-apple-system,BlinkMacSystemFont,sans-serif;" +
      "display:flex;flex-direction:column;align-items:center;min-width:340px;";

    var closeBtn = document.createElement("span");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = "position:absolute;top:8px;right:12px;color:#aaa;cursor:pointer;font-size:1.1em;padding:4px;";
    closeBtn.addEventListener("click", function() { container.remove(); });
    container.appendChild(closeBtn);

    var title = document.createElement("div");
    title.textContent = "Secondary Market Comparison";
    title.style.cssText = "color:#fff;font-weight:bold;font-size:1.1em;margin-bottom:12px;";
    container.appendChild(title);

    var iconsRow = document.createElement("div");
    iconsRow.style.cssText = "display:flex;gap:12px;margin-bottom:12px;";

    var markets = [
      { name: "StubHub", color: "#3f1d74", url: "https://www.stubhub.com/find/s/?q=" + encodedName, icon: "SH" },
      { name: "Vivid Seats", color: "#6b2fa0", url: "https://www.vividseats.com/search?searchTerm=" + encodedName, icon: "VS" },
      { name: "SeatGeek", color: "#1db954", url: "https://seatgeek.com/search?search=" + encodedName, icon: "SG" },
      { name: "Gametime", color: "#ff4444", url: "https://gametime.co/search?q=" + encodedName, icon: "GT" },
      { name: "TickPick", color: "#00b4d8", url: "https://www.tickpick.com/search?searchText=" + encodedName, icon: "TP" }
    ];

    markets.forEach(function(market) {
      var iconBtn = document.createElement("a");
      iconBtn.href = market.url;
      iconBtn.target = "_blank";
      iconBtn.rel = "noopener noreferrer";
      iconBtn.title = "Search on " + market.name;
      iconBtn.style.cssText = "display:flex;align-items:center;justify-content:center;width:48px;height:48px;" +
        "border-radius:50%;background:" + market.color + ";color:#fff;font-weight:bold;font-size:0.75em;" +
        "text-decoration:none;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;" +
        "box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.15);";
      iconBtn.textContent = market.icon;
      iconBtn.addEventListener("mouseenter", function() {
        this.style.transform = "scale(1.15)";
        this.style.boxShadow = "0 4px 16px rgba(0,0,0,0.5)";
        this.style.borderColor = "#fff";
      });
      iconBtn.addEventListener("mouseleave", function() {
        this.style.transform = "scale(1)";
        this.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
        this.style.borderColor = "rgba(255,255,255,0.15)";
      });
      iconsRow.appendChild(iconBtn);
    });

    container.appendChild(iconsRow);

    var info = document.createElement("div");
    info.textContent = "Click an icon to compare prices on secondary markets";
    info.style.cssText = "color:#8899aa;font-size:0.8em;text-align:center;";
    container.appendChild(info);

    document.body.appendChild(container);
  }

  // ========== PROCESS FACETS DATA ==========
  function processFacetsData(data) {
    if (!data || !data.facets) return null;
    var buckets = {}, sections = {}, offerMap = {};

    if (data._embedded && data._embedded.offer)
      data._embedded.offer.forEach(function(o) { offerMap[o.offerId] = o; });

    data.facets.forEach(function(facet) {
      var lp = facet.listPriceRange[0].min;
      var bk = Math.ceil(lp / 10) * 10;
      if (!buckets[bk]) buckets[bk] = { count: 0, bucket: bk };
      buckets[bk].count += facet.count;

      facet.offers.forEach(function(oid) {
        var offer = offerMap[oid];
        if (!offer || !offer.section) return;
        var sec = offer.section;
        if (!sections[sec]) {
          sections[sec] = { section: sec, count: 0, primaryCount: 0, resaleCount: 0,
            minList: Infinity, maxList: 0, minTotal: Infinity, maxTotal: 0,
            type: offer.inventoryType, listings: [] };
        }
        var sd = sections[sec];
        sd.count += facet.count;
        if (offer.inventoryType === "primary") sd.primaryCount += facet.count;
        else if (offer.inventoryType === "resale") sd.resaleCount += facet.count;
        sd.minList = Math.min(sd.minList, offer.listPrice || lp);
        sd.maxList = Math.max(sd.maxList, offer.listPrice || lp);
        if (offer.totalPrice) {
          sd.minTotal = Math.min(sd.minTotal, offer.totalPrice);
          sd.maxTotal = Math.max(sd.maxTotal, offer.totalPrice);
        }
        sd.listings.push({ row:offer.row, seatFrom:offer.seatFrom, seatTo:offer.seatTo,
          listPrice:offer.listPrice, totalPrice:offer.totalPrice, count:facet.count,
          type:offer.inventoryType });
      });
    });

    var sortedBk = Object.values(buckets).sort(function(a,b){return a.bucket-b.bucket;});
    var sortedSec = Object.values(sections).sort(function(a,b){return a.section.localeCompare(b.section,undefined,{numeric:true});});
    var total = sortedBk.reduce(function(s,b){return s+b.count;},0);
    var primary = data.facets.filter(function(f){return f.inventoryTypes.indexOf("primary")>=0;}).reduce(function(s,f){return s+f.count;},0);
    var resale = data.facets.filter(function(f){return f.inventoryTypes.indexOf("resale")>=0;}).reduce(function(s,f){return s+f.count;},0);

    return { priceBuckets:sortedBk, sections:sortedSec, totalTickets:total, primaryCount:primary, resaleCount:resale, eventId:data.eventId };
  }

  // ========== UPDATE SECTIONS LIST ==========
  function updateSectionsList(container, p, filter) {
    container.innerHTML = "";
    p.sections.forEach(function(sec) {
      if (filter === "Primary" && sec.primaryCount === 0) return;
      if (filter === "Resale" && sec.resaleCount === 0) return;
      var count = filter === "Primary" ? sec.primaryCount :
                  filter === "Resale" ? sec.resaleCount : sec.count;
      if (count === 0) return;

      var sr = document.createElement("div");
      sr.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.85em;border-bottom:1px solid #f0f0f0;";

      var sn = document.createElement("span");
      sn.style.cssText = "font-weight:600;color:#333;min-width:55px;";
      sn.textContent = "Sec "+sec.section;

      var scWrap = document.createElement("span");
      scWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;margin-left:8px;flex:1;";

      var scTotal = document.createElement("span");
      scTotal.style.cssText = "color:#666;font-size:0.95em;";
      scTotal.textContent = count+" tix";
      scWrap.appendChild(scTotal);

      if (filter === "All" && (sec.primaryCount > 0 || sec.resaleCount > 0)) {
        var breakdown = document.createElement("span");
        breakdown.style.cssText = "font-size:0.8em;color:#999;";
        var parts = [];
        if (sec.primaryCount > 0) parts.push(sec.primaryCount + "P");
        if (sec.resaleCount > 0) parts.push(sec.resaleCount + "R");
        breakdown.textContent = parts.join(" / ");
        scWrap.appendChild(breakdown);
      }

      var sp = document.createElement("span");
      sp.style.cssText = "color:#1a73e8;font-weight:600;margin-left:8px;white-space:nowrap;";
      sp.textContent = sec.minTotal===Infinity ? "$"+sec.minList : "$"+sec.minTotal.toFixed(2);

      sr.appendChild(sn); sr.appendChild(scWrap); sr.appendChild(sp);
      container.appendChild(sr);
    });
  }

  // ========== RENDER OVERLAY ==========
  function renderOverlay(p) {
    if (!p) return;
    processedData = p;
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement("div");
    overlayEl.id = "ticket-insight-overlay";

    var leg = document.createElement("div");
    leg.style.cssText = "display:flex;flex-direction:column;border:1px solid #e0e0e0;border-radius:8px;padding:10px;background:#f9f9f9;" +
      "box-shadow:0 2px 4px rgba(0,0,0,0.1);z-index:10000;width:fit-content;min-width:100px;" +
      "position:fixed;top:235px;left:10px;max-height:calc(100vh - 250px);overflow-y:auto;" +
      "font-family:Averta,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

    // Header
    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";
    var tw = document.createElement("div");
    tw.style.cssText = "display:flex;align-items:center;";
    var ic = document.createElement("span");
    ic.textContent = "\uD83C\uDFAB";
    ic.style.cssText = "font-size:1.4em;margin-right:6px;";
    var tt = document.createElement("span");
    tt.textContent = "Price Points";
    tt.style.cssText = "font-weight:bold;font-size:1.25em;color:#333;";
    tw.appendChild(ic); tw.appendChild(tt);

    // Secondary market button
    var smBtn = document.createElement("span");
    smBtn.textContent = "\uD83D\uDD0D";
    smBtn.title = "Compare Secondary Markets";
    smBtn.style.cssText = "cursor:pointer;font-size:1.1em;margin-left:8px;padding:2px 4px;opacity:0.7;";
    smBtn.addEventListener("mouseenter", function() { this.style.opacity = "1"; });
    smBtn.addEventListener("mouseleave", function() { this.style.opacity = "0.7"; });
    smBtn.addEventListener("click", function() { renderSecondaryMarketOverlay(); });
    tw.appendChild(smBtn);

    var cb = document.createElement("span");
    cb.textContent = "\u2715";
    cb.style.cssText = "cursor:pointer;font-size:1.2em;color:#666;margin-left:12px;padding:2px 6px;";
    cb.addEventListener("click", function(){leg.style.display="none";});
    hdr.appendChild(tw); hdr.appendChild(cb);
    leg.appendChild(hdr);

    // Summary
    var sum = document.createElement("div");
    sum.style.cssText = "font-size:0.85em;color:#666;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;";
    sum.textContent = p.totalTickets.toLocaleString()+" tickets ("+p.primaryCount.toLocaleString()+" primary, "+p.resaleCount.toLocaleString()+" resale)";
    leg.appendChild(sum);

    // Price swatches with click-to-shade
    var sw = document.createElement("div");
    var swatchRows = [];
    p.priceBuckets.forEach(function(bk,i) {
      var r = document.createElement("div");
      r.style.cssText = "display:flex;align-items:center;margin:3px 5px;cursor:pointer;padding:2px 4px;border-radius:4px;transition:background 0.2s;";
      r.setAttribute("data-bucket-idx", i);

      var c = document.createElement("div");
      var baseColor = getPriceColor(i,p.priceBuckets.length);
      c.style.cssText = "width:21px;height:21px;border-radius:50%;flex-shrink:0;background-color:"+baseColor+
        ";transition:box-shadow 0.2s;border:2px solid transparent;";
      c.setAttribute("data-swatch", "true");

      var pl = document.createElement("span");
      pl.style.cssText = "margin-left:12px;font-size:1.35em;color:black;font-weight:bold;";
      pl.textContent = "$"+bk.bucket;
      var cl = document.createElement("span");
      cl.style.cssText = "font-size:1.35em;color:grey;margin-left:4px;";
      cl.textContent = "("+bk.count.toLocaleString()+")";

      r.addEventListener("click", function() {
        var idx = parseInt(this.getAttribute("data-bucket-idx"));
        if (selectedBucketIdx === idx) {
          selectedBucketIdx = null;
          swatchRows.forEach(function(sr) {
            sr.querySelector("[data-swatch]").style.borderColor = "transparent";
            sr.style.background = "";
          });
          shadeSeatMap(p, null);
        } else {
          selectedBucketIdx = idx;
          swatchRows.forEach(function(sr) {
            sr.querySelector("[data-swatch]").style.borderColor = "transparent";
            sr.style.background = "";
          });
          c.style.borderColor = "#1a73e8";
          this.style.background = "rgba(26,115,232,0.08)";
          shadeSeatMap(p, idx);
        }
      });

      r.addEventListener("mouseenter", function() {
        if (selectedBucketIdx !== parseInt(this.getAttribute("data-bucket-idx"))) {
          this.style.background = "rgba(0,0,0,0.04)";
        }
      });
      r.addEventListener("mouseleave", function() {
        if (selectedBucketIdx !== parseInt(this.getAttribute("data-bucket-idx"))) {
          this.style.background = "";
        }
      });

      r.appendChild(c); r.appendChild(pl); r.appendChild(cl);
      sw.appendChild(r);
      swatchRows.push(r);
    });
    leg.appendChild(sw);

    // Filter toggle
    var filterWrap = document.createElement("div");
    filterWrap.style.cssText = "margin-top:8px;padding-top:6px;border-top:1px solid #e0e0e0;";
    var filterToggle = document.createElement("div");
    filterToggle.style.cssText = "cursor:pointer;color:#333;font-size:0.95em;font-weight:600;user-select:none;";
    filterToggle.textContent = "Filter \u25BC";
    var filterContent = document.createElement("div");
    filterContent.style.cssText = "display:none;margin-top:6px;";

    var filterTypes = ["All", "Primary", "Resale"];
    var filterBtns = [];
    var sectionsList = null;

    filterTypes.forEach(function(ft) {
      var fb = document.createElement("button");
      fb.textContent = ft;
      fb.style.cssText = "padding:4px 10px;margin:2px 3px;border-radius:12px;border:1px solid #ccc;" +
        "cursor:pointer;font-size:0.82em;background:" + (ft === "All" ? "#1a73e8" : "#fff") +
        ";color:" + (ft === "All" ? "#fff" : "#333") + ";transition:all 0.2s;";
      fb.addEventListener("click", function() {
        filterBtns.forEach(function(b) { b.style.background = "#fff"; b.style.color = "#333"; });
        this.style.background = "#1a73e8";
        this.style.color = "#fff";
        if (sectionsList) updateSectionsList(sectionsList, p, ft);
      });
      filterContent.appendChild(fb);
      filterBtns.push(fb);
    });

    filterToggle.addEventListener("click", function() {
      if (filterContent.style.display === "none") {
        filterContent.style.display = "block";
        filterToggle.textContent = "Filter \u25B2";
      } else {
        filterContent.style.display = "none";
        filterToggle.textContent = "Filter \u25BC";
      }
    });

    filterWrap.appendChild(filterToggle);
    filterWrap.appendChild(filterContent);
    leg.appendChild(filterWrap);

    // Sections
    if (p.sections.length > 0) {
      var tw2 = document.createElement("div");
      tw2.style.cssText = "margin-top:8px;padding-top:6px;border-top:1px solid #e0e0e0;";
      var tg = document.createElement("div");
      tg.style.cssText = "cursor:pointer;color:#1a73e8;font-size:0.95em;font-weight:600;user-select:none;";
      tg.textContent = "Sections \u25BC";
      sectionsList = document.createElement("div");
      sectionsList.style.cssText = "display:none;margin-top:6px;max-height:300px;overflow-y:auto;";

      tg.addEventListener("click", function() {
        if (sectionsList.style.display==="none") { sectionsList.style.display="block"; tg.textContent="Sections \u25B2"; }
        else { sectionsList.style.display="none"; tg.textContent="Sections \u25BC"; }
      });

      updateSectionsList(sectionsList, p, "All");
      tw2.appendChild(tg); tw2.appendChild(sectionsList);
      leg.appendChild(tw2);
    }

    // Customize toggle
    var custWrap = document.createElement("div");
    custWrap.style.cssText = "margin-top:8px;padding-top:6px;border-top:1px solid #e0e0e0;";
    var custToggle = document.createElement("div");
    custToggle.style.cssText = "cursor:pointer;color:#333;font-size:0.95em;font-weight:600;user-select:none;";
    custToggle.textContent = "Customize \u25BC";
    var custContent = document.createElement("div");
    custContent.style.cssText = "display:none;margin-top:6px;font-size:0.85em;color:#666;";

    var shadeAllBtn = document.createElement("button");
    shadeAllBtn.textContent = "Shade All Seats";
    shadeAllBtn.style.cssText = "padding:5px 12px;margin:3px;border-radius:12px;border:1px solid #1a73e8;" +
      "cursor:pointer;font-size:0.85em;background:#1a73e8;color:#fff;";
    shadeAllBtn.addEventListener("click", function() {
      selectedBucketIdx = null;
      swatchRows.forEach(function(sr) {
        sr.querySelector("[data-swatch]").style.borderColor = "transparent";
        sr.style.background = "";
      });
      shadeSeatMap(p, null);
    });

    var clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear Shading";
    clearBtn.style.cssText = "padding:5px 12px;margin:3px;border-radius:12px;border:1px solid #666;" +
      "cursor:pointer;font-size:0.85em;background:#fff;color:#333;";
    clearBtn.addEventListener("click", function() {
      selectedBucketIdx = null;
      swatchRows.forEach(function(sr) {
        sr.querySelector("[data-swatch]").style.borderColor = "transparent";
        sr.style.background = "";
      });
      clearSeatShading();
    });

    custContent.appendChild(shadeAllBtn);
    custContent.appendChild(clearBtn);

    custToggle.addEventListener("click", function() {
      if (custContent.style.display === "none") {
        custContent.style.display = "block";
        custToggle.textContent = "Customize \u25B2";
      } else {
        custContent.style.display = "none";
        custToggle.textContent = "Customize \u25BC";
      }
    });

    custWrap.appendChild(custToggle);
    custWrap.appendChild(custContent);
    leg.appendChild(custWrap);

    overlayEl.appendChild(leg);
    document.body.appendChild(overlayEl);

    // Auto-shade the seat map
    setTimeout(function() { shadeSeatMap(p, null); }, 1500);

    console.log("[TicketInsight] Rendered: "+p.priceBuckets.length+" price points, "+p.sections.length+" sections, "+p.totalTickets+" tickets");
  }

  // ========== POPUP COMMUNICATION ==========
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === "getTicketData" && processedData) {
      sendResponse({ data: processedData, facetsRaw: facetsData });
    } else if (msg.type === "getTicketData") {
      sendResponse({ data: null });
    }
    return true;
  });

  // ========== EVENT LISTENER FOR DATA ==========
  window.addEventListener("message", function(ev) {
    if (!ev.data || !ev.data.type) return;

    if (ev.data.type === "xhrData" && ev.data.data) {
      try {
        var d = JSON.parse(ev.data.data);
        if (d && d.facets && d._embedded) { facetsData = d; renderOverlay(processFacetsData(d)); }
      } catch(e) { console.error("[TicketInsight] Parse error:", e); }
    }

    if (ev.data.type === "workerDataChunk") {
      if (ev.data.chunkIndex === 0) chunkedData = "";
      try { chunkedData += new TextDecoder("utf-8").decode(new Uint8Array(ev.data.chunk)); }
      catch(e) { console.error("[TicketInsight] Chunk error:", e); }
    }

    if (ev.data.type === "workerDataComplete" && chunkedData) {
      try {
        var d = JSON.parse(chunkedData);
        if (d && d.facets && d._embedded) { facetsData = d; renderOverlay(processFacetsData(d)); }
      } catch(e) { console.error("[TicketInsight] Chunked parse error:", e); }
      chunkedData = "";
    }
  });

  console.log("[TicketInsight] Content script loaded");
})();
