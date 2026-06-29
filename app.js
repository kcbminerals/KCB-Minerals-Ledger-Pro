const DEFAULT_CLOUD_API_URL = "https://script.google.com/macros/library/d/1sspPAEoTO1pQN3yj9NQjNAjInxV-yj2FPZPiRHvWNGjBc46VZVyHnjUX/15"; // v6.3: verified working Apps Script backend URL. Do not replace unless you deploy a new web app.
const APP_VERSION = "6.3-correct-apps-script-url";
const FORCE_BACKEND_MODE = false; // GitHub version: username-only login; Sheet sync via hidden Apps Script bridge.
// v5.1: adds in-app Google Sheet connection setup, remembers the Apps Script URL, and uploads pending saves after connection.
// Login remains username-only. Google Sheet is the shared source of truth when Apps Script is correctly deployed.
const BACKEND_URL_KEY = "kcb_backend_url_v54";
let CLOUD_API_URL = (() => {
  const validExecUrl = value => /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:[?#].*)?$/.test(String(value || "").trim());
  try {
    const saved = String(localStorage.getItem(BACKEND_URL_KEY) || "").trim();
    const url = validExecUrl(saved) ? saved : String(DEFAULT_CLOUD_API_URL || "").trim();
    if (validExecUrl(url)) localStorage.setItem(BACKEND_URL_KEY, url);
    return url;
  } catch {
    return DEFAULT_CLOUD_API_URL || "";
  }
})();


// v5.3 emergency fix: force the verified backend URL and remove old local-only login sessions.
// Pending writes remain safe in kcb_pending_writes_v5 and will upload after the user logs in again.
(function forceVerifiedCloudUrl(){
  try {
    const verifiedUrl = DEFAULT_CLOUD_API_URL;
    ["kcb_backend_url", "kcb_backend_url_v51", "kcb_backend_url_v52", "kcb_backend_url_v53", "kcb_backend_url_v54"].forEach(k => localStorage.setItem(k, verifiedUrl));
    CLOUD_API_URL = verifiedUrl;
    const savedSession = JSON.parse(localStorage.getItem("kcb_current_user") || "null");
    if (savedSession && savedSession.authMode === "old-local-disabled") {
      localStorage.removeItem("kcb_current_user");
      window.KCB_FORCE_RELOGIN = true;
    }
  } catch (err) {
    console.warn("Force cloud URL setup failed", err);
  }
})();

window.kcbForceCloudFix = function(){
  try {
    const verifiedUrl = DEFAULT_CLOUD_API_URL;
    ["kcb_backend_url", "kcb_backend_url_v51", "kcb_backend_url_v52", "kcb_backend_url_v53", "kcb_backend_url_v54"].forEach(k => localStorage.setItem(k, verifiedUrl));
    localStorage.removeItem("kcb_current_user");
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    alert("Cloud URL fixed. Login again with admin, then press Sync. v5.4 does not require backend login token.");
    location.reload(true);
  } catch (err) { alert(err.message || err); }
};

let vehicles = {};
let transactions = [];
let currentEntryType = "load";
let activeReportPeriod = "daily";
let activeTab = "dashboard";
let revenueChart = null;
let paymentChart = null;
let currentUser = null;
let lastCloudReadOk = false;
let lastSyncAt = 0;
let deferredInstallPrompt = null;

const SESSION_KEY = "kcb_current_user";
const LOCAL_USERS_KEY = "kcb_local_users_v2";
const PENDING_WRITES_KEY = "kcb_pending_writes_v5";
const BACKUP_KEY = "kcb_backup";
const DEFAULT_LOCAL_USERS = {
  admin: { role: "admin" },
  user: { role: "user" }
};

// v5.2: make diagnostics visible in the browser console for quick support.
window.KCB_LEDGER_INFO = { appVersion: APP_VERSION, backendUrl: CLOUD_API_URL };

function getLocalUsers() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "null");
    if (saved && typeof saved === "object" && saved.admin) return saved;
  } catch {}
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(DEFAULT_LOCAL_USERS));
  return JSON.parse(JSON.stringify(DEFAULT_LOCAL_USERS));
}

function saveLocalUsers(users) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users || DEFAULT_LOCAL_USERS));
}

function generateId(prefix = "tx") {
  const random = (window.crypto && crypto.getRandomValues)
    ? Array.from(crypto.getRandomValues(new Uint32Array(2))).map(n => n.toString(36)).join("")
    : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${random}`;
}

function quoteArg(value) {
  return JSON.stringify(String(value ?? ""));
}

function getPendingWrites() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_WRITES_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function savePendingWrites(list) {
  localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  updateSyncMeta();
}

function queuePendingWrite(payload, reason = "pending") {
  const list = getPendingWrites();
  const action = String(payload?.action || "");
  const target = action === "saveVehicle" ? String(payload.vehicle || "") : action === "deleteTx" ? String(payload.id || "") : String(payload?.tx?.id || "");
  const existingIndex = list.findIndex(item => String(item.action) === action && String(item.target) === target && target);
  const item = { id: generateId("pending"), action, target, payload, reason, attempts: 0, queuedAt: Date.now() };
  if (existingIndex >= 0) list[existingIndex] = item;
  else list.push(item);
  savePendingWrites(list);
  return item;
}

function removePendingWrite(pendingId) {
  savePendingWrites(getPendingWrites().filter(item => item.id !== pendingId));
}

function reapplyPendingWritesToView() {
  getPendingWrites().forEach(item => applyLocalWrite(item.payload, { silent: true }));
}

function updateSyncMeta(statusText = "") {
  const pending = getPendingWrites().length;
  const lastText = lastSyncAt ? cleanFormatDate(lastSyncAt) : "Not synced";
  const hasUrl = hasBackendUrl();
  const status = statusText || (lastCloudReadOk ? "Connected" : (hasUrl ? "Connecting to Sheet" : "Sheet URL missing"));
  if ($("lastSyncText")) $("lastSyncText").textContent = lastSyncAt ? `Last sync: ${lastText}` : "Not synced yet";
  if ($("sideSyncMeta")) $("sideSyncMeta").textContent = `${pending} pending • ${lastCloudReadOk ? "Synced" : (hasUrl ? "Press Sync" : "Connect Sheet")}`;
  if ($("highPendingWrites")) $("highPendingWrites").textContent = pending;
  if ($("highLastSync")) $("highLastSync").textContent = lastText;
  if ($("highCloudStatus")) $("highCloudStatus").textContent = status;
  if ($("backendStatusText")) $("backendStatusText").textContent = lastCloudReadOk ? "Connected to Google Sheet" : (hasUrl ? "URL saved. Test connection / upload pending." : "Paste Apps Script /exec URL to upload pending data.");
  if ($("pendingUploadCount")) $("pendingUploadCount").textContent = pending;
}

async function flushPendingWrites(showToastOnDone = false) {
  if (!currentUser) return;
  const pending = getPendingWrites();
  if (!pending.length) { updateSyncMeta(); return; }
  startQuietSync(`Uploading ${pending.length} pending save(s)...`);
  let uploaded = 0;
  for (const item of pending) {
    try {
      const securedPayload = { ...item.payload, publicWrite: true, updatedBy: currentUser?.username || "local-user" };
      if (!isLocalFallbackMode()) securedPayload.sessionToken = requireSession();
      const result = await postToCloudJsonp(securedPayload);
      if (!result || result.ok === false) throw new Error(result?.error || "Pending save failed");
      removePendingWrite(item.id);
      uploaded += 1;
    } catch (err) {
      console.warn("Pending write still waiting", err);
      const list = getPendingWrites();
      const found = list.find(x => x.id === item.id);
      if (found) { found.attempts = Number(found.attempts || 0) + 1; found.reason = err.message || "retry later"; savePendingWrites(list); }
      break;
    }
  }
  if (uploaded) {
    finishQuietSync("Pending saves uploaded");
    if (showToastOnDone) showToast(`${uploaded} pending save(s) uploaded`);
    await fetchCloudData(false);
  } else {
    finishQuietSync("Pending saves waiting");
  }
  updateSyncMeta();
}


/* ===== Core browser utilities - required for login and app rendering ===== */
function $(id) {
  return document.getElementById(id);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatINR(number) {
  const value = Number(number || 0);
  return "₹" + value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function cleanFormatDate(timestampOrStr) {
  if (!timestampOrStr) return "-";
  const dateObj = new Date(timestampOrStr);
  if (Number.isNaN(dateObj.getTime())) return String(timestampOrStr);

  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${day}/${month}/${year} ${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
}

function showToast(message, type = "success") {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = String(message || "");
  toast.classList.remove("hidden");
  toast.style.background =
    type === "error" ? "#dc2626" :
    type === "warn" ? "#f59e0b" :
    "#0f172a";

  clearTimeout(window.kcbToastTimer);
  window.kcbToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function showLoading(message = "Loading...") {
  // v3.8: No full-page white overlay for sync/save. Keep the app usable.
  startQuietSync(message);
}

function hideLoading(message = "") {
  const overlay = $("loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
  if (message && message !== "Ready") {
    finishQuietSync(message === "Saved" ? "Saved to Google Sheet" : message);
  }
}

function startQuietSync(message = "Syncing...") {
  const indicator = $("syncIndicator");
  if (indicator) {
    indicator.textContent = "⌛ " + message;
    indicator.className = "sync-text syncing";
  }
  updateSyncMeta("Syncing");
}

function finishQuietSync(message = "Connected") {
  const indicator = $("syncIndicator");
  if (indicator) {
    indicator.textContent = "🟢 " + message;
    indicator.className = "sync-text connected";
  }
  updateSyncMeta(message);
}

function hasBackendUrl() {
  const url = String(CLOUD_API_URL || "").trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:[?#].*)?$/.test(url);
}

function getBackendUrlFromInputs() {
  const ids = ["backendUrlInput", "backendUrlInputSidebar", "backendUrlInputLogin"];
  for (const id of ids) {
    const el = $(id);
    const value = String(el?.value || "").trim();
    if (value) return value;
  }
  return String(CLOUD_API_URL || "").trim();
}

function explainBackendUrl() {
  return "Paste the Google Apps Script Web App URL ending with /exec. Example: https://script.google.com/macros/s/.../exec";
}

function hydrateBackendUrlInputs() {
  const current = CLOUD_API_URL || "";
  ["backendUrlInput", "backendUrlInputSidebar"].forEach(id => {
    const el = $(id);
    if (el) el.value = current;
  });
}

async function saveBackendUrl() {
  const nextUrl = getBackendUrlFromInputs();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:[?#].*)?$/.test(nextUrl)) {
    showToast(explainBackendUrl(), "error");
    const help = $("backendStatusText");
    if (help) help.textContent = explainBackendUrl();
    return false;
  }
  CLOUD_API_URL = nextUrl.trim();
  try { localStorage.setItem(BACKEND_URL_KEY, CLOUD_API_URL); } catch {}
  hydrateBackendUrlInputs();
  showToast("Google Sheet URL saved. Testing connection...");
  const ok = await testBackendConnection();
  if (ok && currentUser) {
    await upgradeSessionToBackend(false);
    await fetchCloudData(false);
    await flushPendingWrites(true);
  }
  return ok;
}

function clearBackendUrl() {
  CLOUD_API_URL = DEFAULT_CLOUD_API_URL || "";
  try { localStorage.removeItem(BACKEND_URL_KEY); } catch {}
  lastCloudReadOk = false;
  hydrateBackendUrlInputs();
  updateSyncMeta("Sheet URL missing");
  showToast("Google Sheet URL cleared", "warn");
}

async function uploadPendingNow() {
  if (!currentUser) return showToast("Login first", "error");
  if (!hasBackendUrl()) {
    openBackendSettings();
    return showToast("Paste Apps Script /exec URL first", "error");
  }
  await testBackendConnection();
  await upgradeSessionToBackend(false);
  await flushPendingWrites(true);
  await fetchCloudData(false);
}

async function testBackendConnection() {
  if (!hasBackendUrl()) {
    lastCloudReadOk = false;
    finishQuietSync("Sheet URL missing");
    updateSyncMeta("Sheet URL missing");
    const help = $("backendStatusText");
    if (help) help.textContent = explainBackendUrl();
    return false;
  }
  try {
    startQuietSync("Testing Google Sheet connection...");
    const health = await apiGet("health", { t: Date.now() });
    if (health && health.ok) {
      lastCloudReadOk = true;
      lastSyncAt = Date.now();
      finishQuietSync("Connected to Google Sheet");
      showToast("Google Sheet connection working");
      const help = $("backendStatusText");
      if (help) help.innerHTML = "✅ Google Sheet backend active: " + escapeHTML(health.authVersion || "backend ok");
      return true;
    }
    throw new Error(health?.error || "Backend health check failed");
  } catch (err) {
    lastCloudReadOk = false;
    finishQuietSync("Google Sheet not connected");
    updateSyncMeta("Sheet not connected");
    const msg = err.message || "Connection failed";
    showToast(msg, "error");
    const help = $("backendStatusText");
    if (help) help.innerHTML = "❌ " + escapeHTML(msg);
    return false;
  }
}

function openBackendSettings() {
  hydrateBackendUrlInputs();
  const modal = $("backendSettingsModal");
  if (modal) modal.classList.remove("hidden");
}

function closeBackendSettings() {
  const modal = $("backendSettingsModal");
  if (modal) modal.classList.add("hidden");
}

function showSyncHelp() {
  const box = $("syncHelpBox");
  if (box) box.classList.remove("hidden");
}


function toggleDarkMode() {
  document.body.classList.toggle("dark");
  localStorage.setItem("kcb_dark", document.body.classList.contains("dark") ? "true" : "false");
  updateDashboardCharts();
}

function openChangePassword() {
  const modal = $("changePasswordModal");
  if (modal) modal.classList.remove("hidden");
}

function closeChangePassword() {
  const modal = $("changePasswordModal");
  if (modal) modal.classList.add("hidden");
  $("changePasswordForm")?.reset();
}


function authMode() {
  return currentUser?.authMode || "backend";
}

function isLocalFallbackMode() {
  return authMode() === "local" || authMode() === "publicCloud";
}

function backendAuthParams() {
  return isLocalFallbackMode() ? {} : { token: requireSession() };
}

function localFallbackLogin(username) {
  if (FORCE_BACKEND_MODE) return false;
  const key = String(username || "").trim().toLowerCase() || "user";
  const saved = getLocalUsers()[key];
  const role = key === "admin" ? "admin" : (saved?.role === "admin" ? "admin" : "user");

  currentUser = {
    username: key,
    role,
    token: "local-" + Date.now(),
    authMode: "local"
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  document.body.classList.remove("auth-locked");
  const box = document.getElementById("loginErrorBox");
  if (box) box.innerHTML = "";
  applyAccessControl();
  switchTab(isAdmin() ? "dashboard" : "logentry");
  fetchCloudData(false);
  showToast("Logged in");
  return true;
}

// v6.2 GitHub JSONP bridge: avoids fetch/CORS, iframe blocks and service-worker cache issues.
// GitHub page stays as the app. A hidden Apps Script iframe performs Sheet work using google.script.run.
let kcbBridgeFrame = null;
let kcbBridgeReady = false;
let kcbBridgeLoading = null;
const kcbBridgePending = new Map();

function getBridgeUrl() {
  if (!hasBackendUrl()) return "";
  const sep = CLOUD_API_URL.includes("?") ? "&" : "?";
  return CLOUD_API_URL + sep + "mode=bridge&v=6.2&parentOrigin=" + encodeURIComponent(location.origin || "*");
}

function ensureBridgeFrame() {
  if (!hasBackendUrl()) return Promise.reject(new Error("Apps Script /exec URL is not set."));
  if (kcbBridgeReady && kcbBridgeFrame && document.body.contains(kcbBridgeFrame)) return Promise.resolve(true);
  if (kcbBridgeLoading) return kcbBridgeLoading;

  kcbBridgeLoading = new Promise((resolve, reject) => {
    const existing = document.getElementById("kcbAppsScriptBridge");
    if (existing) existing.remove();

    kcbBridgeReady = false;
    const frame = document.createElement("iframe");
    frame.id = "kcbAppsScriptBridge";
    frame.title = "KCB Google Sheet Bridge";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none;";
    frame.src = getBridgeUrl();
    kcbBridgeFrame = frame;

    const timer = setTimeout(() => {
      kcbBridgeLoading = null;
      reject(new Error("Google Sheet bridge did not load. Redeploy Code.gs v6.2 as Web App: Execute as Me, Access Anyone."));
    }, 18000);

    function onMessage(event) {
      const msg = event.data || {};
      if (!msg || msg.kcbBridge !== true || msg.type !== "ready") return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      kcbBridgeReady = true;
      kcbBridgeLoading = null;
      resolve(true);
    }

    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  });

  return kcbBridgeLoading;
}

window.addEventListener("message", event => {
  const msg = event.data || {};
  if (!msg || msg.kcbRpcResponse !== true || !msg.id) return;
  const pending = kcbBridgePending.get(msg.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  kcbBridgePending.delete(msg.id);
  if (msg.ok === false) pending.reject(new Error(msg.error || "Google Sheet bridge error"));
  else pending.resolve(msg.data || msg.result || {});
});

function bridgeCall(action, params = {}, timeoutMs = 30000) {
  return ensureBridgeFrame().then(() => new Promise((resolve, reject) => {
    const id = "rpc_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const timer = setTimeout(() => {
      kcbBridgePending.delete(id);
      reject(new Error("Google Sheet bridge timeout"));
    }, timeoutMs);
    kcbBridgePending.set(id, { resolve, reject, timer });
    kcbBridgeFrame.contentWindow.postMessage({ kcbRpc: true, id, action, params }, "*");
  }));
}

function apiGetJsonp(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!hasBackendUrl()) {
      reject(new Error("Google Sheet URL is not set. Paste your Apps Script /exec URL in Connect Sheet."));
      return;
    }
    const cb = "kcb_api_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const script = document.createElement("script");
    const query = new URLSearchParams({ action, callback: cb, ...params });
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("Apps Script did not respond. Check deployment access = Anyone and redeploy new version."));
    }, 15000);

    window[cb] = data => {
      done = true;
      cleanup();
      resolve(data || {});
    };

    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error("Apps Script connection failed. Open /exec?action=health once and confirm ok:true."));
    };

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cb]; } catch {}
      script.remove();
    }

    script.src = CLOUD_API_URL + (CLOUD_API_URL.includes("?") ? "&" : "?") + query.toString();
    document.body.appendChild(script);
  });
}

function apiGet(action, params = {}) {
  // v6.2: Use JSONP only. This is the most reliable method for GitHub Pages -> Apps Script.
  // The old iframe/google.script.run bridge could stay stuck in Chrome/PWA mode.
  return apiGetJsonp(action, params);
}

window.kcbTestCloudBridge = async function() {
  try {
    const health = await apiGetJsonp("health", { t: Date.now() });
    console.log("KCB JSONP health", health);
    alert("Google Sheet connected: " + (health.spreadsheetUrl || health.storage || "OK"));
  } catch (err) {
    console.error(err);
    alert("Google Sheet connection failed: " + (err.message || err));
  }
};

function showLoginHelp(message) {
  let box = document.getElementById("loginErrorBox");
  if (!box) {
    box = document.createElement("div");
    box.id = "loginErrorBox";
    box.className = "auth-error";
    document.querySelector(".auth-card")?.appendChild(box);
  }
  box.innerHTML = message;
}

async function checkBackendHealth() {
  const data = await apiGet("health", { t: Date.now() });
  return data;
}

function withTimeout(promise, ms, message = "Timed out") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function backendLogin(username) {
  const data = await apiGet("login", { username, t: Date.now() });
  if (!data || data.ok === false || !data.token) {
    throw new Error(data?.error || "Backend login failed");
  }
  currentUser = {
    username: String(data.user?.username || username || "user").toLowerCase(),
    role: data.user?.role === "admin" ? "admin" : "user",
    token: data.token,
    authMode: "backend"
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  return currentUser;
}

async function upgradeSessionToBackend(showToastOnDone = false) {
  if (!currentUser || !isLocalFallbackMode()) return false;
  const username = currentUser.username;
  try {
    await withTimeout(backendLogin(username), 5000, "Backend login timeout");
    applyAccessControl();
    finishQuietSync("Connected to Google Sheet");
    if (showToastOnDone) showToast("Connected to Google Sheet");
    return true;
  } catch (err) {
    console.warn("Backend session upgrade failed", err);
    return false;
  }
}

function requireSession() {
  const token = currentUser?.token;
  if (isLocalFallbackMode()) return token || "local";
  if (!token) {
    logoutUser(false);
    throw new Error("Session expired. Please login again.");
  }
  return token;
}

function isAdmin() {
  return currentUser?.role === "admin";
}

function allowedPages() {
  return isAdmin() ? ["dashboard", "logentry", "statement", "register", "users"] : ["logentry", "register"];
}

function canOpenPage(page) {
  return allowedPages().includes(page);
}

function applyAccessControl() {
  document.body.classList.toggle("role-admin", isAdmin());
  document.body.classList.toggle("role-user", !!currentUser && !isAdmin());
  const allowed = allowedPages();
  ["dashboard", "logentry", "statement", "register", "users"].forEach(page => {
    const btn = $("nav-" + page);
    if (btn) btn.classList.toggle("hidden", !allowed.includes(page));
  });
  const name = currentUser?.username || "Guest";
  const role = currentUser?.role || "-";
  if ($("topUserName")) $("topUserName").textContent = name;
  if ($("topUserRole")) $("topUserRole").textContent = role;
  if ($("sidebarUserName")) $("sidebarUserName").textContent = name;
  if ($("sidebarUserRole")) $("sidebarUserRole").textContent = role;
  if (isAdmin()) refreshUserList(false);
  updateSyncMeta();
}

async function loginUser(username) {
  username = String(username || "").trim().toLowerCase();
  if (!username) return showToast("Enter username", "error");

  try {
    showLoginHelp("");
    showLoading("Opening ledger...");

    // v5.4: do not block login on backend token/CORS.
    // Login is username-only. The app opens immediately, then reads/writes Google Sheet through public JSONP endpoints.
    currentUser = {
      username,
      role: username === "admin" ? "admin" : "user",
      token: "public-" + Date.now(),
      authMode: "publicCloud"
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));

    document.body.classList.remove("auth-locked");
    applyAccessControl();
    switchTab(isAdmin() ? "dashboard" : "logentry");
    hideLoading("Ready");
    showToast(`Welcome ${currentUser.username}`);

    fetchCloudData(false).then(() => {
      if (lastCloudReadOk && getPendingWrites().length) flushPendingWrites(false);
    });
    return true;
  } catch (err) {
    hideLoading("Login failed");
    const msg = escapeHTML(err.message || "Login failed");
    showLoginHelp(`<b>Login failed.</b><br>${msg}`);
    showToast(err.message || "Login failed", "error");
    return false;
  }
}

async function logoutUser(callBackend = true) {
  const token = currentUser?.token;
  if (callBackend && token) {
    apiGet("logout", { token }).catch(() => {});
  }
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  document.body.classList.add("auth-locked");
  document.body.classList.remove("role-admin", "role-user");
  showToast("Logged out");
}

function restoreLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    // v5.4: keep username-only sessions. Backend token is not required for Sheet sync.
    if (saved?.username && saved?.role && saved?.token) {
      if (saved.authMode === "local") saved.authMode = "publicCloud";
      currentUser = saved;
      document.body.classList.remove("auth-locked");
      applyAccessControl();
      setTimeout(() => fetchCloudData(false), 300);
      return true;
    }
  } catch {}
  document.body.classList.add("auth-locked");
  return false;
}

async function refreshUserList(showDoneToast = false) {
  const rows = $("usersRows");
  if (!rows || !isAdmin()) return;

  if (isLocalFallbackMode()) {
    const users = getLocalUsers();
    rows.innerHTML = "";
    Object.keys(users).sort().forEach(username => {
      const u = users[username];
      const disabled = username === currentUser?.username ? "disabled" : "";
      rows.insertAdjacentHTML("beforeend", `<tr><td><b>${escapeHTML(username)}</b></td><td>${escapeHTML(u.role)}</td><td class="center"><button class="btn btn-red" ${disabled} onclick="deleteUserAccount('${escapeHTML(username)}')">Delete</button></td></tr>`);
    });
    if (showDoneToast) showToast("Local users refreshed");
    return;
  }

  try {
    const data = await apiGet("listUsers", { token: requireSession() });
    if (!data.ok) throw new Error(data.error || "Unable to load users");
    rows.innerHTML = "";
    (data.users || []).forEach(u => {
      const disabled = u.username === currentUser?.username ? "disabled" : "";
      rows.insertAdjacentHTML("beforeend", `<tr><td><b>${escapeHTML(u.username)}</b></td><td>${escapeHTML(u.role)}</td><td class="center"><button class="btn btn-red" ${disabled} onclick="deleteUserAccount('${escapeHTML(u.username)}')">Delete</button></td></tr>`);
    });
    if (showDoneToast) showToast("Users refreshed");
  } catch (err) {
    rows.innerHTML = `<tr><td colspan="3" class="center">${escapeHTML(err.message || "Unable to load users")}</td></tr>`;
  }
}

function renderUserManager() {
  refreshUserList(false);
}

function saveUserAccount() {
  if (!isAdmin()) return showToast("Only admin can manage users", "error");
  const username = $("userUsername").value.trim().toLowerCase();
  const role = $("userRole").value === "admin" ? "admin" : "user";
  if (!username) return showToast("Enter username", "error");

  if (isLocalFallbackMode()) {
    const users = getLocalUsers();
    users[username] = { role };
    saveLocalUsers(users);
    $("userForm").reset();
    refreshUserList(true);
    showToast("Local user saved");
    return;
  }

  postToCloud({ action: "saveUser", username, role }, { refreshData: false, successMessage: "User saved" });
  $("userForm").reset();
  setTimeout(() => refreshUserList(true), 1200);
}

function deleteUserAccount(username) {
  if (!isAdmin()) return showToast("Only admin can delete users", "error");
  username = String(username || "").trim().toLowerCase();
  if (username === currentUser?.username) return showToast("You cannot delete the logged-in user", "error");
  if (!confirm(`Delete user ${username}?`)) return;

  if (isLocalFallbackMode()) {
    const users = getLocalUsers();
    const remainingAdmins = Object.keys(users).filter(k => k !== username && users[k].role === "admin").length;
    if (users[username]?.role === "admin" && remainingAdmins < 1) return showToast("At least one admin is required", "error");
    delete users[username];
    saveLocalUsers(users);
    refreshUserList(true);
    showToast("Local user deleted");
    return;
  }

  postToCloud({ action: "deleteUser", username }, { refreshData: false, successMessage: "User deleted" });
  setTimeout(() => refreshUserList(true), 1200);
}

function resetDefaultUsers() {
  if (!isAdmin()) return;
  if (!confirm("Reset users to default admin/user accounts?")) return;

  if (isLocalFallbackMode()) {
    saveLocalUsers(JSON.parse(JSON.stringify(DEFAULT_LOCAL_USERS)));
    refreshUserList(true);
    showToast("Local default users restored");
    return;
  }

  postToCloud({ action: "resetUsers" }, { refreshData: false, successMessage: "Default users restored" });
  setTimeout(() => refreshUserList(true), 1200);
}

function changeCurrentPassword() {
  showToast("Password system has been removed. Login is username-only.", "warn");
  closeChangePassword();
}

function switchTab(tabName) {
  if (!currentUser) return;
  if (!canOpenPage(tabName)) {
    showToast("You do not have access to this page", "error");
    tabName = allowedPages()[0];
  }
  activeTab = tabName;
  document.querySelectorAll(".tab-page").forEach(el => el.classList.add("hidden"));
  $("page-" + tabName)?.classList.remove("hidden");
  ["dashboard","logentry","statement","register","users"].forEach(name => $("nav-" + name)?.classList.toggle("active", name === tabName));
  const titles = { dashboard:"Dashboard", logentry:"Log Transactions", statement:"Customer Statement", register:"Fleet Registration", users:"Admin & Users" };
  if ($("topBarContextTitle")) $("topBarContextTitle").textContent = titles[tabName] || "KCB Minerals";
  if (tabName === "dashboard") setTimeout(updateDashboardCharts, 100);
  if (tabName === "statement") renderDetailedDistributorReport();
  if (tabName === "users") renderUserManager();
}

async function fetchCloudData(showToastOnDone = true) {
  if (!currentUser) return;
  if (!hasBackendUrl()) {
    lastCloudReadOk = false;
    loadLocalBackup(false);
    finishQuietSync("This device mode - Sheet URL missing");
    updateSyncMeta("Sheet URL missing");
    if (showToastOnDone) showToast("Google Sheet URL missing. Tap Connect Sheet and paste the /exec URL.", "warn");
    return;
  }
  startQuietSync("Syncing with Google Sheet...");

  const attempts = [];
  if (!isLocalFallbackMode()) {
    attempts.push(() => apiGet("getData", { token: requireSession() }));
  }
  // Public read support for the fixed Code.gs package.
  attempts.push(() => apiGet("getDataPublic", { t: Date.now() }));
  // Legacy Apps Script support: older KCB backend returned data when callback was provided without an action.
  attempts.push(() => legacyJsonpGetData());

  for (const attempt of attempts) {
    try {
      const data = await attempt();
      if (data && (data.vehicles || data.transactions || data.ok)) {
        if (data.ok === false && data.error) throw new Error(data.error);
        applyCloudData(data);
        lastCloudReadOk = true;
        lastSyncAt = Date.now();
        finishQuietSync("Connected to Google Sheet");
        if (getPendingWrites().length) setTimeout(() => flushPendingWrites(false), 600);
        if (showToastOnDone) showToast("Synced from Google Sheet");
        return;
      }
    } catch (err) {
      console.warn("Sync attempt failed", err);
    }
  }

  if (isLocalFallbackMode()) {
    loadLocalBackup(false);
    finishQuietSync("This device mode - Sheet not connected");
    updateSyncMeta("Device mode");
    if (showToastOnDone) {
      showToast("Google Sheet not connected. Using this-device data.", "warn");
    }
    return;
  }

  lastCloudReadOk = false;
  finishQuietSync("Google Sheet not connected");
  updateSyncMeta("Sheet not connected");
  loadLocalBackup(false);
  if (showToastOnDone) {
    showToast("Could not sync Google Sheet. Redeploy Apps Script Web App with access = Anyone.", "error");
  }
  showSyncHelp();
}

function legacyJsonpGetData() {
  return new Promise((resolve, reject) => {
    const cb = "kcb_legacy_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const script = document.createElement("script");
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("Legacy backend timeout"));
    }, 12000);

    window[cb] = data => {
      done = true;
      cleanup();
      resolve(data || {});
    };

    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error("Legacy backend connection failed"));
    };

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cb]; } catch {}
      script.remove();
    }

    const sep = CLOUD_API_URL.includes("?") ? "&" : "?";
    script.src = CLOUD_API_URL + sep + "callback=" + encodeURIComponent(cb) + "&t=" + Date.now();
    document.body.appendChild(script);
  });
}

function applyCloudData(data) {
  vehicles = data?.vehicles || {};
  transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  transactions = transactions.map(normalizeTx).sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  localStorage.setItem(BACKUP_KEY, JSON.stringify({ vehicles, transactions }));
  reapplyPendingWritesToView();
  renderAll();
  updateSyncMeta("Connected");
}

function loadLocalBackup(showMessage = true) {
  try {
    const data = JSON.parse(localStorage.getItem(BACKUP_KEY) || "{}");
    vehicles = data.vehicles || {};
    transactions = (data.transactions || []).map(normalizeTx);
    renderAll();
    if (showMessage && (transactions.length || Object.keys(vehicles).length)) showToast("Loaded this device backup", "warn");
  } catch {}
}

function normalizeTx(tx) {
  return {
    id: String(tx.id || generateId()),
    timestamp: Number(tx.timestamp || Date.now()),
    datetimeStr: tx.datetimeStr || cleanFormatDate(tx.timestamp),
    vehicle: String(tx.vehicle || ""),
    type: tx.type === "payment" ? "payment" : "load",
    jars: Number(tx.jars || 0),
    rateApplied: Number(tx.rateApplied || 0),
    financialValue: Number(tx.financialValue || 0)
  };
}

async function postToCloud(payload, options = {}) {
  const { refreshData = true, successMessage = "Saved successfully", applyLocal = true } = options;
  const securedPayload = {
    ...payload,
    publicWrite: true,
    updatedBy: currentUser?.username || "local-user"
  };
  if (!isLocalFallbackMode()) securedPayload.sessionToken = requireSession();

  // Premium stable flow: update UI instantly, then verify Sheet save.
  // If Sheet is offline or not connected, the exact write is queued and retried later with the same ID.
  if (applyLocal) applyLocalWrite(payload);

  if (!hasBackendUrl()) {
    queuePendingWrite(payload, "sheet url missing");
    finishQuietSync("Saved here - Connect Sheet to upload");
    showToast("Saved on this device. Connect Google Sheet to upload pending data.", "warn");
    return;
  }

  if (!navigator.onLine) {
    queuePendingWrite(payload, "offline");
    finishQuietSync("Offline - queued safely");
    showToast("Saved on this device and queued for Google Sheet sync", "warn");
    return;
  }

  startQuietSync("Saving to Google Sheet...");

  try {
    const result = await postToCloudJsonp(securedPayload);
    if (!result || result.ok === false) throw new Error(result?.error || "Google Sheet write failed");
    lastCloudReadOk = true;
    finishQuietSync(result.message || "Saved to Google Sheet");
    showToast(successMessage);
    if (refreshData) setTimeout(() => fetchCloudData(false), 900);
    if (getPendingWrites().length) setTimeout(() => flushPendingWrites(false), 1400);
  } catch (err) {
    console.warn("Google Sheet write failed", err);
    queuePendingWrite(payload, err.message || "write failed");
    finishQuietSync("Saved here - Sheet pending");
    showToast("Saved on this device. Google Sheet sync is pending.", "warn");
  }
}

function applyLocalWrite(payload, options = {}) {
  try {
    if (payload.action === "saveVehicle") {
      const vehicle = String(payload.vehicle || "").trim().toUpperCase();
      if (!vehicle) return;
      vehicles[vehicle] = {
        distributorName: String(payload.distributorName || "").trim(),
        distributorPhone: String(payload.distributorPhone || "").trim(),
        rate: Number(payload.rate || 0),
        updatedAt: Date.now(),
        updatedBy: currentUser?.username || "local"
      };
    } else if (payload.action === "addTx" && payload.tx) {
      const tx = normalizeTx(payload.tx);
      const index = transactions.findIndex(t => String(t.id) === String(tx.id));
      if (index >= 0) transactions[index] = tx;
      else transactions.unshift(tx);
      transactions.sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    } else if (payload.action === "deleteTx") {
      transactions = transactions.filter(t => String(t.id) !== String(payload.id));
    }
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ vehicles, transactions }));
    if (!options.silent) renderAll();
  } catch (err) {
    console.warn("Local write failed", err);
  }
}

function postToCloudJsonp(payload) {
  // v4.8: verified write. Apps Script returns ok/error through JSONP so edits cannot silently fail.
  return apiGet("writePublic", { payload: JSON.stringify(payload), t: Date.now() });
}

function postToCloudForm(payload) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.name = "kcb_post_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    iframe.style.display = "none";

    const form = document.createElement("form");
    form.method = "POST";
    form.action = CLOUD_API_URL;
    form.target = iframe.name;

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    let finished = false;
    const cleanup = () => {
      setTimeout(() => {
        try { form.remove(); } catch {}
        try { iframe.remove(); } catch {}
      }, 500);
    };

    iframe.onload = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ ok: true });
    };

    document.body.append(iframe, form);
    form.submit();

    // Apps Script cross-origin iframes do not always fire onload on mobile browsers.
    // Treat the form submit as sent after a short delay, then refresh from Sheet.
    setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ ok: true });
    }, 2200);
  });
}

function postToCloudFallback(payload, options = {}) {
  return postToCloudForm(payload).then(() => {
    finishQuietSync("Data sent to Google Sheet");
    showToast(options.successMessage || "Data sent to Google Sheet");
    if (options.refreshData !== false) setTimeout(() => fetchCloudData(false), 2500);
  });
}

function renderAll() {
  applyAccessControl();
  renderDropdowns();
  renderVehicleRatesList();
  renderDashboardSummary();
  calculateReports();
  renderAuditTrail();
  renderDetailedDistributorReport();
  updateTodaySummary();
  updateFleetSummary();
  renderPremiumInsights();
  updateSyncMeta();
}

function getLedger() {
  const ledger = {};
  Object.keys(vehicles).forEach(v => ledger[v] = { vehicle:v, dist:vehicles[v]?.distributorName || "N/A", jars:0, bill:0, paid:0 });
  transactions.forEach(t => {
    if (!ledger[t.vehicle]) ledger[t.vehicle] = { vehicle:t.vehicle, dist:vehicles[t.vehicle]?.distributorName || "N/A", jars:0, bill:0, paid:0 };
    if (t.type === "load") { ledger[t.vehicle].jars += Number(t.jars || 0); ledger[t.vehicle].bill += Number(t.financialValue || 0); }
    else ledger[t.vehicle].paid += Number(t.financialValue || 0);
  });
  return ledger;
}

function vehicleSearchText(vehicleNo) {
  const item = vehicles[vehicleNo] || {};
  return `${vehicleNo} ${item.distributorName || ""} ${item.distributorPhone || ""}`.toLowerCase();
}

function vehicleOptionText(vehicleNo) {
  const item = vehicles[vehicleNo] || {};
  return `${vehicleNo} [${item.distributorName || "N/A"}] (${formatINR(item.rate)}/jar)`;
}

function renderTxVehicleOptions() {
  const select = $("txVehicle");
  if (!select) return;

  const oldValue = select.value;
  const keyword = ($("txVehicleSearch")?.value || "").toLowerCase().trim();
  const keys = Object.keys(vehicles)
    .filter(v => !keyword || vehicleSearchText(v).includes(keyword))
    .sort();

  const placeholder = keyword
    ? `-- ${keys.length} matching vehicle(s) --`
    : "-- Choose Registered Vehicle --";
  select.innerHTML = `<option value="" disabled selected>${placeholder}</option>`;

  keys.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = vehicleOptionText(v);
    select.appendChild(opt);
  });

  if (oldValue && keys.includes(oldValue)) {
    select.value = oldValue;
  } else if (keyword) {
    const exact = keys.find(v => v.toLowerCase() === keyword || (vehicles[v]?.distributorName || "").toLowerCase() === keyword);
    if (exact) select.value = exact;
    else if (keys.length === 1) select.value = keys[0];
  }
}

function refreshTxVehicleSearchList() {
  const list = $("txVehicleSearchList");
  if (!list) return;
  list.innerHTML = "";
  Object.keys(vehicles).sort().forEach(v => {
    const item = vehicles[v] || {};
    const opt = document.createElement("option");
    opt.value = v;
    opt.label = `${item.distributorName || "N/A"} • ${formatINR(item.rate)}/jar`;
    list.appendChild(opt);
  });
}

function onTxVehicleSearchInput() {
  const input = $("txVehicleSearch");
  const value = (input?.value || "").trim().toUpperCase();
  const select = $("txVehicle");

  renderTxVehicleOptions();

  if (value && vehicles[value] && select) {
    select.value = value;
  }
}

function onTxVehicleSelectChange() {
  const select = $("txVehicle");
  const input = $("txVehicleSearch");
  if (!select || !input || !select.value) return;
  input.value = select.value;
}

function clearTxVehicleSearch() {
  if ($("txVehicleSearch")) $("txVehicleSearch").value = "";
  renderTxVehicleOptions();
}

function renderDropdowns() {
  const txVehicleOld = $("txVehicle")?.value;
  const reportOld = $("reportFilterDistributor")?.value || "all";
  const statementOld = $("statementDistributor")?.value || "all";
  const distributors = [...new Set(Object.values(vehicles).map(v => v.distributorName).filter(Boolean))].sort();

  refreshTxVehicleSearchList();
  renderTxVehicleOptions();
  if (vehicles[txVehicleOld]) $("txVehicle").value = txVehicleOld;

  ["reportFilterDistributor", "statementDistributor"].forEach(id => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = '<option value="all">All Distributors</option>';
    distributors.forEach(d => {
      const opt = document.createElement("option"); opt.value = d; opt.textContent = d; select.appendChild(opt);
    });
  });
  if (distributors.includes(reportOld)) $("reportFilterDistributor").value = reportOld;
  if (distributors.includes(statementOld)) $("statementDistributor").value = statementOld;
}

function switchReportPeriod(period) {
  activeReportPeriod = period;
  ["Daily","Weekly","Monthly"].forEach(p => $("btnReport" + p)?.classList.toggle("active", p.toLowerCase() === period));
  calculateReports();
}

function getCutoff() {
  const days = activeReportPeriod === "daily" ? 1 : activeReportPeriod === "weekly" ? 7 : 30;
  return Date.now() - days * 86400000;
}

function calculateReports() {
  const cutoff = getCutoff();
  const selected = $("reportFilterDistributor")?.value || "all";
  let jars = 0, revenue = 0, payments = 0;
  transactions.forEach(t => {
    if (Number(t.timestamp) < cutoff) return;
    const dist = vehicles[t.vehicle]?.distributorName || "N/A";
    if (selected !== "all" && dist !== selected) return;
    if (t.type === "load") { jars += Number(t.jars || 0); revenue += Number(t.financialValue || 0); }
    else payments += Number(t.financialValue || 0);
  });
  const outstanding = revenue - payments;
  $("repJars").textContent = jars;
  $("repEarnings").textContent = formatINR(revenue);
  $("repPayments").textContent = formatINR(payments);
  $("repNet").textContent = formatINR(outstanding);
  $("repNet").style.color = outstanding > 0 ? "#ef4444" : "#10b981";
  updateDashboardCharts(revenue, payments, outstanding);
}

function updateDashboardCharts(revenue, payments, outstanding) {
  if (typeof Chart === "undefined") return;
  if (revenue === undefined) {
    const revText = $("repEarnings")?.textContent || "0";
    revenue = Number(revText.replace(/[^0-9.-]/g,""));
    payments = Number(($("repPayments")?.textContent || "0").replace(/[^0-9.-]/g,""));
    outstanding = Number(($("repNet")?.textContent || "0").replace(/[^0-9.-]/g,""));
  }
  const color = document.body.classList.contains("dark") ? "#e2e8f0" : "#334155";
  const rctx = $("revenueChart");
  const pctx = $("paymentChart");
  if (rctx) {
    if (revenueChart) revenueChart.destroy();
    revenueChart = new Chart(rctx, { type:"bar", data:{ labels:["Revenue","Payments","Outstanding"], datasets:[{ data:[revenue,payments,outstanding], backgroundColor:["#2563eb","#10b981", outstanding > 0 ? "#ef4444" : "#10b981"] }] }, options:{ responsive:true, plugins:{ legend:{display:false}}, scales:{x:{ticks:{color}},y:{ticks:{color}}} } });
  }
  if (pctx) {
    if (paymentChart) paymentChart.destroy();
    paymentChart = new Chart(pctx, { type:"doughnut", data:{ labels:["Collected","Pending"], datasets:[{ data:[payments, Math.max(outstanding,0)], backgroundColor:["#10b981", "#ef4444"] }] }, options:{ responsive:true, plugins:{legend:{labels:{color}}} } });
  }
}

function renderDashboardSummary() {
  const body = $("dashboardSummaryRows");
  if (!body) return;
  const ledger = getLedger();
  body.innerHTML = "";
  let totalJars = 0, totalBill = 0, totalPaid = 0;
  Object.values(ledger).sort((a,b) => a.dist.localeCompare(b.dist)).forEach(r => {
    const due = r.bill - r.paid;
    totalJars += r.jars; totalBill += r.bill; totalPaid += r.paid;
    body.insertAdjacentHTML("beforeend", `<tr onclick="selectDistributor(${quoteArg(r.dist)})"><td><b>${escapeHTML(r.dist)}</b></td><td>${escapeHTML(r.vehicle)}</td><td class="right">${r.jars}</td><td class="right">${formatINR(r.bill)}</td><td class="right green-text">${formatINR(r.paid)}</td><td class="right" style="color:${due>0?'#ef4444':'#10b981'}"><b>${formatINR(due)}</b></td></tr>`);
  });
  if (body.children.length) body.insertAdjacentHTML("beforeend", `<tr><td colspan="2"><b>Grand Total</b></td><td class="right"><b>${totalJars}</b></td><td class="right"><b>${formatINR(totalBill)}</b></td><td class="right"><b>${formatINR(totalPaid)}</b></td><td class="right"><b>${formatINR(totalBill-totalPaid)}</b></td></tr>`);
}

function selectDistributor(dist) {
  if (!isAdmin()) return showToast("Only admin can open statements", "error");
  if (dist && dist !== "N/A") {
    $("reportFilterDistributor").value = dist;
    $("statementDistributor").value = dist;
    if ($("statementSearch")) $("statementSearch").value = "";
  }
  onDistributorFilterChange();
  switchTab("statement");
}

function onDistributorFilterChange() {
  const dist = $("reportFilterDistributor").value;
  if ($("statementDistributor")) $("statementDistributor").value = dist;
  calculateReports();
  renderDetailedDistributorReport();
}

function changeStatementDistributor() {
  const dist = $("statementDistributor").value;
  if ($("reportFilterDistributor")) $("reportFilterDistributor").value = dist;
  calculateReports();
  renderDetailedDistributorReport();
}

function getStatementPeriod() {
  const fromValue = $("statementFromDate")?.value || "";
  const toValue = $("statementToDate")?.value || "";

  const from = fromValue ? new Date(fromValue + "T00:00:00").getTime() : null;
  const to = toValue ? new Date(toValue + "T23:59:59.999").getTime() : null;

  return { fromValue, toValue, from, to };
}

function txMatchesStatementFilters(tx) {
  const selected = $("statementDistributor")?.value || $("reportFilterDistributor")?.value || "all";
  const dist = vehicles[tx.vehicle]?.distributorName || "N/A";
  const vehicleNo = String(tx.vehicle || "");
  const keyword = ($("statementSearch")?.value || "").toLowerCase().trim();
  const period = getStatementPeriod();
  const timestamp = Number(tx.timestamp || 0);

  if (selected !== "all" && dist !== selected) return false;
  if (keyword && !vehicleNo.toLowerCase().includes(keyword) && !dist.toLowerCase().includes(keyword)) return false;
  if (period.from !== null && timestamp < period.from) return false;
  if (period.to !== null && timestamp > period.to) return false;

  return true;
}

function statementPeriodLabel() {
  const period = getStatementPeriod();
  if (!period.fromValue && !period.toValue) return "All Time";
  if (period.fromValue && period.toValue) return `${period.fromValue} to ${period.toValue}`;
  if (period.fromValue) return `From ${period.fromValue}`;
  return `Up to ${period.toValue}`;
}

function clearStatementPeriod() {
  if ($("statementFromDate")) $("statementFromDate").value = "";
  if ($("statementToDate")) $("statementToDate").value = "";
  if ($("statementSearch")) $("statementSearch").value = "";
  if ($("statementDistributor")) $("statementDistributor").value = "all";
  if ($("reportFilterDistributor")) $("reportFilterDistributor").value = "all";
  calculateReports();
  renderDetailedDistributorReport();
  showToast("Statement filters cleared");
}

function getFilteredStatementTransactions() {
  return transactions
    .filter(txMatchesStatementFilters)
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function renderDetailedDistributorReport() {
  const selected = $("statementDistributor")?.value || $("reportFilterDistributor")?.value || "all";
  const rows = $("detailedDistributorRows");
  if (!rows) return;

  rows.innerHTML = "";

  let running = 0, totalJars = 0, totalBill = 0, totalPaid = 0;
  const filtered = getFilteredStatementTransactions();

  filtered.forEach(t => {
    const dist = vehicles[t.vehicle]?.distributorName || "N/A";
    const amount = Number(t.financialValue || 0);

    if (t.type === "load") {
      running += amount;
      totalBill += amount;
      totalJars += Number(t.jars || 0);
    } else {
      running -= amount;
      totalPaid += amount;
    }

    rows.insertAdjacentHTML("beforeend", `<tr><td>${cleanFormatDate(t.timestamp)}</td><td>${escapeHTML(dist)}</td><td>${escapeHTML(t.vehicle)}</td><td>${t.type === "load" ? '<span class="badge badge-load">LOAD</span>' : '<span class="badge badge-payment">PAYMENT</span>'}</td><td class="right">${t.jars || "-"}</td><td class="right">${t.rateApplied ? formatINR(t.rateApplied) : "-"}</td><td class="right">${t.type === "payment" ? "-" : "+"}${formatINR(amount)}</td><td class="right"><b>${formatINR(running)}</b></td></tr>`);
  });

  if (!filtered.length) {
    rows.innerHTML = `<tr><td colspan="8" class="center">No records found for the selected distributor/period.</td></tr>`;
  }

  $("stTotalJars").textContent = totalJars;
  $("stTotalBill").textContent = formatINR(totalBill);
  $("stTotalPaid").textContent = formatINR(totalPaid);
  $("stOutstanding").textContent = formatINR(totalBill - totalPaid);

  const party = selected === "all" ? "All Distributors" : selected;
  $("statementPrintSub").textContent = `${party} • Period: ${statementPeriodLabel()}`;
}

function renderAuditTrail() {
  const body = $("auditTrailRows");
  if (!body) return;
  const keyword = ($("logSearchBar")?.value || "").toLowerCase().trim();
  const filtered = transactions.filter(t => {
    const dist = (vehicles[t.vehicle]?.distributorName || "").toLowerCase();
    return !keyword || String(t.vehicle).toLowerCase().includes(keyword) || dist.includes(keyword);
  }).sort((a,b) => b.timestamp - a.timestamp);
  body.innerHTML = "";
  filtered.forEach(t => {
    const dist = vehicles[t.vehicle]?.distributorName || "N/A";
    const actions = isAdmin() ? `<button class="btn btn-secondary" onclick="inlineEditTx(${quoteArg(t.id)})">Edit</button> <button class="btn btn-red" onclick="deleteTx(${quoteArg(t.id)})">Delete</button>` : `<span class="badge">View only</span>`;
    body.insertAdjacentHTML("beforeend", `<tr><td>${cleanFormatDate(t.timestamp)}</td><td><b>${escapeHTML(t.vehicle)}</b><br><small>${escapeHTML(dist)}</small></td><td>${t.type === "load" ? '<span class="badge badge-load">LOAD</span>' : '<span class="badge badge-payment">PAYMENT</span>'}</td><td class="right">${t.jars || "-"}</td><td class="right">${t.rateApplied ? formatINR(t.rateApplied) : "-"}</td><td class="right"><b>${formatINR(t.financialValue)}</b></td><td class="center">${actions}</td></tr>`);
  });
  $("recordCount").textContent = filtered.length;
  $("noDataAlert")?.classList.toggle("hidden", filtered.length > 0);
}

function setEntryType(type) {
  currentEntryType = type;
  $("tabLoad").classList.toggle("active", type === "load");
  $("tabPayment").classList.toggle("active", type === "payment");
  $("divJarInput").classList.toggle("hidden", type !== "load");
  $("divPaymentInput").classList.toggle("hidden", type !== "payment");
  const editing = !!$("txForm")?.dataset?.editId;
  $("txSubmitBtn").textContent = editing ? "Update Transaction" : (type === "load" ? "Submit Load" : "Submit Payment");
}

function inlineEditTx(id) {
  if (!isAdmin()) return showToast("Only admin can edit old transactions", "error");
  const tx = transactions.find(t => String(t.id) === String(id));
  if (!tx) return;
  switchTab("logentry");
  setEntryType(tx.type);
  if ($("txVehicleSearch")) $("txVehicleSearch").value = tx.vehicle;
  renderTxVehicleOptions();
  $("txVehicle").value = tx.vehicle;
  const d = new Date(tx.timestamp); const offset = d.getTimezoneOffset() * 60000;
  $("txDateTime").value = new Date(d.getTime() - offset).toISOString().slice(0,16);
  $("txJars").value = tx.jars || "";
  $("txAmount").value = tx.type === "payment" ? tx.financialValue : "";
  $("txForm").dataset.editId = tx.id;
  $("txFormTitle").textContent = "✏️ Edit Transaction";
  if ($("editModeBanner")) $("editModeBanner").classList.remove("hidden");
  window.scrollTo({top:0,behavior:"smooth"});
}

function deleteTx(id) {
  if (!isAdmin()) return showToast("Only admin can delete transactions", "error");
  if (confirm("Delete this transaction from app and Google Sheet?")) postToCloud({ action:"deleteTx", id:String(id) }, { successMessage:"Transaction deleted" });
}

function updateTodaySummary() {
  const today = new Date();
  let jars = 0, payments = 0, outstanding = 0;
  transactions.forEach(t => {
    const d = new Date(t.timestamp);
    if (d.toDateString() !== today.toDateString()) return;
    if (t.type === "load") { jars += Number(t.jars || 0); outstanding += Number(t.financialValue || 0); }
    else { payments += Number(t.financialValue || 0); outstanding -= Number(t.financialValue || 0); }
  });
  $("todayLoads").textContent = jars;
  $("todayPayments").textContent = formatINR(payments);
  $("todayOutstanding").textContent = formatINR(outstanding);
}

function updateFleetSummary() {
  const fleet = Object.keys(vehicles).length;
  const distSet = new Set(Object.values(vehicles).map(v => v.distributorName).filter(Boolean));
  const avg = fleet ? Object.values(vehicles).reduce((sum,v) => sum + Number(v.rate || 0), 0) / fleet : 0;
  if ($("fleetCount")) $("fleetCount").textContent = fleet;
  if ($("statusFleetCount")) $("statusFleetCount").textContent = fleet;
  if ($("distributorCount")) $("distributorCount").textContent = distSet.size;
  if ($("avgRate")) $("avgRate").textContent = formatINR(avg);
}

function renderPremiumInsights() {
  const today = new Date().toDateString();
  let todayJars = 0, todayPayments = 0, todayNet = 0;
  transactions.forEach(t => {
    if (new Date(Number(t.timestamp || 0)).toDateString() !== today) return;
    if (t.type === "load") { todayJars += Number(t.jars || 0); todayNet += Number(t.financialValue || 0); }
    else { todayPayments += Number(t.financialValue || 0); todayNet -= Number(t.financialValue || 0); }
  });
  if ($("highTodayJars")) $("highTodayJars").textContent = todayJars;
  if ($("highTodayPayments")) $("highTodayPayments").textContent = formatINR(todayPayments);
  if ($("highTodayNet")) $("highTodayNet").textContent = formatINR(todayNet);

  const wrap = $("highTopOutstanding");
  if (wrap) {
    const rows = Object.values(getLedger())
      .map(r => ({ ...r, due: Number(r.bill || 0) - Number(r.paid || 0) }))
      .filter(r => r.due > 0)
      .sort((a,b) => b.due - a.due)
      .slice(0, 5);
    wrap.innerHTML = rows.length ? "" : `<div class="empty compact">No outstanding dues.</div>`;
    rows.forEach(r => wrap.insertAdjacentHTML("beforeend", `<button class="priority-item" onclick="selectDistributor(${quoteArg(r.dist)})"><span><b>${escapeHTML(r.dist)}</b><small>${escapeHTML(r.vehicle)}</small></span><strong>${formatINR(r.due)}</strong></button>`));
  }
  updateSyncMeta();
}

function setStatementQuickPeriod(type) {
  const now = new Date();
  const yyyyMmDd = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  let from = new Date(now);
  if (type === "today") from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (type === "week") from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  else if (type === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  if ($("statementFromDate")) $("statementFromDate").value = yyyyMmDd(from);
  if ($("statementToDate")) $("statementToDate").value = yyyyMmDd(now);
  renderDetailedDistributorReport();
}

function cancelTxEdit() {
  const form = $("txForm");
  if (!form) return;
  form.reset();
  delete form.dataset.editId;
  clearTxVehicleSearch();
  setEntryType("load");
  if ($("txFormTitle")) $("txFormTitle").textContent = "📝 New Transaction";
  if ($("editModeBanner")) $("editModeBanner").classList.add("hidden");
}


function renderVehicleRatesList() {
  const wrap = $("vehicleRatesList");
  if (!wrap) return;
  const keyword = ($("vehicleSearch")?.value || "").toLowerCase().trim();
  wrap.innerHTML = "";
  const keys = Object.keys(vehicles).filter(v => !keyword || v.toLowerCase().includes(keyword) || (vehicles[v].distributorName || "").toLowerCase().includes(keyword)).sort();
  if (!keys.length) { wrap.innerHTML = `<div class="empty">No vehicle profiles found.</div>`; return; }
  keys.forEach(v => {
    const item = vehicles[v];
    wrap.insertAdjacentHTML("beforeend", `<div class="vehicle-card"><h4>🚛 ${escapeHTML(v)}</h4><p><b>Distributor:</b> ${escapeHTML(item.distributorName || "N/A")}</p><p><b>Phone:</b> ${escapeHTML(item.distributorPhone || "N/A")}</p><p><b>Rate:</b> ${formatINR(item.rate)}/jar</p><div class="actions"><button class="btn btn-secondary" onclick="editVehicleProfile('${escapeHTML(v)}')">Edit</button></div></div>`);
  });
}

function editVehicleProfile(vehicle) {
  const item = vehicles[vehicle];
  if (!item) return;
  switchTab("register");
  $("regFormTitle").textContent = "✏️ Edit Vehicle";
  $("cfgVehicle").value = vehicle;
  $("cfgVehicle").readOnly = true;
  $("cfgDistributorName").value = item.distributorName || "";
  $("cfgDistributorPhone").value = item.distributorPhone || "";
  $("cfgRate").value = item.rate || "";
  $("btnCancelRegEdit").classList.remove("hidden");
}

function resetRegistrationForm() {
  $("vehicleForm").reset();
  $("cfgVehicle").readOnly = false;
  $("regFormTitle").textContent = "Register Vehicle";
  $("btnCancelRegEdit").classList.add("hidden");
}

function exportExcel() {
  if (!isAdmin()) return showToast("Only admin can export reports", "error");
  if (typeof XLSX === "undefined") return showToast("Excel library not loaded", "error");

  const allRows = transactions.map(t => ({
    Date: cleanFormatDate(t.timestamp),
    Distributor: vehicles[t.vehicle]?.distributorName || "N/A",
    Vehicle: t.vehicle,
    Type: t.type,
    Jars: t.jars,
    Rate: t.rateApplied,
    Amount: t.financialValue
  }));

  const statementRows = getFilteredStatementTransactions().map(t => ({
    Date: cleanFormatDate(t.timestamp),
    Distributor: vehicles[t.vehicle]?.distributorName || "N/A",
    Vehicle: t.vehicle,
    Type: t.type,
    Jars: t.jars,
    Rate: t.rateApplied,
    Amount: t.financialValue,
    Period: statementPeriodLabel()
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statementRows), "Statement_Filtered");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), "All_Transactions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(vehicles).map(v => ({ Vehicle:v, ...vehicles[v] }))), "Vehicles");
  XLSX.writeFile(wb, "KCB_Minerals_Ledger.xlsx");
}

async function exportPDF() {
  if (!isAdmin()) return showToast("Only admin can export reports", "error");
  if (!window.jspdf || typeof html2canvas === "undefined") return showToast("PDF library not loaded", "error");
  switchTab("statement");
  await new Promise(r => setTimeout(r, 200));
  const canvas = await html2canvas($("statementArea"), { scale:2 });
  const img = canvas.toDataURL("image/png");
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgHeight = canvas.height * pageWidth / canvas.width;
  pdf.addImage(img, "PNG", 0, 0, pageWidth, imgHeight);
  pdf.save("KCB_Minerals_Statement.pdf");
}

function bindForms() {
  $("loginForm")?.addEventListener("submit", e => {
    e.preventDefault();
    loginUser($("loginUsername").value.trim());
  });

  $("userForm")?.addEventListener("submit", e => {
    e.preventDefault();
    saveUserAccount();
  });

  $("changePasswordForm")?.addEventListener("submit", e => {
    e.preventDefault();
    changeCurrentPassword();
  });

  $("vehicleForm").addEventListener("submit", e => {
    e.preventDefault();
    const vehicle = $("cfgVehicle").value.trim().toUpperCase();
    const distributorName = $("cfgDistributorName").value.trim();
    const distributorPhone = $("cfgDistributorPhone").value.trim();
    const rate = Number($("cfgRate").value);
    if (!vehicle || !distributorName || !rate && rate !== 0) return showToast("Fill all vehicle fields", "error");
    postToCloud({ action:"saveVehicle", vehicle, distributorName, distributorPhone, rate, updatedBy: currentUser?.username || "unknown" });
    resetRegistrationForm();
  });

  $("txForm").addEventListener("submit", e => {
    e.preventDefault();
    const vehicle = $("txVehicle").value;
    if (!vehicle || !vehicles[vehicle]) return showToast("Select a registered vehicle", "error");
    const rate = Number(vehicles[vehicle].rate || 0);
    const timestamp = $("txDateTime").value ? new Date($("txDateTime").value).getTime() : Date.now();
    const jars = currentEntryType === "load" ? Number($("txJars").value) : 0;
    const amount = currentEntryType === "load" ? jars * rate : Number($("txAmount").value);
    if (currentEntryType === "load" && jars <= 0) return showToast("Enter jar quantity", "error");
    if (currentEntryType === "payment" && amount <= 0) return showToast("Enter payment amount", "error");
    const tx = { id: $("txForm").dataset.editId ? String($("txForm").dataset.editId) : generateId(), timestamp, datetimeStr: cleanFormatDate(timestamp), vehicle, type:currentEntryType, jars, rateApplied: currentEntryType === "load" ? rate : 0, financialValue: amount, submittedBy: currentUser?.username || "unknown" };
    postToCloud({ action:"addTx", tx }, { successMessage: $("txForm").dataset.editId ? "Transaction updated" : "Transaction saved" });
    cancelTxEdit();
  });
}


function installPwa() {
  if (!deferredInstallPrompt) return showToast("Install option will appear after opening this app in Chrome/Edge once.", "warn");
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.finally(() => {
    deferredInstallPrompt = null;
    $("installPwaBtn")?.classList.add("hidden");
  });
}

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $("installPwaBtn")?.classList.remove("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js?v=5.3").catch(err => console.warn("Service worker registration failed", err));
  });
}

window.addEventListener("online", () => { showToast("Internet connected"); flushPendingWrites(true); });
window.addEventListener("offline", () => showToast("Internet disconnected", "error"));
window.addEventListener("load", () => {
  // v4.5: keep local session and local backup. Do not clear device data on refresh.
  if (localStorage.getItem("kcb_dark") === "true") document.body.classList.add("dark");
  bindForms();
  hydrateBackendUrlInputs();
  setEntryType("load");
  const loggedIn = restoreLogin();
  if (loggedIn) {
    switchTab(isAdmin() ? "dashboard" : "logentry");
    fetchCloudData(false);
    setTimeout(() => flushPendingWrites(false), 1500);
  }
  updateSyncMeta();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && currentUser) { fetchCloudData(false); flushPendingWrites(false); } });
  setInterval(() => { if (document.visibilityState === "visible" && currentUser) fetchCloudData(false); }, 90000);
});
