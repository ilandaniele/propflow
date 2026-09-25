/**
 * GET /widget/[publicKey] body — the iframe's own document. Served same-
 * origin (so /api/agent/web/* needs no CORS), with a strict CSP the route
 * sets via headers (this module only renders HTML/JS, never a
 * Content-Security-Policy meta tag — the route's header is authoritative).
 *
 * Security (§4/§6): every org-provided string is embedded via JSON, with
 * `<` escaped to `<` so a greeting containing `</script>` can never
 * break out of the inline `<script>` block. Nothing is ever written with
 * innerHTML — the runtime script only ever uses textContent / DOM APIs.
 */

const ACCENT_COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_ACCENT = '#2563eb';

export interface RenderWidgetFrameOptions {
  nonce: string;
  publicKey: string;
  orgName: string;
  greeting: string | null;
  accentColor: string | null;
  allowedOrigins: string[];
  initialListingRef: string | null;
}

/** JSON-encodes a value for embedding inside an inline `<script>` block — `<` becomes `<` so `</script>` (or `<!--`) can never terminate the block early. */
function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const FRAME_RUNTIME_JS = `(function () {
  "use strict";
  var CONFIG = window.__PF_CONFIG__;
  var TOKEN_KEY = "pf_wst_" + CONFIG.publicKey;
  var messagesEl = document.getElementById("pf-messages");
  var formEl = document.getElementById("pf-form");
  var inputEl = document.getElementById("pf-input");
  var greetingEl = document.getElementById("pf-greeting");
  var ctaEl = document.getElementById("pf-cta");
  var currentListingRef = CONFIG.initialListingRef || null;

  document.title = CONFIG.orgName ? (CONFIG.orgName + " — Chat") : "Chat";
  if (greetingEl && CONFIG.greeting) greetingEl.textContent = CONFIG.greeting;

  function getToken() {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(token) {
    try { window.localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* storage unavailable */ }
  }

  function createSession() {
    return fetch("/api/agent/web/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: CONFIG.publicKey,
        pageUrl: document.referrer ? document.referrer.slice(0, 500) : undefined,
        listingRef: currentListingRef || undefined,
      }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error("session_failed");
        setToken(r.body.token);
        return r.body;
      });
  }

  function addBubble(role, text) {
    var bubble = document.createElement("div");
    bubble.className = "pf-bubble pf-bubble-" + role;
    bubble.textContent = text; // never innerHTML — model/user text is untrusted
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function renderCta(cta) {
    ctaEl.textContent = "";
    if (!cta) return;
    var a = document.createElement("a");
    a.href = cta.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "pf-cta-button";
    a.textContent = cta.label;
    ctaEl.appendChild(a);
  }

  function sendMessage(text, retried) {
    var token = getToken();
    var proceed = token ? Promise.resolve(token) : createSession().then(function (s) { return s.token; });

    return proceed.then(function (tok) {
      return fetch("/api/agent/web/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({
          publicKey: CONFIG.publicKey,
          text: text,
          listingRef: currentListingRef,
          pageUrl: document.referrer ? document.referrer.slice(0, 500) : null,
        }),
      }).then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; });
      });
    }).then(function (r) {
      if (r.status === 401 && r.body && r.body.error && r.body.error.code === "SESSION" && !retried) {
        setToken("");
        return sendMessage(text, true);
      }
      if (r.body && r.body.reply) {
        addBubble("assistant", r.body.reply);
        renderCta(r.body.cta || null);
      } else if (r.body && r.body.error) {
        addBubble("assistant", r.body.error.message || "No pudimos procesar tu mensaje.");
      }
    }).catch(function () {
      addBubble("assistant", "No pudimos conectar. Probá de nuevo en un momento.");
    });
  }

  if (formEl) {
    formEl.addEventListener("submit", function (evt) {
      evt.preventDefault();
      var text = (inputEl.value || "").trim().slice(0, 1000);
      if (!text) return;
      inputEl.value = "";
      addBubble("user", text);
      sendMessage(text, false);
    });
  }

  // Only ever accept context from the actual parent frame, and only when
  // its origin is one this org explicitly allow-listed — never a bare '*'.
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (CONFIG.allowedOrigins.indexOf(event.origin) === -1) return;
    var data = event.data || {};
    if (data.type === "propflow:context" && typeof data.listingRef === "string") {
      currentListingRef = data.listingRef || null;
    }
  });

  function notifyParent(type, extra) {
    try {
      var msg = Object.assign({ type: type }, extra || {});
      window.parent.postMessage(msg, "*");
    } catch (e) { /* no parent, or blocked — fine, the widget still works standalone */ }
  }

  var resizeObserver = window.ResizeObserver ? new ResizeObserver(function () {
    notifyParent("propflow:resize", { height: document.documentElement.scrollHeight });
  }) : null;
  if (resizeObserver) resizeObserver.observe(document.documentElement);
})();
`;

export function renderWidgetFrame(o: RenderWidgetFrameOptions): string {
  const accent = o.accentColor && ACCENT_COLOR_RE.test(o.accentColor) ? o.accentColor : DEFAULT_ACCENT;
  const config = {
    publicKey: o.publicKey,
    orgName: o.orgName,
    greeting: o.greeting,
    initialListingRef: o.initialListingRef,
    allowedOrigins: o.allowedOrigins,
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Chat</title>
<style nonce="${o.nonce}">
  :root { --pf-accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; display: flex; flex-direction: column; height: 100vh; }
  #pf-header { padding: 12px 16px; background: var(--pf-accent); color: #fff; }
  #pf-messages { flex: 1; overflow-y: auto; padding: 12px; }
  .pf-bubble { max-width: 80%; margin: 6px 0; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
  .pf-bubble-user { margin-left: auto; background: var(--pf-accent); color: #fff; }
  .pf-bubble-assistant { margin-right: auto; background: #f1f1f1; color: #111; }
  #pf-cta { padding: 0 12px 8px; }
  .pf-cta-button { display: inline-block; padding: 8px 14px; border-radius: 8px; background: #25d366; color: #fff; text-decoration: none; }
  #pf-form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
  #pf-input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 8px; }
  #pf-form button { padding: 8px 14px; border: none; border-radius: 8px; background: var(--pf-accent); color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <div id="pf-header"><span id="pf-greeting">Hola, ¿en qué te puedo ayudar?</span></div>
  <div id="pf-messages"></div>
  <div id="pf-cta"></div>
  <form id="pf-form">
    <input id="pf-input" type="text" maxlength="1000" autocomplete="off" placeholder="Escribí tu mensaje…" />
    <button type="submit">Enviar</button>
  </form>
  <script nonce="${o.nonce}">window.__PF_CONFIG__ = ${toScriptJson(config)};</script>
  <script nonce="${o.nonce}">${FRAME_RUNTIME_JS}</script>
</body>
</html>
`;
}
