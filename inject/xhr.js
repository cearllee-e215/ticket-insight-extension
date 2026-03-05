// XHR Interceptor - Intercepts Ticketmaster ISMDS API responses
(function() {
  "use strict";
  var xhrData = "";

  function getResponseText(xhr) {
    try {
      if ("" === xhr.responseType || "text" === xhr.responseType) return xhr.responseText || "";
      if ("arraybuffer" === xhr.responseType && xhr.response) {
        try { return new TextDecoder("utf-8").decode(xhr.response); }
        catch(e) {
          try { var a=new Uint8Array(xhr.response),t=""; for(var i=0;i<a.length;i++) t+=String.fromCharCode(a[i]); return decodeURIComponent(escape(t)); }
          catch(e2) { return ""; }
        }
      }
      if ("json" === xhr.responseType && xhr.response) return JSON.stringify(xhr.response);
      try { return xhr.responseText || ""; } catch(e) { return ""; }
    } catch(e) { return ""; }
  }

  function getDataSize(d) { try { return d==null?0:("string"===typeof d?d:JSON.stringify(d)).length; } catch(e){return 0;} }

  function sendLargeData(data) {
    var CS=1048576, blob=new Blob([data]), offset=0;
    function next() {
      if(offset>=blob.size){window.postMessage({type:"workerDataComplete"},"*");return;}
      var slice=blob.slice(offset,Math.min(offset+CS,blob.size));
      var reader=new FileReader();
      reader.onload=function(e){
        window.postMessage({type:"workerDataChunk",chunk:e.target.result,chunkIndex:Math.floor(offset/CS),totalChunks:Math.ceil(blob.size/CS)},"*");
        offset+=CS; next();
      };
      reader.readAsArrayBuffer(slice);
    }
    next();
  }

  function safePostMessage(type,data) {
    var size=getDataSize(data);
    if(size>1048576){ sendLargeData("string"===typeof data?data:JSON.stringify(data)); }
    else { window.postMessage({type:type,data:"string"===typeof data?data:JSON.stringify(data)},"*"); }
  }

  function storeXhrData(data) {
    var s="";
    try {
      if(data==null) return;
      if("object"===typeof data){ try{s=JSON.stringify(data);if(!s)return;}catch(e){return;} }
      else if("string"===typeof data) s=data;
      else return;
      if(!s||s.length===0) return;
      if(s.length>xhrData.length) xhrData=s;
      safePostMessage("xhrData",xhrData);
    } catch(e){ console.error("[TicketInsight] storeXhrData error:",e); }
  }

  function isValidEventFacets(d) {
    try {
      if(!d||!d.schema||!d.meta||!d.eventId) return false;
      if(d.schema!=="urn:com.ticketmaster.services:schema:ismds:EventFacets:1.0") return false;
      if(!Array.isArray(d.facets)) return false;
      return d.facets.every(function(f){
        return Array.isArray(f.offers)&&"number"===typeof f.count&&Array.isArray(f.listPriceRange)
          &&f.listPriceRange.every(function(p){return "string"===typeof p.currency&&"number"===typeof p.min&&"number"===typeof p.max;});
      });
    } catch(e){return false;}
  }

  function hasValidFacetsData(d) {
    try { return d&&d.facets&&d.facets.some(function(f){return f.count&&f.offers&&f.totalPriceRange;}); }
    catch(e){return false;}
  }

  function isTargetUrl(u) {
    return u&&"string"===typeof u&&(u.includes("livenation.com")||u.includes("ticketmaster.ca")||u.includes("ticketmaster.com"));
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._tiUrl = url;
    this._tiMethod = method;
    if(this._tiInit){this.removeEventListener("load",this._tiOnLoad);this.removeEventListener("error",this._tiOnErr);}
    this._tiOnLoad=function(){};
    this._tiOnErr=function(){};
    this.addEventListener("load",this._tiOnLoad);
    this.addEventListener("error",this._tiOnErr);
    this._tiInit=true;
    origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    if(isTargetUrl(this._tiUrl)) {
      this.addEventListener("readystatechange", function() {
        if(4!==self.readyState) return;
        var rUrl = self.responseURL || "";

        if(rUrl.includes("/api/ismds/event/") && rUrl.includes("facets")) {
          var txt = getResponseText(self);
          try {
            if(!txt||""===txt.trim()) return;
            var p = JSON.parse(txt);
            if(!p) return;
            if(hasValidFacetsData(p)){storeXhrData(p);console.log("[TicketInsight] Captured EventFacets (ISMDS)");return;}
            if(isValidEventFacets(p)){storeXhrData(p);console.log("[TicketInsight] Captured EventFacets (schema)");return;}
          } catch(e){}
        } else {
          var txt2 = getResponseText(self);
          try {
            if(!txt2||""===txt2.trim()) return;
            var p2 = JSON.parse(txt2);
            if(p2&&isValidEventFacets(p2)){storeXhrData(p2);console.log("[TicketInsight] Captured EventFacets (alt)");}
          } catch(e){}
        }
      });
    }
    origSend.apply(this, arguments);
  };

  console.log("[TicketInsight] XHR interceptor loaded");
})();
