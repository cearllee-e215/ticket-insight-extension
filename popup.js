// Popup Script - Ticket Insight
// Displays section-level inventory with primary/resale filtering
(function() {
  "use strict";

  var ticketData = null;
  var currentFilter = "All";

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

  function renderSummary(data) {
    var summary = document.getElementById("summary");
    summary.innerHTML = "";

    var rows = [
      { label: "Total Tickets", value: data.totalTickets.toLocaleString(), cls: "total" },
      { label: "Primary", value: data.primaryCount.toLocaleString(), cls: "primary" },
      { label: "Resale", value: data.resaleCount.toLocaleString(), cls: "resale" },
      { label: "Sections", value: data.sections.length.toString(), cls: "" },
      { label: "Price Range", value: "$" + data.priceBuckets[0].bucket + " - $" + data.priceBuckets[data.priceBuckets.length-1].bucket, cls: "" }
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
      row.appendChild(label);
      row.appendChild(value);
      summary.appendChild(row);
    });
  }

  function renderFilterBar(data) {
    var bar = document.getElementById("filter-bar");
    bar.innerHTML = "";
    var filters = ["All", "Primary", "Resale"];

    filters.forEach(function(f) {
      var btn = document.createElement("button");
      btn.className = "filter-btn" + (f === currentFilter ? " active" : "");
      btn.textContent = f;
      var count = f === "All" ? data.totalTickets :
                  f === "Primary" ? data.primaryCount : data.resaleCount;
      btn.textContent = f + " (" + count.toLocaleString() + ")";
      btn.addEventListener("click", function() {
        currentFilter = f;
        renderFilterBar(data);
        renderSections(data, f);
      });
      bar.appendChild(btn);
    });
  }

  function renderSections(data, filter) {
    var container = document.getElementById("sections");
    container.innerHTML = "";

    var filteredSections = data.sections.filter(function(sec) {
      if (filter === "Primary") return sec.primaryCount > 0;
      if (filter === "Resale") return sec.resaleCount > 0;
      return true;
    });

    if (filteredSections.length === 0) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:20px;text-align:center;color:#999;font-size:0.9em;";
      empty.textContent = "No " + filter.toLowerCase() + " tickets found";
      container.appendChild(empty);
      return;
    }

    filteredSections.forEach(function(sec) {
      var row = document.createElement("div");
      row.className = "section-row";

      // Section name
      var name = document.createElement("span");
      name.className = "section-name";
      name.textContent = "Sec " + sec.section;

      // Counts
      var counts = document.createElement("div");
      counts.className = "section-counts";

      var totalCount = document.createElement("div");
      totalCount.className = "section-total-count";
      var displayCount = filter === "Primary" ? sec.primaryCount :
                         filter === "Resale" ? sec.resaleCount : sec.count;
      totalCount.textContent = displayCount + " tickets";
      counts.appendChild(totalCount);

      // Show breakdown when showing All
      if (filter === "All" && (sec.primaryCount > 0 || sec.resaleCount > 0)) {
        var breakdown = document.createElement("div");
        breakdown.className = "section-breakdown";
        var parts = [];
        if (sec.primaryCount > 0) parts.push('<span class="p-label">' + sec.primaryCount + ' primary</span>');
        if (sec.resaleCount > 0) parts.push('<span class="r-label">' + sec.resaleCount + ' resale</span>');
        breakdown.innerHTML = parts.join(" \u00B7 ");
        counts.appendChild(breakdown);
      }

      // Price
      var price = document.createElement("span");
      price.className = "section-price";
      price.textContent = sec.minTotal === Infinity ? "$" + sec.minList : "$" + sec.minTotal.toFixed(2);

      row.appendChild(name);
      row.appendChild(counts);
      row.appendChild(price);
      container.appendChild(row);
    });
  }

  function loadData() {
    showLoading();

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs || !tabs[0]) {
        showNoData();
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { type: "getTicketData" }, function(response) {
        if (chrome.runtime.lastError || !response || !response.data) {
          showNoData();
          return;
        }

        ticketData = response.data;
        showContent();
        renderSummary(ticketData);
        renderFilterBar(ticketData);
        renderSections(ticketData, currentFilter);
      });
    });
  }

  // Initialize
  document.addEventListener("DOMContentLoaded", loadData);
})();
