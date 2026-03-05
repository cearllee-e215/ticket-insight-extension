// Popup Script - Ticket Insight v2.0
// Search, sort, filter, resale toggle, copy-all, proper primary/resale separation
(function() {
  "use strict";

  var ticketData = null;
  var showResale = false;
  var currentSort = "section";
  var searchQuery = "";

  function showLoading() {
    document.getElementById("loading").style.display = "block";
    document.getElementById("no-data").style.display = "none";
    document.getElementById("content").style.display = "none";
  }
  function showNoData() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("no-data").style.display = "block";
    document.getElementById("content").style.display = "none";
  }
  function showContent() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("no-data").style.display = "none";
    document.getElementById("content").style.display = "block";
  }

  function getMinPrice(sec) {
    return sec.minTotal !== Infinity ? sec.minTotal : sec.minList !== Infinity ? sec.minList : 0;
  }

  function renderSummary(data) {
    var summary = document.getElementById("summary");
    summary.innerHTML = "";
    var minPrice = Infinity;
    data.sections.forEach(function(s) {
      var p = getMinPrice(s);
      if (p > 0 && p < minPrice) minPrice = p;
    });
    var rows = [
      { label: "Total Tickets", value: data.totalTickets.toLocaleString(), cls: "total" },
      { label: "Primary", value: data.primaryCount.toLocaleString(), cls: "primary" },
      { label: "Resale", value: data.resaleCount.toLocaleString(), cls: "resale" },
      { label: "Sections", value: data.sections.length.toString(), cls: "" },
      { label: "Min Price", value: minPrice !== Infinity ? "$" + minPrice.toFixed(2) : "N/A", cls: "primary" },
      { label: "Price Range", value: "$" + data.priceBuckets[0].bucket + " - $" + data.priceBuckets[data.priceBuckets.length - 1].bucket, cls: "" }
    ];
    rows.forEach(function(r) {
      var row = document.createElement("div");
      row.className = "summary-row";
      var label = document.createElement("span");
      label.className = "summary-label";
      label.textContent = r.label;
      var value = document.createElement("span");
      value.className = "summary-value" + (r.cls ? " " + r.cls : "");
      value.textContent = r.value;
      row.appendChild(label); row.appendChild(value);
      summary.appendChild(row);
    });
  }

  function renderFilterBar(data) {
    var bar = document.getElementById("filter-bar");
    bar.innerHTML = "";
    [{ label: "All", filter: "all" }, { label: "$30-60", filter: "30-60" }, { label: "$60-100", filter: "60-100" }, { label: "$100+", filter: "100+" }].forEach(function(lv) {
      var btn = document.createElement("button");
      btn.className = "filter-btn" + (lv.filter === "all" ? " active" : "");
      btn.textContent = lv.label;
      btn.setAttribute("data-filter", lv.filter);
      btn.addEventListener("click", function() {
        bar.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
        this.classList.add("active");
        renderSections(data);
      });
      bar.appendChild(btn);
    });
  }

  function getActiveFilter() {
    var a = document.querySelector("#filter-bar .filter-btn.active");
    return a ? a.getAttribute("data-filter") : "all";
  }

  function matchesSearch(sec) {
    if (!searchQuery) return true;
    var q = searchQuery.toLowerCase().trim();
    var sn = sec.section.toString().toLowerCase();
    if (q.endsWith("s") && q.length > 1) { var p = q.slice(0,-1); if (/^\d+$/.test(p)) return sn.startsWith(p); }
    return sn.indexOf(q) >= 0;
  }

  function matchesPriceFilter(sec) {
    var f = getActiveFilter(); if (f === "all") return true;
    var p = getMinPrice(sec);
    if (f === "30-60") return p >= 30 && p < 60;
    if (f === "60-100") return p >= 60 && p < 100;
    if (f === "100+") return p >= 100;
    return true;
  }

  function sortSections(arr) {
    var s = arr.slice();
    if (currentSort === "price-asc") s.sort(function(a,b){return getMinPrice(a)-getMinPrice(b);});
    else if (currentSort === "price-desc") s.sort(function(a,b){return getMinPrice(b)-getMinPrice(a);});
    else if (currentSort === "count-desc") s.sort(function(a,b){return b.count-a.count;});
    else if (currentSort === "count-asc") s.sort(function(a,b){return a.count-b.count;});
    else s.sort(function(a,b){return a.section.localeCompare(b.section,undefined,{numeric:true});});
    return s;
  }

  function mkRow(sec, type) {
    var row = document.createElement("div"); row.className = "section-row";
    var nm = document.createElement("span"); nm.className = "section-name"; nm.textContent = "Sec " + sec.section;
    var ct = document.createElement("div"); ct.className = "section-counts";
    var cnt = type === "primary" ? sec.primaryCount : type === "resale" ? sec.resaleCount : sec.count;
    var tc = document.createElement("div"); tc.className = "section-total-count"; tc.textContent = cnt + " tickets";
    ct.appendChild(tc);
    var pr = document.createElement("span"); pr.className = "section-price";
    if (type === "primary") {
      var mp = Infinity; sec.listings.forEach(function(l){if(l.type==="primary")mp=Math.min(mp,l.totalPrice||l.listPrice);});
      pr.textContent = mp !== Infinity ? "$"+mp.toFixed(2) : "$"+getMinPrice(sec).toFixed(2);
      pr.classList.add("primary-price");
    } else if (type === "resale") {
      var mr = Infinity; sec.listings.forEach(function(l){if(l.type==="resale")mr=Math.min(mr,l.totalPrice||l.listPrice);});
      pr.textContent = mr !== Infinity ? "$"+mr.toFixed(2) : "$"+getMinPrice(sec).toFixed(2);
      pr.classList.add("resale-price");
    } else { pr.textContent = "$"+getMinPrice(sec).toFixed(2); pr.classList.add("primary-price"); }
    row.appendChild(nm); row.appendChild(ct); row.appendChild(pr);
    return row;
  }

  function renderSections(data) {
    var c = document.getElementById("sections"); c.innerHTML = "";
    var fl = data.sections.filter(function(s){return matchesSearch(s) && matchesPriceFilter(s);});
    var ps = [], rs = [];
    fl.forEach(function(s){if(s.primaryCount>0)ps.push(s);if(s.resaleCount>0)rs.push(s);});
    ps = sortSections(ps); rs = sortSections(rs);
    if (ps.length === 0 && (!showResale || rs.length === 0)) {
      var n = document.createElement("div"); n.className = "no-results";
      n.textContent = searchQuery ? 'No sections matching "'+searchQuery+'"' : "No tickets found";
      c.appendChild(n); return;
    }
    if (ps.length > 0) {
      var ph = document.createElement("div"); ph.className = "section-group-header";
      var pc = ps.reduce(function(s,x){return s+x.primaryCount;},0);
      ph.textContent = "Primary Tickets ("+pc.toLocaleString()+")";
      c.appendChild(ph);
      ps.forEach(function(s){c.appendChild(mkRow(s,"primary"));});
    }
    if (showResale && rs.length > 0) {
      var rh = document.createElement("div"); rh.className = "section-group-header resale-header";
      var rc = rs.reduce(function(s,x){return s+x.resaleCount;},0);
      rh.textContent = "Resale Tickets ("+rc.toLocaleString()+")";
      c.appendChild(rh);
      rs.forEach(function(s){c.appendChild(mkRow(s,"resale"));});
    }
  }

  function buildCopyText(data) {
    var l = ["TICKET INSIGHT REPORT","=====================",
      "Total: "+data.totalTickets.toLocaleString()+" tickets",
      "Primary: "+data.primaryCount.toLocaleString(),
      "Resale: "+data.resaleCount.toLocaleString(),
      "Price Range: $"+data.priceBuckets[0].bucket+" - $"+data.priceBuckets[data.priceBuckets.length-1].bucket,
      "","PRICE LEVELS","------------"];
    data.priceBuckets.forEach(function(b){l.push("$"+b.bucket+": "+b.count.toLocaleString()+" tickets");});
    l.push("","PRIMARY TICKETS BY SECTION","--------------------------");
    data.sections.filter(function(s){return s.primaryCount>0;})
      .sort(function(a,b){return a.section.localeCompare(b.section,undefined,{numeric:true});})
      .forEach(function(s){
        var m=Infinity;s.listings.forEach(function(x){if(x.type==="primary")m=Math.min(m,x.totalPrice||x.listPrice);});
        l.push("Sec "+s.section+": "+s.primaryCount+" tix, from "+(m!==Infinity?"$"+m.toFixed(2):"N/A"));
      });
    l.push("","RESALE TICKETS BY SECTION","-------------------------");
    data.sections.filter(function(s){return s.resaleCount>0;})
      .sort(function(a,b){return a.section.localeCompare(b.section,undefined,{numeric:true});})
      .forEach(function(s){
        var m=Infinity;s.listings.forEach(function(x){if(x.type==="resale")m=Math.min(m,x.totalPrice||x.listPrice);});
        l.push("Sec "+s.section+": "+s.resaleCount+" tix, from "+(m!==Infinity?"$"+m.toFixed(2):"N/A"));
      });
    return l.join("\n");
  }

  function setupEventListeners(data) {
    document.getElementById("search-box").addEventListener("input",function(){searchQuery=this.value;renderSections(data);});
    document.getElementById("sort-select").addEventListener("change",function(){currentSort=this.value;renderSections(data);});
    document.getElementById("resale-toggle").addEventListener("click",function(){
      showResale=!showResale;this.classList.toggle("on",showResale);renderSections(data);
    });
    document.getElementById("copy-btn").addEventListener("click",function(){
      var b=this;navigator.clipboard.writeText(buildCopyText(data)).then(function(){
        b.textContent="Copied!";b.classList.add("copied");
        setTimeout(function(){b.textContent="Copy All Data";b.classList.remove("copied");},2000);
      });
    });
  }

  function loadData() {
    showLoading();
    chrome.tabs.query({active:true,currentWindow:true},function(tabs){
      if(!tabs||!tabs[0]){showNoData();return;}
      chrome.tabs.sendMessage(tabs[0].id,{type:"getTicketData"},function(response){
        if(chrome.runtime.lastError||!response||!response.data){showNoData();return;}
        ticketData=response.data;
        showContent();renderSummary(ticketData);renderFilterBar(ticketData);
        renderSections(ticketData);setupEventListeners(ticketData);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();
