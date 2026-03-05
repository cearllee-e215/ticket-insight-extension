// Content Script - Ticket Insight
// Injects XHR interceptor, processes ISMDS data, renders Price Points overlay
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

  // Process ISMDS EventFacets into display-ready data
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
          sections[sec] = { section: sec, count: 0, minList: Infinity, maxList: 0, minTotal: Infinity, maxTotal: 0, type: offer.inventoryType, listings: [] };
        }
        var sd = sections[sec];
        sd.count += facet.count;
        sd.minList = Math.min(sd.minList, offer.listPrice || lp);
        sd.maxList = Math.max(sd.maxList, offer.listPrice || lp);
        if (offer.totalPrice) {
          sd.minTotal = Math.min(sd.minTotal, offer.totalPrice);
          sd.maxTotal = Math.max(sd.maxTotal, offer.totalPrice);
        }
        sd.listings.push({ row:offer.row, seatFrom:offer.seatFrom, seatTo:offer.seatTo, listPrice:offer.listPrice, totalPrice:offer.totalPrice, count:facet.count, type:offer.inventoryType });
      });
    });

    var sortedBk = Object.values(buckets).sort(function(a,b){return a.bucket-b.bucket;});
    var sortedSec = Object.values(sections).sort(function(a,b){return a.section.localeCompare(b.section,undefined,{numeric:true});});
    var total = sortedBk.reduce(function(s,b){return s+b.count;},0);
    var primary = data.facets.filter(function(f){return f.inventoryTypes.indexOf("primary")>=0;}).reduce(function(s,f){return s+f.count;},0);
    var resale = data.facets.filter(function(f){return f.inventoryTypes.indexOf("resale")>=0;}).reduce(function(s,f){return s+f.count;},0);

    return { priceBuckets:sortedBk, sections:sortedSec, totalTickets:total, primaryCount:primary, resaleCount:resale, eventId:data.eventId };
  }

  // Render the Price Points overlay
  function renderOverlay(p) {
    if (!p) return;
    if (overlayEl) overlayEl.remove();
    overlayEl = document.createElement("div");
    overlayEl.id = "ticket-insight-overlay";

    var leg = document.createElement("div");
    leg.style.cssText = "display:flex;flex-direction:column;border:1px solid #e0e0e0;border-radius:8px;padding:10px;background:#f9f9f9;"
      + "box-shadow:0 2px 4px rgba(0,0,0,0.1);z-index:10000;width:fit-content;min-width:100px;"
      + "position:fixed;top:235px;left:10px;max-height:calc(100vh - 250px);overflow-y:auto;"
      + "font-family:Averta,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

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

    // Price swatches
    var sw = document.createElement("div");
    p.priceBuckets.forEach(function(bk,i) {
      var r = document.createElement("div");
      r.style.cssText = "display:flex;align-items:center;margin:5px;cursor:pointer;";
      var c = document.createElement("div");
      c.style.cssText = "width:21px;height:21px;border-radius:50%;flex-shrink:0;background-color:"+getPriceColor(i,p.priceBuckets.length)+";";
      var pl = document.createElement("span");
      pl.style.cssText = "margin-left:12px;font-size:1.35em;color:black;font-weight:bold;";
      pl.textContent = "$"+bk.bucket;
      var cl = document.createElement("span");
      cl.style.cssText = "font-size:1.35em;color:grey;margin-left:4px;";
      cl.textContent = "("+bk.count.toLocaleString()+")";
      r.appendChild(c); r.appendChild(pl); r.appendChild(cl);
      sw.appendChild(r);
    });
    leg.appendChild(sw);

    // Section detail toggle
    if (p.sections.length > 0) {
      var tw2 = document.createElement("div");
      tw2.style.cssText = "margin-top:8px;padding-top:6px;border-top:1px solid #e0e0e0;";
      var tg = document.createElement("div");
      tg.style.cssText = "cursor:pointer;color:#1a73e8;font-size:0.95em;font-weight:600;user-select:none;";
      tg.textContent = "Sections \u25BC";
      var sl = document.createElement("div");
      sl.style.cssText = "display:none;margin-top:6px;max-height:300px;overflow-y:auto;";

      tg.addEventListener("click", function() {
        if (sl.style.display==="none") { sl.style.display="block"; tg.textContent="Sections \u25B2"; }
        else { sl.style.display="none"; tg.textContent="Sections \u25BC"; }
      });

      p.sections.forEach(function(sec) {
        var sr = document.createElement("div");
        sr.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:0.9em;border-bottom:1px solid #f0f0f0;";
        var sn = document.createElement("span");
        sn.style.cssText = "font-weight:600;color:#333;min-width:55px;";
        sn.textContent = "Sec "+sec.section;
        var sc = document.createElement("span");
        sc.style.cssText = "color:#666;margin-left:8px;";
        sc.textContent = sec.count+" tix";
        var sp = document.createElement("span");
        sp.style.cssText = "color:#1a73e8;font-weight:600;margin-left:8px;white-space:nowrap;";
        sp.textContent = sec.minTotal===Infinity ? "$"+sec.minList : "$"+sec.minTotal.toFixed(2);
        sr.appendChild(sn); sr.appendChild(sc); sr.appendChild(sp);
        sl.appendChild(sr);
      });

      tw2.appendChild(tg); tw2.appendChild(sl);
      leg.appendChild(tw2);
    }

    overlayEl.appendChild(leg);
    document.body.appendChild(overlayEl);
    console.log("[TicketInsight] Rendered: "+p.priceBuckets.length+" price points, "+p.sections.length+" sections, "+p.totalTickets+" tickets");
  }

  // Listen for data from injected XHR interceptor
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
