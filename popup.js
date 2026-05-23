// ── LOG ──────────────────────────────────────────────────────────────────────
let logEntries = [];

function send(msg) {
  return new Promise(res => chrome.runtime.sendMessage(msg, res));
}


async function refreshLog() {
  logEntries = await send({ type: "GET_LOG" }) || [];
  renderLog(logEntries);
}

function renderLog(logs) {
    content = document.getElementById('req-list')
    content.innerHTML = "";
    counter = document.getElementById('counter')
    getTabsRequests(logs).then((tabLogs) => {
        counter.innerText = tabLogs.length
        tabLogs.forEach(request => {
            content.innerHTML += genReqElement(request) + "<hr>"
        });
        console.log(tabLogs.length)
        genShield(tabLogs.length)
    })
}

document.getElementById("clear").addEventListener("click", async () => {
  await send({ type: "CLEAR_LOG" });
  logEntries = [];
  renderLog([]);
});

// ── LIVE UPDATE when popup is open ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "REQUEST_BLOCKED") {
    logEntries.unshift(msg.entry);
    renderLog(logEntries);
  }
});

// ── UTILS ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function shortHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

async function getCurrentTab() {
  let tab;
  if (this.hasOwnProperty('browser')) {
    [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });
  } else {
    [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
  }

  return tab;
}

async function getTabsRequests(logs) {
    return await getCurrentTab().then((tab) => {
        return logs.filter((request) => request.tabId === tab.id)
    })
}

// ── PARSING ────────────────────────────────────────────────────────────────────

function parseMatomo(req) {
    const data = {
        type: "matomo",
        fullURL: req.url,
        req_cookie: req.cookie
    }
    const url = new URL(req.url);
    const params = new URLSearchParams(url.search);
    for (const [key, value] of params.entries()) {
        data[key] = value;
    }
    return data;
}

function parseBM(req) {
    const date = new Date(req.timestamp);
    const data = {
        type: "bm",
        fullURL: req.url,
        date: date
    }
    const cookies = JSON.parse(req.cookie).browser_info;
    for (const key of Object.keys(cookies)) {
        data[key] = typeof cookies[key] === "object"? JSON.stringify(cookies[key]): cookies[key];
    }
    return data;
}

function parseReq(req) {
    console.log("recieved", req)
    if (req.url.indexOf('/matomo.php') > -1) {
        return parseMatomo(req)
    } else if (req.url.indexOf('/bm_info') > -1) {
        return parseBM(req)
    }
}

function genReqElement(req) {
    const data = parseReq(req)
    let elem = JSON.stringify(data)
    if (data.type === "matomo") {
        elem = `
            <div class="request">
                <h2>Traqueur de visite</h2>
                <p>Nature: visite de la page ${data["action_name"]}</p>
                <p>Capturée par ED à <b>${data["h"]+":"+data["m"]+" et "+data["s"]}s</b>.</p>
                <p>Depuis la page <b>${data["url"]}</b> de résolution <b>${data["res"]}px</b>.</p>
                <details>
                    <summary>Détails de la requête (infos sensibles)</summary>
                    ${genDetailsList(data)}
                </details>
            </div>
        `
    } else if (data.type === "bm") {
        elem = `
            <div class="request">
                <h2>Traqueur d'action</h2>
                <p>Nature: actions/informations</p>
                <p>Capturée par ED à <b>${data.date.getHours()+":"+data.date.getMinutes()+" et "+data.date.getSeconds()}s</b>.</p>
                <p>Depuis la page <b>${data.fullURL}</b>, ${data["Elapsed_Time"]/1000}s après le chargement de la page</b>.</p>
                <details>
                    <summary>Détails de la requête (infos sensibles)</summary>
                    ${genDetailsCode(data)}
                </details>
            </div>`
    }
    return elem
}

function genDetailsList(req) {
    let html = "<ul>";
    Object.keys(req).forEach(key => {
        html += `<li>${key}: ${req[key]}</li>`
    });
    return html + "</ul>";
}

function genDetailsCode(req) {
    let html = "<code>";
    Object.keys(req).forEach(key => {
        html += `${key}: ${req[key]}<br>`
    });
    return html + "</code>";
}

function genShield(n) {
    let shield = document.getElementsByTagName('svg')[0];
    let text = document.getElementById('tspan-nb');
    text.innerHTML = n
}

refreshLog();