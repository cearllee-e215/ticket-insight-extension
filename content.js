// Content Script - Ticket Insight v2.1
// Injects XHR interceptor, processes ISMDS data, renders overlay with seat map shading
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
        var selectedBucketIdxs = [];
        var processedData = null;
        var shadeObserver = null;
        var shadeInterval = null;

     // ===== COLOR GRADIENT =====
     function getPriceColor(idx, total) {
                 if (total <= 1) return "rgb(76,175,80)";
                 var ratio = idx / (total - 1);
                 var C = [
                                 [76,175,80], [129,199,132], [189,189,40], [255,235,59],
                                 [255,193,7], [255,152,0], [255,87,34], [244,67,54], [183,28,28]
                             ];
                 var sl = 1 / (C.length - 1);
                 var si = Math.min(Math.floor(ratio / sl), C.length - 2);
                 var sr = (ratio - si * sl) / sl;
                 var a = C[si], b = C[si + 1];
                 return "rgb(" + Math.round(a[0]+(b[0]-a[0])*sr) + "," +
                                 Math.round(a[1]+(b[1]-a[1])*sr) + "," +
                                 Math.round(a[2]+(b[2]-a[2])*sr) + ")";
     }

     function getPriceHex(idx, total) {
                 if (total <= 1) return "#4caf50";
                 var ratio = idx / (total - 1);
                 var C = [
                                 [76,175,80], [129,199,132], [189,189,40], [255,235,59],
                                 [255,193,7], [255,152,0], [255,87,34], [244,67,54], [183,28,28]
                             ];
                 var sl = 1 / (C.length - 1);
                 var si = Math.min(Math.floor(ratio / sl), C.length - 2);
                 var sr = (ratio - si * sl) / sl;
                 var a = C[si], b = C[si + 1];
                 var r = Math.round(a[0]+(b[0]-a[0])*sr);
                 var g = Math.round(a[1]+(b[1]-a[1])*sr);
                 var bv = Math.round(a[2]+(b[2]-a[2])*sr);
                 return "#" + ((1<<24)+(r<<16)+(g<<8)+bv).toString(16).slice(1);
     }

     // ===== PROCESS FACETS DATA =====
     function processFacetsData(data) {
                 if (!data || !data.facets) return null;

            var buckets = {}, sections = {}, offerMap = {};

            if (data._embedded && data._embedded.offer) {
                            data._embedded.offer.forEach(function(o) {
                                                offerMap[o.offerId] = o;
                            });
            }

            data.facets.forEach(function(facet) {
                            // Use totalPriceRange (all-in price) for bucket calculation
                                            var tp = (facet.totalPriceRange && facet.totalPriceRange[0]) ? facet.totalPriceRange[0].min : null;
                            var lp = facet.listPriceRange[0].min;
                            var priceForBucket = tp !== null ? tp : lp;

                                            var bk = Math.ceil(priceForBucket / 10) * 10;
                            if (!buckets[bk]) buckets[bk] = { count: 0, bucket: bk, minTotal: Infinity, minList: Infinity };
                            buckets[bk].count += facet.count;
                            if (tp !== null) buckets[bk].minTotal = Math.min(buckets[bk].minTotal, tp);
                            buckets[bk].minList = Math.min(buckets[bk].minList, lp);

                                            var invTypes = facet.inventoryTypes || [];
                            var isPrimary = invTypes.indexOf("primary") >= 0;
                            var isResale = invTypes.indexOf("resale") >= 0;

                                            facet.offers.forEach(function(oid) {
                                                                var offer = offerMap[oid];
                                                                if (!offer) return;

                                                                                 var sec = offer.section || "GA";
                                                                var offerType = offer.inventoryType || (isPrimary ? "primary" : isResale ? "resale" : "unknown");

                                                                                 if (!sections[sec]) {
                                                                                                         sections[sec] = {
                                                                                                                                     section: sec, count: 0,
                                                                                                                                     primaryCount: 0, resaleCount: 0,
                                                                                                                                     minList: Infinity, maxList: 0,
                                                                                                                                     minTotal: Infinity, maxTotal: 0,
                                                                                                                                     rows: {}, listings: []
                                                                                                             };
                                                                                     }

                                                                                 var sd = sections[sec];
                                                                sd.count += facet.count;
                                                                if (offerType === "primary") sd.primaryCount += facet.count;
                                                                else if (offerType === "resale") sd.resaleCount += facet.count;

                                                                                 var listP = offer.listPrice || lp;
                                                                var totalP = offer.totalPrice || (tp !== null ? tp : lp);

                                                                                 sd.minList = Math.min(sd.minList, listP);
                                                                sd.maxList = Math.max(sd.maxList, listP);
                                                                sd.minTotal = Math.min(sd.minTotal, totalP);
                                                                sd.maxTotal = Math.max(sd.maxTotal, totalP);

                                                                                 if (offer.row) {
                                                                                                         if (!sd.rows[offer.row]) sd.rows[offer.row] = { count: 0, minPrice: Infinity };
                                                                                                         sd.rows[offer.row].count += facet.count;
                                                                                                         sd.rows[offer.row].minPrice = Math.min(sd.rows[offer.row].minPrice, totalP);
                                                                                     }

                                                                                 sd.listings.push({
                                                                                                         row: offer.row,
                                                                                                         seatFrom: offer.seatFrom,
                                                                                                         seatTo: offer.seatTo,
                                                                                                         listPrice: listP,
                                                                                                         totalPrice: totalP,
                                                                                                         count: facet.count,
                                                                                                         type: offerType
                                                                                     });
                                            });
            });

            var sortedBk = Object.values(buckets).sort(function(a,b){ return a.bucket - b.bucket; });
                 var sortedSec = Object.values(sections).sort(function(a,b){
                                 return a.section.localeCompare(b.section, undefined, {numeric: true});
                 });

            var total = sortedBk.reduce(function(s,b){ return s + b.count; }, 0);
                 var primary = 0, resale = 0;
                 sortedSec.forEach(function(sec) {
                                 primary += sec.primaryCount;
                                 resale += sec.resaleCount;
                 });

            return {
                            priceBuckets: sortedBk,
                            sections: sortedSec,
                            totalTickets: total,
                            primaryCount: primary,
                            resaleCount: resale,
                            eventId: data.eventId
            };
     }

     // ===== SEAT MAP SHADING =====
     function buildSectionPriceMap(p) {
                 var sMap = {};
                 if (!p || !p.sections || !p.priceBuckets) return sMap;
                 p.sections.forEach(function(sec) {
                                 var price = sec.minTotal !== Infinity ? sec.minTotal : sec.minList;
                                 var closestIdx = 0, closestDiff = Infinity;
                                 for (var i = 0; i < p.priceBuckets.length; i++) {
                                                     var diff = Math.abs(p.priceBuckets[i].bucket - Math.ceil(price / 10) * 10);
                                                     if (diff < closestDiff) {
                                                                             closestDiff = diff;
                                                                             closestIdx = i;
                                                     }
                                 }
                                 sMap[sec.section] = closestIdx;
                 });
                 return sMap;
     }

     function shadeSeatMap(p, activeBucketIdxs) {
                 if (!p) return;
                 var sectionPriceMap = buildSectionPriceMap(p);
                 var total = p.priceBuckets.length;
                 var hasSelection = activeBucketIdxs && activeBucketIdxs.length > 0;

            var blocks = document.querySelectorAll('[data-component="svg__block"]');
                 blocks.forEach(function(block) {
                                 var secName = block.getAttribute("data-section-name");
                                 if (!secName || sectionPriceMap[secName] === undefined) return;
                                 var bucketIdx = sectionPriceMap[secName];
                                 var color = getPriceHex(bucketIdx, total);

                                            var seats = block.querySelectorAll('circle.seat, [data-component="svg__seat"]');
                                 seats.forEach(function(seat) {
                                                     var circle = seat.tagName === "circle" ? seat : seat.querySelector("circle");
                                                     if (!circle) return;

                                                               if (hasSelection) {
                                                                                       var isSelected = activeBucketIdxs.indexOf(bucketIdx) >= 0;
                                                                                       if (isSelected) {
                                                                                                                   circle.style.fill = "#1565c0";
                                                                                                                   circle.style.opacity = "1";
                                                                                                                   circle.style.stroke = "#0d47a1";
                                                                                                                   circle.style.strokeWidth = "1";
                                                                                           } else {
                                                                                                                   // Keep the original color, don't hide or dim
                                                                                           circle.style.fill = color;
                                                                                                                   circle.style.opacity = "0.85";
                                                                                                                   circle.style.stroke = "";
                                                                                                                   circle.style.strokeWidth = "";
                                                                                           }
                                                               } else {
                                                                                       circle.style.fill = color;
                                                                                       circle.style.opacity = "0.85";
                                                                                       circle.style.stroke = "";
                                                                                       circle.style.strokeWidth = "";
                                                               }
                                 });
                 });

            console.log("[TicketInsight] Shaded " + blocks.length + " section blocks" +
                                    (hasSelection ? " (highlighting " + activeBucketIdxs.length + " price levels)" : ""));
     }

     function clearSeatShading() {
                 var blocks = document.querySelectorAll('[data-component="svg__block"]');
                 blocks.forEach(function(block) {
                                 var seats = block.querySelectorAll('circle.seat, [data-component="svg__seat"]');
                                 seats.forEach(function(seat) {
                                                     var circle = seat.tagName === "circle" ? seat : seat.querySelector("circle");
                                                     if (circle) {
                                                                             circle.style.fill = "";
                                                                             circle.style.opacity = "";
                                                                             circle.style.stroke = "";
                                                                             circle.style.strokeWidth = "";
                                                     }
                                 });
                 });
     }

     function startShadeObserver(p) {
                 if (shadeObserver) shadeObserver.disconnect();
                 if (shadeInterval) clearInterval(shadeInterval);

            shadeInterval = setInterval(function() {
                            if (processedData) {
                                                shadeSeatMap(processedData, selectedBucketIdxs);
                            }
            }, 3000);

            var svgContainer = document.querySelector('svg[viewBox]');
                 if (svgContainer) {
                                 shadeObserver = new MutationObserver(function() {
                                                     if (processedData) {
                                                                             setTimeout(function() {
                                                                                                         shadeSeatMap(processedData, selectedBucketIdxs);
                                                                                 }, 500);
                                                     }
                                 });
                                 shadeObserver.observe(svgContainer, {
                                                     childList: true, subtree: true,
                                                     attributes: true, attributeFilter: ["style", "class"]
                                 });
                 }
     }

     // ===== SECONDARY MARKET OVERLAY =====
     function extractEventName() {
                 var el = document.querySelector("h1, [data-testid='event-title'], .event-name");
                 return el ? el.textContent.trim() : document.title.split("|")[0].trim();
     }

     function renderSecondaryMarketOverlay() {
                 var existing = document.getElementById("ticket-insight-secondary");
                 if (existing) { existing.remove(); return; }

            var eventName = extractEventName();
                 var enc = encodeURIComponent(eventName);

            var container = document.createElement("div");
                 container.id = "ticket-insight-secondary";
                 container.style.cssText = "position:fixed;top:160px;left:50%;transform:translateX(-50%);z-index:10001;" +
                                 "background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);border-radius:16px;padding:16px 20px;" +
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
                { name:"StubHub", color:"#3f1d74", url:"https://www.stubhub.com/find/s/?q="+enc, icon:"SH" },
                { name:"Vivid Seats", color:"#6b2fa0", url:"https://www.vividseats.com/search?searchTerm="+enc, icon:"VS" },
                { name:"SeatGeek", color:"#1db954", url:"https://seatgeek.com/search?search="+enc, icon:"SG" },
                { name:"Gametime", color:"#ff4444", url:"https://gametime.co/search?q="+enc, icon:"GT" },
                { name:"TickPick", color:"#00b4d8", url:"https://www.tickpick.com/search?searchText="+enc, icon:"TP" }
                        ];

            markets.forEach(function(m) {
                            var btn = document.createElement("a");
                            btn.href = m.url;
                            btn.target = "_blank";
                            btn.rel = "noopener noreferrer";
                            btn.title = "Search on " + m.name;
                            btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:48px;height:48px;" +
                                                "border-radius:50%;background:"+m.color+";color:#fff;font-weight:bold;font-size:0.75em;" +
                                                "text-decoration:none;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;" +
                                                "box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid rgba(255,255,255,0.15);";
                            btn.textContent = m.icon;
                            btn.addEventListener("mouseenter", function() { this.style.transform="scale(1.15)"; });
                            btn.addEventListener("mouseleave", function() { this.style.transform="scale(1)"; });
                            iconsRow.appendChild(btn);
            });
                 container.appendChild(iconsRow);

            var info = document.createElement("div");
                 info.textContent = "Click an icon to compare prices";
                 info.style.cssText = "color:#8899aa;font-size:0.8em;text-align:center;";
                 container.appendChild(info);

            document.body.appendChild(container);
     }

     // ===== RENDER OVERLAY =====
     function renderOverlay(p) {
                 if (!p) return;
                 processedData = p;

            if (overlayEl) overlayEl.remove();
                 overlayEl = document.createElement("div");
                 overlayEl.id = "ticket-insight-overlay";

            var panel = document.createElement("div");
                 panel.style.cssText = "display:flex;flex-direction:column;border:1px solid #e0e0e0;border-radius:10px;padding:10px 12px;" +
                                 "background:#fafafa;box-shadow:0 2px 8px rgba(0,0,0,0.12);z-index:10000;width:fit-content;min-width:110px;" +
                                 "position:fixed;top:235px;left:10px;max-height:calc(100vh - 250px);overflow-y:auto;" +
                                 "font-family:Averta,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;";

            // === Header ===
            var hdr = document.createElement("div");
                 hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";

            var tw = document.createElement("div");
                 tw.style.cssText = "display:flex;align-items:center;";

            var ic = document.createElement("span");
                 ic.textContent = "\uD83C\uDFAB";
                 ic.style.cssText = "font-size:1.3em;margin-right:5px;";

            var tt = document.createElement("span");
                 tt.textContent = "Price Points";
                 tt.style.cssText = "font-weight:bold;font-size:1.15em;color:#333;";

            tw.appendChild(ic);
                 tw.appendChild(tt);

            var smBtn = document.createElement("span");
                 smBtn.textContent = "\uD83D\uDD0D";
                 smBtn.title = "Compare Secondary Markets";
                 smBtn.style.cssText = "cursor:pointer;font-size:1em;margin-left:8px;opacity:0.7;";
                 smBtn.addEventListener("click", function() { renderSecondaryMarketOverlay(); });
                 tw.appendChild(smBtn);

            var closeBtn = document.createElement("span");
                 closeBtn.textContent = "\u2715";
                 closeBtn.style.cssText = "cursor:pointer;font-size:1.1em;color:#666;margin-left:12px;padding:2px 6px;";
                 closeBtn.addEventListener("click", function() { panel.style.display = "none"; });

            hdr.appendChild(tw);
                 hdr.appendChild(closeBtn);
                 panel.appendChild(hdr);

            // === Summary ===
            var sum = document.createElement("div");
                 sum.style.cssText = "font-size:0.82em;color:#666;margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid #e0e0e0;line-height:1.4;";
                 sum.innerHTML = "<b>" + p.totalTickets.toLocaleString() + "</b> tickets &middot; " +
                                 "<span style='color:#1a73e8'>" + p.primaryCount.toLocaleString() + " primary</span> &middot; " +
                                 "<span style='color:#e67e22'>" + p.resaleCount.toLocaleString() + " resale</span>";
                 panel.appendChild(sum);

            // === Price Swatches ===
            var sw = document.createElement("div");
                 var swatchRows = [];

            p.priceBuckets.forEach(function(bk, i) {
                            var r = document.createElement("div");
                            r.style.cssText = "display:flex;align-items:center;margin:2px 4px;cursor:pointer;padding:2px 4px;border-radius:4px;transition:background 0.15s;";
                            r.setAttribute("data-bucket-idx", i);

                                               var originalColor = getPriceColor(i, p.priceBuckets.length);

                                               var dot = document.createElement("div");
                            dot.style.cssText = "width:18px;height:18px;border-radius:50%;flex-shrink:0;background:" +
                                                originalColor + ";border:2.5px solid transparent;transition:border-color 0.2s;";
                            dot.setAttribute("data-swatch", "true");
                            dot.setAttribute("data-original-color", originalColor);

                                               var priceLabel = document.createElement("span");
                            priceLabel.style.cssText = "margin-left:10px;font-size:1.2em;color:#222;font-weight:bold;";
                            priceLabel.textContent = "$" + bk.bucket;

                                               var countLabel = document.createElement("span");
                            countLabel.style.cssText = "font-size:1.1em;color:#888;margin-left:4px;";
                            countLabel.textContent = "(" + bk.count.toLocaleString() + ")";

                                               r.addEventListener("click", function() {
                                                                   var idx = parseInt(this.getAttribute("data-bucket-idx"));
                                                                   var pos = selectedBucketIdxs.indexOf(idx);

                                                                                  if (pos >= 0) {
                                                                                                          // Deselect this bucket
                                                                       selectedBucketIdxs.splice(pos, 1);
                                                                                      } else {
                                                                                                          // Select this bucket (add to selection)
                                                                       selectedBucketIdxs.push(idx);
                                                                                      }

                                                                                  // Update all swatch visuals
                                                                                  swatchRows.forEach(function(sr) {
                                                                                                          var srIdx = parseInt(sr.getAttribute("data-bucket-idx"));
                                                                                                          var swatchDot = sr.querySelector("[data-swatch]");
                                                                                                          var isActive = selectedBucketIdxs.indexOf(srIdx) >= 0;

                                                                                                                         if (isActive) {
                                                                                                                                                     // Selected: blue border, keep original color
                                                                                                              swatchDot.style.borderColor = "#1565c0";
                                                                                                                                                     sr.style.background = "rgba(21,101,192,0.08)";
                                                                                                                             } else {
                                                                                                                                                     // Not selected: no border, keep original color
                                                                                                              swatchDot.style.borderColor = "transparent";
                                                                                                                                                     sr.style.background = "";
                                                                                                                             }
                                                                                      });

                                                                                  shadeSeatMap(p, selectedBucketIdxs);
                                               });

                                               r.addEventListener("mouseenter", function() {
                                                                   var srIdx = parseInt(this.getAttribute("data-bucket-idx"));
                                                                   if (selectedBucketIdxs.indexOf(srIdx) < 0) {
                                                                                           this.style.background = "rgba(0,0,0,0.04)";
                                                                   }
                                               });
                            r.addEventListener("mouseleave", function() {
                                                var srIdx = parseInt(this.getAttribute("data-bucket-idx"));
                                                if (selectedBucketIdxs.indexOf(srIdx) < 0) {
                                                                        this.style.background = "";
                                                }
                            });

                                               r.appendChild(dot);
                            r.appendChild(priceLabel);
                            r.appendChild(countLabel);
                            sw.appendChild(r);
                            swatchRows.push(r);
            });

            panel.appendChild(sw);

            // === Filter Section ===
            var filterWrap = document.createElement("div");
                 filterWrap.style.cssText = "margin-top:6px;padding-top:5px;border-top:1px solid #e0e0e0;";

            var filterToggle = document.createElement("div");
                 filterToggle.style.cssText = "cursor:pointer;color:#333;font-size:0.9em;font-weight:600;user-select:none;";
                 filterToggle.textContent = "Filter \u25BC";

            var filterContent = document.createElement("div");
                 filterContent.style.cssText = "display:none;margin-top:5px;";

            var selectAllBtn = document.createElement("button");
                 selectAllBtn.textContent = "Select All";
                 selectAllBtn.style.cssText = "padding:4px 10px;margin:2px;border-radius:10px;border:1px solid #1565c0;cursor:pointer;font-size:0.82em;background:#1565c0;color:#fff;";
                 selectAllBtn.addEventListener("click", function() {
                                 selectedBucketIdxs = [];
                                 for (var i = 0; i < p.priceBuckets.length; i++) selectedBucketIdxs.push(i);
                                 swatchRows.forEach(function(sr) {
                                                     sr.querySelector("[data-swatch]").style.borderColor = "#1565c0";
                                                     sr.style.background = "rgba(21,101,192,0.08)";
                                 });
                                 shadeSeatMap(p, selectedBucketIdxs);
                 });

            var deselectAllBtn = document.createElement("button");
                 deselectAllBtn.textContent = "Deselect All";
                 deselectAllBtn.style.cssText = "padding:4px 10px;margin:2px;border-radius:10px;border:1px solid #666;cursor:pointer;font-size:0.82em;background:#fff;color:#333;";
                 deselectAllBtn.addEventListener("click", function() {
                                 selectedBucketIdxs = [];
                                 swatchRows.forEach(function(sr) {
                                                     sr.querySelector("[data-swatch]").style.borderColor = "transparent";
                                                     sr.style.background = "";
                                 });
                                 shadeSeatMap(p, []);
                 });

            filterContent.appendChild(selectAllBtn);
                 filterContent.appendChild(deselectAllBtn);

            filterToggle.addEventListener("click", function() {
                            filterContent.style.display = filterContent.style.display === "none" ? "block" : "none";
                            filterToggle.textContent = "Filter " + (filterContent.style.display === "none" ? "\u25BC" : "\u25B2");
            });

            filterWrap.appendChild(filterToggle);
                 filterWrap.appendChild(filterContent);
                 panel.appendChild(filterWrap);

            // === Customize Section ===
            var custWrap = document.createElement("div");
                 custWrap.style.cssText = "margin-top:4px;";

            var custToggle = document.createElement("div");
                 custToggle.style.cssText = "cursor:pointer;color:#333;font-size:0.9em;font-weight:600;user-select:none;";
                 custToggle.textContent = "Customize \u25BC";

            var custContent = document.createElement("div");
                 custContent.style.cssText = "display:none;margin-top:5px;";

            var shadeBtn = document.createElement("button");
                 shadeBtn.textContent = "Shade All";
                 shadeBtn.style.cssText = "padding:4px 10px;margin:2px;border-radius:10px;border:1px solid #1565c0;cursor:pointer;font-size:0.82em;background:#1565c0;color:#fff;";
                 shadeBtn.addEventListener("click", function() {
                                 selectedBucketIdxs = [];
                                 swatchRows.forEach(function(sr) {
                                                     sr.querySelector("[data-swatch]").style.borderColor = "transparent";
                                                     sr.style.background = "";
                                 });
                                 shadeSeatMap(p, []);
                 });

            var clearBtn = document.createElement("button");
                 clearBtn.textContent = "Clear";
                 clearBtn.style.cssText = "padding:4px 10px;margin:2px;border-radius:10px;border:1px solid #666;cursor:pointer;font-size:0.82em;background:#fff;color:#333;";
                 clearBtn.addEventListener("click", function() {
                                 selectedBucketIdxs = [];
                                 swatchRows.forEach(function(sr) {
                                                     sr.querySelector("[data-swatch]").style.borderColor = "transparent";
                                                     sr.style.background = "";
                                 });
                                 clearSeatShading();
                 });

            custContent.appendChild(shadeBtn);
                 custContent.appendChild(clearBtn);

            custToggle.addEventListener("click", function() {
                            custContent.style.display = custContent.style.display === "none" ? "block" : "none";
                            custToggle.textContent = "Customize " + (custContent.style.display === "none" ? "\u25BC" : "\u25B2");
            });

            custWrap.appendChild(custToggle);
                 custWrap.appendChild(custContent);
                 panel.appendChild(custWrap);

            overlayEl.appendChild(panel);
                 document.body.appendChild(overlayEl);

            // Auto-shade with retry
            function tryShade(attempts) {
                            var blocks = document.querySelectorAll('[data-component="svg__block"]');
                            if (blocks.length > 0) {
                                                shadeSeatMap(p, []);
                                                startShadeObserver(p);
                            } else if (attempts < 10) {
                                                setTimeout(function() { tryShade(attempts + 1); }, 1000);
                            }
            }
                 tryShade(0);

            console.log("[TicketInsight] Rendered: " + p.priceBuckets.length + " price levels, " +
                                    p.sections.length + " sections, " + p.totalTickets + " tickets");
     }

     // ===== POPUP COMMUNICATION =====
     chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
                 if (msg.type === "getTicketData") {
                                 sendResponse({ data: processedData, facetsRaw: facetsData });
                 }
                 return true;
     });

     // ===== EVENT LISTENER FOR DATA FROM INJECTED SCRIPT =====
     window.addEventListener("message", function(ev) {
                 if (!ev.data || !ev.data.type) return;

                                     if (ev.data.type === "xhrData" && ev.data.data) {
                                                     try {
                                                                         var d = typeof ev.data.data === "string" ? JSON.parse(ev.data.data) : ev.data.data;
                                                                         if (d && d.facets && d._embedded) {
                                                                                                 facetsData = d;
                                                                                                 var processed = processFacetsData(d);
                                                                                                 if (processed && processed.totalTickets > 0) {
                                                                                                                             renderOverlay(processed);
                                                                                                     }
                                                                         }
                                                     } catch(e) {
                                                                         console.error("[TicketInsight] Parse error:", e);
                                                     }
                                     }

                                     if (ev.data.type === "workerDataChunk") {
                                                     if (ev.data.chunkIndex === 0) chunkedData = "";
                                                     try {
                                                                         var bytes = new Uint8Array(ev.data.chunk);
                                                                         chunkedData += new TextDecoder("utf-8").decode(bytes);
                                                     } catch(e) {}
                                     }

                                     if (ev.data.type === "workerDataComplete" && chunkedData) {
                                                     try {
                                                                         var d = JSON.parse(chunkedData);
                                                                         if (d && d.facets && d._embedded) {
                                                                                                 facetsData = d;
                                                                                                 var processed = processFacetsData(d);
                                                                                                 if (processed && processed.totalTickets > 0) {
                                                                                                                             renderOverlay(processed);
                                                                                                     }
                                                                         }
                                                     } catch(e) {}
                                                     chunkedData = "";
                                     }
     });

     console.log("[TicketInsight] Content script loaded v2.1");
})()
