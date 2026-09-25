/**
 * GET /widget.js body — the tiny, CORS-open loader a host page embeds. It
 * never touches the host DOM beyond its own launcher button + iframe, never
 * eval()s anything, and only ever trusts postMessage events whose origin is
 * this app's own origin AND whose source is the iframe it created (§4).
 */

const PUBLIC_KEY_PATTERN = '^pk_[A-Za-z0-9]{24}$';

/** `appOrigin` comes from the server's own config (NEXT_PUBLIC_SITE_URL/NEXTAUTH_URL) — never user input. */
export function buildLoaderScript(appOrigin: string): string {
  return `(function () {
  "use strict";
  var APP_ORIGIN = ${JSON.stringify(appOrigin)};
  var KEY_RE = new RegExp(${JSON.stringify(PUBLIC_KEY_PATTERN)});

  var currentScript = document.currentScript;
  if (!currentScript) return;

  var key = currentScript.dataset.key || "";
  if (!KEY_RE.test(key)) {
    if (window.console && window.console.warn) {
      window.console.warn("[propflow-widget] invalid or missing data-key, widget disabled");
    }
    return;
  }
  var listingRef = currentScript.dataset.listingRef || "";

  var open = false;
  var iframe = null;
  var container = null;
  var launcher = null;

  function frameSrc(ref) {
    var url = APP_ORIGIN + "/widget/" + encodeURIComponent(key);
    if (ref) url += "?ref=" + encodeURIComponent(ref);
    return url;
  }

  function ensureUi() {
    if (container) return;

    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.setAttribute("aria-label", "Abrir chat");
    launcher.textContent = "Chat";
    launcher.style.position = "fixed";
    launcher.style.bottom = "20px";
    launcher.style.right = "20px";
    launcher.style.zIndex = "2147483000";
    launcher.style.borderRadius = "999px";
    launcher.style.padding = "12px 18px";
    launcher.style.border = "none";
    launcher.style.cursor = "pointer";
    launcher.addEventListener("click", function () { setOpen(!open); });

    container = document.createElement("div");
    container.style.position = "fixed";
    container.style.bottom = "88px";
    container.style.right = "20px";
    container.style.width = "380px";
    container.style.maxWidth = "92vw";
    container.style.height = "560px";
    container.style.maxHeight = "80vh";
    container.style.zIndex = "2147483000";
    container.style.display = "none";
    container.style.boxShadow = "0 10px 40px rgba(0,0,0,.25)";
    container.style.borderRadius = "12px";
    container.style.overflow = "hidden";

    iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Chat");
    iframe.src = frameSrc(listingRef);
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    container.appendChild(iframe);

    document.body.appendChild(launcher);
    document.body.appendChild(container);
  }

  function setOpen(next) {
    ensureUi();
    open = next;
    container.style.display = open ? "block" : "none";
  }

  function setListing(ref) {
    listingRef = ref || "";
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "propflow:context", listingRef: listingRef }, APP_ORIGIN);
  }

  window.addEventListener("message", function (event) {
    // Only ever trust a message that (a) came from this app's own origin
    // and (b) was actually sent by the iframe we created — not some other
    // frame on the host page, and not a spoofed origin.
    if (event.origin !== APP_ORIGIN) return;
    if (!iframe || event.source !== iframe.contentWindow) return;
    var data = event.data || {};
    if (data.type === "propflow:resize") {
      if (container && typeof data.height === "number") {
        container.style.height = Math.max(320, Math.min(720, data.height)) + "px";
      }
    } else if (data.type === "propflow:close") {
      setOpen(false);
    }
  });

  window.PropflowWidget = {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    setListing: setListing,
  };
})();
`;
}
