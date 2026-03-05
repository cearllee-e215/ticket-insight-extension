// XHR + Fetch Interceptor - Intercepts Ticketmaster ISMDS API responses
(function() {
    "use strict";

   var bestData = "";

   function isTargetUrl(u) {
         return u && typeof u === "string" && (
                 u.includes("ticketmaster.com") || u.includes("ticketmaster.ca") || u.includes("livenation.com")
               );
   }

   function isFacetsUrl(u) {
         return u && typeof u === "string" && u.includes("/api/ismds/event/") && u.includes("facets");
   }

   function hasValidFacets(d) {
         try {
                 return d && d.facets && Array.isArray(d.facets) && d.facets.length > 0 &&
                           d._embedded && d._embedded.offer && d.facets[0].offers;
         } catch(e) { return false; }
   }

   function sendToContentScript(data) {
         var str = typeof data === "string" ? data : JSON.stringify(data);
         if (!str || str.length === 0) return;
         if (str.length > bestData.length) bestData = str;
         try {
                 if (str.length > 4194304) {
                           var CS = 1048576, blob = new Blob([str]), offset = 0;
                           function next() {
                                       if (offset >= blob.size) { window.postMessage({type:"workerDataComplete"}, "*"); return; }
                                       var slice = blob.slice(offset, Math.min(offset + CS, blob.size));
                                       var reader = new FileReader();
                                       reader.onload = function(e) {
                                                     window.postMessage({type:"workerDataChunk", chunk: Array.from(new Uint8Array(e.target.result)), chunkIndex: Math.floor(offset/CS)}, "*");
                                                     offset += CS;
                                                     next();
                                       };
                                       reader.readAsArrayBuffer(slice);
                           }
                           next();
                 } else {
                           window.postMessage({type:"xhrData", data: str}, "*");
                 }
         } catch(e) {
                 console.error("[TicketInsight] sendToContentScript error:", e);
         }
   }

   function tryProcess(text) {
         try {
                 if (!text || text.trim() === "") return;
                 var d = JSON.parse(text);
                 if (hasValidFacets(d)) {
                           console.log("[TicketInsight] Captured ISMDS facets data (" + d.facets.length + " facets, " + d._embedded.offer.length + " offers)");
                           sendToContentScript(d);
                 }
         } catch(e) {}
   }

   // ===== XHR Interceptor =====
   var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

   XMLHttpRequest.prototype.open = function(method, url) {
         this._tiUrl = url;
         this._tiMethod = method;
         return origOpen.apply(this, arguments);
   };

   XMLHttpRequest.prototype.send = function(body) {
         var self = this;
         if (isTargetUrl(this._tiUrl)) {
                 this.addEventListener("readystatechange", function() {
                           if (self.readyState !== 4) return;
                           try {
                                       var rUrl = self.responseURL || self._tiUrl || "";
                                       if (isFacetsUrl(rUrl)) {
                                                     var txt = "";
                                                     if (self.responseType === "" || self.responseType === "text") {
                                                                     txt = self.responseText || "";
                                                     } else if (self.responseType === "json" && self.response) {
                                                                     txt = JSON.stringify(self.response);
                                                     } else if (self.responseType === "arraybuffer" && self.response) {
                                                                     txt = new TextDecoder("utf-8").decode(self.response);
                                                     }
                                                     tryProcess(txt);
                                       }
                           } catch(e) {}
                 });
         }
         return origSend.apply(this, arguments);
   };

   // ===== Fetch Interceptor =====
   var origFetch = window.fetch;
    window.fetch = function(input, init) {
          var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
          return origFetch.apply(this, arguments).then(function(response) {
                  if (isTargetUrl(url) && isFacetsUrl(url)) {
                            var cloned = response.clone();
                            cloned.text().then(function(txt) {
                                        tryProcess(txt);
                            }).catch(function() {});
                  }
                  return response;
          });
    };

   console.log("[TicketInsight] XHR + Fetch interceptor loaded");
})();
