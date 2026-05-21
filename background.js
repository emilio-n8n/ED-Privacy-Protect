// ── background.js ────────────────────────────────────────────────────────────
// Compatible Chrome, Edge et Firefox (MV2).
// Blocklist statique — pas de gestion dynamique depuis le popup.

// ── Shim cross-browser ────────────────────────────────────────────────────────
// Firefox expose `browser` (promises natives) ; Chrome expose `chrome` (callbacks).
console.log('check!')
const api = (() => {
  if (typeof browser !== "undefined" && browser.runtime) return browser;

  const promisify = (fn) => (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });

  return {
    storage: {
      local: {
        get: promisify(chrome.storage.local.get.bind(chrome.storage.local)),
        set: promisify(chrome.storage.local.set.bind(chrome.storage.local)),
      },
    },
    runtime: {
      sendMessage: (...a) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(...a, (r) => {
            void chrome.runtime.lastError; // supprime l'erreur "no receiving end"
            resolve(r);
          });
        }),
      onMessage: chrome.runtime.onMessage,
    },
    webRequest: chrome.webRequest,
  };
})();

const TextDec = new TextDecoder();

// ── Blocklist statique ────────────────────────────────────────────────────────
// Modifier cette liste pour ajouter/retirer des règles.
// Supporte les wildcards `*` et les sous-chaînes simples.
const BLOCKLIST = [
  "*/matomo.php",
  "*/bm_info"
];

// ── Constantes ────────────────────────────────────────────────────────────────
const MAX_LOG = 200;

// ── Helpers storage ───────────────────────────────────────────────────────────
async function getLog() {
  const res = await api.storage.local.get("blockedLog");
  return res.blockedLog || [];
}

async function appendLog(entry) {
  const log = await getLog();
  log.unshift(entry);
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  await api.storage.local.set({ blockedLog: log });
}

// ── Correspondance URL / pattern ──────────────────────────────────────────────
function matchesBlocklist(url) {
  return BLOCKLIST.some((p) => {
    try {
      const escaped = p
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(escaped, "i").test(url);
    } catch {
      return url.includes(p);
    }
  });
}

// ── Interception des requêtes ─────────────────────────────────────────────────
api.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!matchesBlocklist(details.url)) return { cancel: false };

    logAndNotify(details, "headers");

    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

api.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!matchesBlocklist(details.url)) return { cancel: false };

    logAndNotify(details, "body");

    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestBody"]
);

async function logAndNotify(details, type) {
  let data = {};
  if (type == "headers") {
    data = details.requestHeaders.find((header) => header.name === "Cookie").value;
  } else if (type == "body") {
    if (details.requestBody.hasOwnProperty('raw') && details.requestBody.raw.length > 0) {
      console.log(details.requestBody)
      data = TextDec.decode(details.requestBody.raw[0].bytes);
    } else {
      data = details.requestBody.formData.data
    }
  }
  const entry = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url:       details.url,
    method:    details.method,
    type:      details.type,
    tabId:     details.tabId,
    timestamp: new Date().toISOString(),
    cookie: data,
    // Firefox utilise `originUrl`, Chrome utilise `initiator`
    initiator: details.initiator || details.originUrl || "unknown",
  };
  console.log("Intercepted :", type, details, entry)
  await appendLog(entry);
  api.runtime.sendMessage({ type: "REQUEST_BLOCKED", entry }).catch(() => {});
}

async function getCookies() {

}

// ── API messages (popup ↔ background) ────────────────────────────────────────
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_LOG") {
    getLog().then(sendResponse);
    return true;
  }
  if (msg.type === "CLEAR_LOG") {
    api.storage.local.set({ blockedLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
});