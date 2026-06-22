const CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbyAJRWI2XiKLViz30C-VzaEPs2AX7cUJfOv1eiQcEphwiBB2GCX-y4j_4MiZbU2a0fC/exec";

let vehicles = {};
let transactions = [];
let currentEntryType = "load";
let activeReportPeriod = "daily";
let activeTab = "dashboard";
let revenueChart = null;
let paymentChart = null;
let currentUser = null;

const SESSION_KEY = "kcb_current_user";
const LOCAL_FALLBACK_USERS = {
  admin: { password: "admin123", role: "admin" },
  user: { password: "user123", role: "user" }
};


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
  const overlay = $("loadingOverlay");
  const text = $("loadingText");
  if (text) text.textContent = message;
  if (overlay) overlay.classList.remove("hidden", "light-sync");
}

function hideLoading(message = "") {
  const overlay = $("loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
  if (message && message !== "Ready" && message !== "Saved") showToast(message);
}

function startQuietSync(message = "Syncing...") {
  const indicator = $("syncIndicator");
  if (indicator) {
    indicator.textContent = "⌛ " + message;
    indicator.className = "sync-text syncing";
  }
}

function finishQuietSync(message = "Connected") {
  const indicator = $("syncIndicator");
  if (indicator) {
    indicator.textContent = "🟢 " + message;
    indicator.className = "sync-text connected";
  }
}


function authMode() {
  return currentUser?.authMode || "backend";
}

function isLocalFallbackMode() {
  return authMode() === "local";
}

function backendAuthParams() {
  return isLocalFallbackMode() ? {} : { token: requireSession() };
}

function localFallbackLogin(username, password) {
  const key = String(username || "").trim().toLowerCase();
  const user = LOCAL_FALLBACK_USERS[key];
  if (!user || String(password || "") !== user.password) return false;

  currentUser = {
    username: key,
    role: user.role,
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
  showToast("Logged in using local fallback mode", "warn");
  return true;
}

function apiGet(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "kcb_api_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    const script = document.createElement("script");
    const query = new URLSearchParams({ action, callback: cb, ...params });
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error("Backend did not respond. Re-deploy Apps Script and confirm app.js has the correct /exec URL."));
    }, 15000);

    window[cb] = data => {
      done = true;
      cleanup();
      resolve(data || {});
    };

    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error("Unable to connect to Apps Script backend. Check Web App access is set to Anyone."));
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
  if ($("topUserRole")) $("topUserRole").textContent = isLocalFallbackMode() ? role + " / local" : role;
  if ($("sidebarUserName")) $("sidebarUserName").textContent = name;
  if ($("sidebarUserRole")) $("sidebarUserRole").textContent = isLocalFallbackMode() ? role + " / local" : role;
  if (isAdmin()) refreshUserList(false);
}

async function loginUser(username, password) {
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");

  try {
    showLoginHelp("");
    showLoading("Checking login...");

    // First try the secure Google Apps Script backend login.
    try {
      const health = await checkBackendHealth();
      if (health && health.ok && String(health.authVersion || "").includes("fixed-login")) {
        const data = await apiGet("login", { username, password });
        hideLoading("Ready");

        if (data && data.ok) {
          currentUser = {
            username: data.user.username,
            role: data.user.role,
            token: data.token,
            authMode: "backend"
          };

          localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
          document.body.classList.remove("auth-locked");
          const box = document.getElementById("loginErrorBox");
          if (box) box.innerHTML = "";
          applyAccessControl();
          switchTab(isAdmin() ? "dashboard" : "logentry");
          fetchCloudData(false);
          showToast(`Welcome ${currentUser.username}`);
          return true;
        }

        // Backend replied but credentials failed. Then try only the default local fallback.
        if (localFallbackLogin(username, password)) {
          showLoginHelp(`<b>Backend rejected the password, so local fallback was used.</b><br>To make backend login work, run <code>resetUsersToDefaultManual</code> in Apps Script and deploy a new version.`);
          return true;
        }

        showLoginHelp(`<b>${escapeHTML(data.error || "Invalid username or password")}</b><br><br>Try default accounts:<br>Admin: <code>admin</code> / <code>admin123</code><br>User: <code>user</code> / <code>user123</code>`);
        showToast(data.error || "Invalid username or password", "error");
        return false;
      }
    } catch (backendErr) {
      console.warn("Backend login unavailable, trying local fallback", backendErr);
    }

    hideLoading("Ready");

    // Reliable fallback so the app does not get stuck at login while Apps Script is being fixed.
    if (localFallbackLogin(username, password)) {
      showLoginHelp(`<b>Local fallback login active.</b><br>Your Google Apps Script backend is not responding with the new auth code. The app can still open, but for true backend security paste the latest <code>Code.gs</code> and redeploy a new Web App version.`);
      return true;
    }

    showLoginHelp(`<b>Invalid username or password.</b><br><br>Use:<br>Admin: <code>admin</code> / <code>admin123</code><br>User: <code>user</code> / <code>user123</code>`);
    showToast("Invalid username or password", "error");
    return false;
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
  if ($("loginPassword")) $("loginPassword").value = "";
  showToast("Logged out");
}

function restoreLogin() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.username && saved?.role && saved?.token) {
      currentUser = saved;
      document.body.classList.remove("auth-locked");
      applyAccessControl();
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
    rows.innerHTML = `<tr><td colspan="3" class="center">User management requires backend login. Paste latest Code.gs into Apps Script and redeploy.</td></tr>`;
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
  if (isLocalFallbackMode()) return showToast("User management requires backend login", "error");
  const username = $("userUsername").value.trim();
  const password = $("userPassword").value.trim();
  const role = $("userRole").value;
  if (!username || !password) return showToast("Enter username and password", "error");
  postToCloud({ action: "saveUser", username, password, role }, { refreshData: false, successMessage: "User saved" });
  $("userForm").reset();
  setTimeout(() => refreshUserList(true), 1200);
}

function deleteUserAccount(username) {
  if (!isAdmin()) return showToast("Only admin can delete users", "error");
  if (isLocalFallbackMode()) return showToast("User management requires backend login", "error");
  if (username === currentUser?.username) return showToast("You cannot delete the logged-in user", "error");
  if (!confirm(`Delete user ${username}?`)) return;
  postToCloud({ action: "deleteUser", username }, { refreshData: false, successMessage: "User deleted" });
  setTimeout(() => refreshUserList(true), 1200);
}

function resetDefaultUsers() {
  if (!isAdmin()) return;
  if (isLocalFallbackMode()) return showToast("Reset users requires backend login", "error");
  if (!confirm("Reset backend users to default admin/user accounts?")) return;
  postToCloud({ action: "resetUsers" }, { refreshData: false, successMessage: "Default users restored" });
  setTimeout(() => refreshUserList(true), 1200);
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
  startQuietSync("Syncing with Drive...");
  try {
    const data = await apiGet("getData", backendAuthParams());
    if (!data.ok && data.error) throw new Error(data.error);
    applyCloudData(data);
    finishQuietSync("Connected");
    if (showToastOnDone) showToast("Cloud sync completed");
  } catch (err) {
    console.warn(err);
    finishQuietSync("Sync failed");
    if (String(err.message || "").toLowerCase().includes("session") || String(err.message || "").toLowerCase().includes("unauthorized")) {
      logoutUser(false);
      showToast("Session expired. Please login again.", "error");
      return;
    }
    if (showToastOnDone) showToast("Cloud sync failed. Check Apps Script deployment.", "error");
    loadLocalBackup();
  }
}

function applyCloudData(data) {
  vehicles = data?.vehicles || {};
  transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  transactions = transactions.map(normalizeTx).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  localStorage.setItem("kcb_backup", JSON.stringify({ vehicles, transactions }));
  renderAll();
}

function loadLocalBackup() {
  try {
    const data = JSON.parse(localStorage.getItem("kcb_backup") || "{}");
    vehicles = data.vehicles || {};
    transactions = data.transactions || [];
    renderAll();
    if (transactions.length || Object.keys(vehicles).length) showToast("Loaded local backup", "warn");
  } catch {}
}

function normalizeTx(tx) {
  return {
    id: Number(tx.id || Date.now() + Math.random()),
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
  const { refreshData = true, successMessage = "Saved successfully" } = options;
  const securedPayload = isLocalFallbackMode() ? { ...payload } : { ...payload, sessionToken: requireSession() };
  showLoading("Saving to Google Drive...");
  try {
    if (window.location.protocol === "file:") return postToCloudFallback(securedPayload, options);
    await fetch(CLOUD_API_URL, { method:"POST", mode:"no-cors", headers:{"Content-Type":"application/json"}, body:JSON.stringify(securedPayload) });
    hideLoading("Saved");
    showToast(successMessage);
    if (refreshData) setTimeout(() => fetchCloudData(false), 1200);
  } catch (err) {
    console.warn(err);
    postToCloudFallback(securedPayload, options);
  }
}

function postToCloudFallback(payload, options = {}) {
  const iframe = document.createElement("iframe");
  iframe.name = "kcb_post_" + Date.now();
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
  document.body.append(iframe, form);
  form.submit();
  hideLoading("Saved");
  showToast(options.successMessage || "Data sent to cloud");
  setTimeout(() => { form.remove(); iframe.remove(); if (options.refreshData !== false) fetchCloudData(false); }, 1500);
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

function renderDropdowns() {
  const txVehicleOld = $("txVehicle")?.value;
  const reportOld = $("reportFilterDistributor")?.value || "all";
  const statementOld = $("statementDistributor")?.value || "all";
  const distributors = [...new Set(Object.values(vehicles).map(v => v.distributorName).filter(Boolean))].sort();

  $("txVehicle").innerHTML = '<option value="" disabled selected>-- Choose Registered Vehicle --</option>';
  Object.keys(vehicles).sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = `${v} [${vehicles[v].distributorName || "N/A"}] (${formatINR(vehicles[v].rate)}/jar)`;
    $("txVehicle").appendChild(opt);
  });
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
    body.insertAdjacentHTML("beforeend", `<tr onclick="selectDistributor('${escapeHTML(r.dist)}')"><td><b>${escapeHTML(r.dist)}</b></td><td>${escapeHTML(r.vehicle)}</td><td class="right">${r.jars}</td><td class="right">${formatINR(r.bill)}</td><td class="right green-text">${formatINR(r.paid)}</td><td class="right" style="color:${due>0?'#ef4444':'#10b981'}"><b>${formatINR(due)}</b></td></tr>`);
  });
  if (body.children.length) body.insertAdjacentHTML("beforeend", `<tr><td colspan="2"><b>Grand Total</b></td><td class="right"><b>${totalJars}</b></td><td class="right"><b>${formatINR(totalBill)}</b></td><td class="right"><b>${formatINR(totalPaid)}</b></td><td class="right"><b>${formatINR(totalBill-totalPaid)}</b></td></tr>`);
}

function selectDistributor(dist) {
  if (!isAdmin()) return showToast("Only admin can open statements", "error");
  if (dist && dist !== "N/A") {
    $("reportFilterDistributor").value = dist;
    $("statementDistributor").value = dist;
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
  const period = getStatementPeriod();
  const timestamp = Number(tx.timestamp || 0);

  if (selected !== "all" && dist !== selected) return false;
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
  renderDetailedDistributorReport();
  showToast("Statement period cleared");
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
    const actions = isAdmin() ? `<button class="btn btn-secondary" onclick="inlineEditTx(${t.id})">Edit</button> <button class="btn btn-red" onclick="deleteTx(${t.id})">Delete</button>` : `<span class="badge">View only</span>`;
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
  $("txSubmitBtn").textContent = type === "load" ? "Submit Load" : "Submit Payment";
}

function inlineEditTx(id) {
  if (!isAdmin()) return showToast("Only admin can edit old transactions", "error");
  const tx = transactions.find(t => Number(t.id) === Number(id));
  if (!tx) return;
  switchTab("logentry");
  setEntryType(tx.type);
  $("txVehicle").value = tx.vehicle;
  const d = new Date(tx.timestamp); const offset = d.getTimezoneOffset() * 60000;
  $("txDateTime").value = new Date(d.getTime() - offset).toISOString().slice(0,16);
  $("txJars").value = tx.jars || "";
  $("txAmount").value = tx.type === "payment" ? tx.financialValue : "";
  $("txForm").dataset.editId = tx.id;
  $("txFormTitle").textContent = "✏️ Edit Transaction";
  window.scrollTo({top:0,behavior:"smooth"});
}

function deleteTx(id) {
  if (!isAdmin()) return showToast("Only admin can delete transactions", "error");
  if (confirm("Delete this transaction?")) postToCloud({ action:"deleteTx", id:Number(id) });
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
    loginUser($("loginUsername").value.trim(), $("loginPassword").value);
  });

  $("userForm")?.addEventListener("submit", e => {
    e.preventDefault();
    saveUserAccount();
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
    const tx = { id: $("txForm").dataset.editId ? Number($("txForm").dataset.editId) : Date.now(), timestamp, datetimeStr: cleanFormatDate(timestamp), vehicle, type:currentEntryType, jars, rateApplied: currentEntryType === "load" ? rate : 0, financialValue: amount, submittedBy: currentUser?.username || "unknown" };
    postToCloud({ action:"addTx", tx });
    $("txForm").reset();
    delete $("txForm").dataset.editId;
    $("txFormTitle").textContent = "📝 New Transaction";
    setEntryType("load");
  });
}

window.addEventListener("online", () => showToast("Internet connected"));
window.addEventListener("offline", () => showToast("Internet disconnected", "error"));
window.addEventListener("load", () => {
  if (localStorage.getItem("kcb_dark") === "true") document.body.classList.add("dark");
  bindForms();
  setEntryType("load");
  const loggedIn = restoreLogin();
  if (loggedIn) {
    switchTab(isAdmin() ? "dashboard" : "logentry");
    fetchCloudData(false);
  }
  setInterval(() => { if (document.visibilityState === "visible" && currentUser) fetchCloudData(false); }, 120000);
});
