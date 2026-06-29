/* KCB Minerals Ledger Fresh v7.0
   GitHub-safe version: no Tailwind CDN, no service worker cache, fixed Apps Script URL, JSONP sync. */

const CLOUD_URL = "https://script.google.com/macros/s/AKfycbwA5eKoBNAbaKix_-cpHoLrfBxwnZzYfnBreUkZRIRjZV6UjLXUq8HA44R_grfd6-qC/exec";
const STORE_KEY = "kcb_fresh_v7_store";
const PENDING_KEY = "kcb_fresh_v7_pending";

const app = document.getElementById("app");

let state = {
  user: null,
  view: "dashboard",
  tab: "load",
  period: "daily",
  vehicleSearch: "",
  statementSearch: "",
  dateFrom: "",
  dateTo: "",
  selectedDistributor: "all",
  cloud: "checking",
  cloudMessage: "Not synced yet",
  lastSync: "Not synced",
  vehicles: {},
  transactions: [],
  pending: []
};

function money(n){ return "₹" + Number(n || 0).toLocaleString("en-IN", {minimumFractionDigits:2, maximumFractionDigits:2}); }
function num(n){ return Number(n || 0).toLocaleString("en-IN"); }
function esc(v){ return String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c])); }
function nowTs(){ return Date.now(); }
function fmtDateTime(ts){
  const d = new Date(ts || Date.now());
  return d.toLocaleString("en-IN", {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:true});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function byId(id){ return document.getElementById(id); }
function isAdmin(){ return state.user?.role === "admin"; }

// Remove any old service worker from previous versions. This avoids stale cached app.js files.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
}

function loadLocal(){
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.vehicles = saved.vehicles || {};
    state.transactions = Array.isArray(saved.transactions) ? saved.transactions : [];
    state.lastSync = saved.lastSync || "Not synced";
  } catch {}
  try { state.pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") || []; } catch { state.pending = []; }
}
function saveLocal(){
  localStorage.setItem(STORE_KEY, JSON.stringify({vehicles: state.vehicles, transactions: state.transactions, lastSync: state.lastSync}));
  localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending));
}
function setCloud(status, message){
  state.cloud = status;
  state.cloudMessage = message;
  updateStatusOnly();
}
function updateStatusOnly(){
  const box = byId("cloudStatusBox");
  if (!box) return;
  box.innerHTML = statusHtml();
  const sub = byId("topStatusText");
  if (sub) sub.textContent = state.cloud === "ok" ? `Connected • Last sync ${state.lastSync}` : state.cloudMessage;
}

function jsonp(action, payload = {}, timeoutMs = 25000){
  return new Promise((resolve, reject) => {
    if (!CLOUD_URL || !CLOUD_URL.includes("/exec")) {
      reject(new Error("Apps Script /exec URL missing in app.js"));
      return;
    }
    const cb = "kcb_v7_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const params = new URLSearchParams();
    params.set("action", action);
    params.set("callback", cb);
    params.set("t", Date.now().toString());
    if (payload && Object.keys(payload).length) params.set("payload", JSON.stringify(payload));
    const url = CLOUD_URL + "?" + params.toString();
    const script = document.createElement("script");
    let done = false;
    const timer = setTimeout(() => cleanup(new Error("Apps Script request timed out. URL tested: " + url)), timeoutMs);
    function cleanup(err, data){
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch { window[cb] = undefined; }
      script.remove();
      if (err) reject(err); else resolve(data);
    }
    window[cb] = (data) => {
      if (!data || data.ok === false) cleanup(new Error((data && data.error) || "Apps Script returned error"), data);
      else cleanup(null, data);
    };
    script.onerror = () => cleanup(new Error("Apps Script connection failed. Open this URL in incognito and it must show data: " + url));
    script.src = url;
    document.head.appendChild(script);
  });
}

async function loadCloud(){
  setCloud("syncing", "Syncing with Google Sheet...");
  try {
    const data = await jsonp("getDataPublic");
    state.vehicles = data.vehicles || {};
    state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
    state.lastSync = new Date().toLocaleString("en-IN");
    setCloud("ok", "Connected to Google Sheet");
    saveLocal();
    render();
    return true;
  } catch (err) {
    console.error("Cloud load failed", err);
    setCloud("bad", "Sheet connection failed. Check Apps Script deployment.");
    return false;
  }
}

function queueWrite(op, data){
  state.pending.push({op, data, queuedAt: Date.now(), by: state.user?.name || "admin"});
  saveLocal();
  updateStatusOnly();
}
async function flushPending(){
  if (!state.pending.length) { await loadCloud(); return; }
  setCloud("syncing", `Uploading ${state.pending.length} pending item(s)...`);
  let uploaded = 0;
  while (state.pending.length) {
    const item = state.pending[0];
    try {
      await jsonp("writePublic", item);
      state.pending.shift();
      uploaded++;
      saveLocal();
      updateStatusOnly();
    } catch (err) {
      console.error("Pending write still waiting", err);
      setCloud("bad", "Upload failed. Pending data kept safely on this device.");
      alert("Sync failed. Your pending data is still saved on this device.\n\nOpen Console to see the exact Apps Script URL error.");
      return;
    }
  }
  await loadCloud();
  alert(`${uploaded} pending item(s) uploaded to Google Sheet.`);
}
async function saveWrite(op, data){
  applyLocal(op, data);
  queueWrite(op, data);
  render();
  await flushPending();
}

function applyLocal(op, data){
  if (op === "upsertVehicle") {
    const v = normalizeVehicle(data.vehicle);
    if (v.vehicle) state.vehicles[v.vehicle] = v;
  }
  if (op === "upsertTx") {
    const tx = normalizeTx(data.tx);
    const idx = state.transactions.findIndex(x => String(x.id) === String(tx.id));
    if (idx >= 0) state.transactions[idx] = tx; else state.transactions.unshift(tx);
  }
  if (op === "deleteTx") {
    state.transactions = state.transactions.filter(x => String(x.id) !== String(data.id));
  }
  saveLocal();
}
function normalizeVehicle(v){
  const vehicle = String(v.vehicle || v.vehicleNo || "").trim().toUpperCase();
  return {
    vehicle,
    distributorName: String(v.distributorName || "").trim(),
    distributorPhone: String(v.distributorPhone || "").trim(),
    rate: Number(v.rate || 0),
    updatedAt: v.updatedAt || Date.now(),
    updatedBy: v.updatedBy || state.user?.name || "admin"
  };
}
function normalizeTx(tx){
  const type = tx.type === "payment" ? "payment" : "load";
  const vehicle = String(tx.vehicle || "").trim().toUpperCase();
  const rate = Number(tx.rateApplied || state.vehicles[vehicle]?.rate || 0);
  const jars = type === "payment" ? 0 : Number(tx.jars || 0);
  const value = type === "payment" ? Number(tx.financialValue || 0) : Number(tx.financialValue || jars * rate);
  return {
    id: String(tx.id || "tx_" + Date.now() + "_" + Math.random().toString(36).slice(2)),
    timestamp: Number(tx.timestamp || Date.now()),
    datetimeStr: tx.datetimeStr || fmtDateTime(tx.timestamp || Date.now()),
    vehicle,
    type,
    jars,
    rateApplied: rate,
    financialValue: value,
    submittedBy: tx.submittedBy || state.user?.name || "admin",
    updatedAt: Date.now(),
    updatedBy: state.user?.name || "admin"
  };
}

function statusHtml(){
  const cls = state.cloud === "ok" ? "ok" : state.cloud === "bad" ? "bad" : "";
  const title = state.cloud === "ok" ? "Connected to Google Sheet" : state.cloud === "syncing" ? state.cloudMessage : "Device mode / sync pending";
  return `<div><span class="dot ${cls}"></span><span class="status-title">${esc(title)}</span></div><div class="status-sub">${state.pending.length} pending • ${esc(state.lastSync)}</div>`;
}
function render(){
  if (!state.user) return renderLogin();
  app.innerHTML = `<div class="layout">
    <aside class="side">
      <div class="brand"><div class="brand-logo">KCB</div><div><div class="brand-title">KCB Minerals</div><div class="brand-sub">Fresh Ledger v7</div></div></div>
      <div class="status" id="cloudStatusBox">${statusHtml()}</div>
      <nav class="nav">
        ${navButton("dashboard", "📊 Dashboard")}
        ${navButton("entry", "📝 Log Entry")}
        ${navButton("statement", "📋 Statement")}
        ${navButton("vehicles", "🚚 Vehicles")}
        ${navButton("users", "👥 Users")}
      </nav>
      <div class="side-bottom">
        <div class="user-card"><b>${esc(state.user.name)}</b><small>${esc(state.user.role.toUpperCase())}</small></div>
        <button class="btn btn-primary btn-full" onclick="flushPending()">🔄 Sync Sheet</button>
        <button class="btn btn-soft btn-full" onclick="logout()">🚪 Logout</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar"><div><h2>${titleForView()}</h2><p id="topStatusText">${state.cloud === "ok" ? `Connected • Last sync ${state.lastSync}` : state.cloudMessage}</p></div><div class="actions">
        <button class="btn btn-soft" onclick="exportCsv()">📊 Excel</button><button class="btn btn-soft" onclick="window.print()">📄 PDF</button><button class="btn btn-primary" onclick="flushPending()">🔄 Sync</button><button class="btn btn-soft" onclick="logout()">Logout</button>
      </div></header>
      <section class="content">${renderView()}</section>
    </main>
  </div>`;
}
function navButton(view, label){ return `<button class="${state.view === view ? "active" : ""}" onclick="go('${view}')">${label}</button>`; }
function go(view){ state.view = view; render(); }
function titleForView(){ return {dashboard:"Dashboard",entry:"Log Entry",statement:"Statement",vehicles:"Vehicle Registration",users:"Users"}[state.view] || "Dashboard"; }
function renderLogin(){
  app.innerHTML = `<div class="login-page"><div class="login-card"><div class="logo-box"><div>KCB<small>MINERALS</small></div></div><h1>KCB Minerals Ledger</h1><p>Fresh GitHub version • Simple username login</p>
    <form onsubmit="login(event)"><div class="field"><label>Username</label><input id="loginName" autocomplete="username" value="admin" required></div><button class="btn btn-primary btn-full">Continue</button></form>
    <div class="hint"><b>No password required</b><br>Use <b>admin</b> for full access. Staff can use any name for entry access.</div></div></div>`;
}
async function login(e){
  e.preventDefault();
  const name = byId("loginName").value.trim() || "admin";
  state.user = {name, role: name.toLowerCase() === "admin" ? "admin" : "staff"};
  loadLocal();
  render();
  await loadCloud();
  if (state.pending.length) flushPending();
}
function logout(){ state.user = null; renderLogin(); }

function vehiclesArray(){ return Object.values(state.vehicles || {}).sort((a,b) => a.vehicle.localeCompare(b.vehicle)); }
function txArray(){ return [...state.transactions].sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)); }
function vehicleLabel(v){ const x = state.vehicles[v] || {}; return `${v}${x.distributorName ? " - " + x.distributorName : ""}`; }
function distributorFor(vehicle){ return state.vehicles[vehicle]?.distributorName || ""; }
function currentFilteredTx(){
  let list = txArray();
  const q = state.statementSearch.trim().toLowerCase();
  if (q) list = list.filter(tx => `${tx.vehicle} ${distributorFor(tx.vehicle)} ${tx.type} ${tx.submittedBy}`.toLowerCase().includes(q));
  if (state.dateFrom) list = list.filter(tx => new Date(tx.timestamp).toISOString().slice(0,10) >= state.dateFrom);
  if (state.dateTo) list = list.filter(tx => new Date(tx.timestamp).toISOString().slice(0,10) <= state.dateTo);
  if (state.selectedDistributor !== "all") list = list.filter(tx => distributorFor(tx.vehicle) === state.selectedDistributor);
  return list;
}
function periodTx(){
  const today = todayISO();
  const now = new Date();
  let list = currentFilteredTx();
  if (state.period === "daily") return list.filter(tx => new Date(tx.timestamp).toISOString().slice(0,10) === today);
  if (state.period === "weekly") {
    const start = new Date(now); start.setDate(now.getDate() - 6); start.setHours(0,0,0,0);
    return list.filter(tx => Number(tx.timestamp) >= start.getTime());
  }
  if (state.period === "monthly") return list.filter(tx => new Date(tx.timestamp).getMonth() === now.getMonth() && new Date(tx.timestamp).getFullYear() === now.getFullYear());
  return list;
}
function totals(list = currentFilteredTx()){
  const loads = list.filter(x => x.type === "load");
  const payments = list.filter(x => x.type === "payment");
  const jars = loads.reduce((s,x)=>s+Number(x.jars||0),0);
  const revenue = loads.reduce((s,x)=>s+Number(x.financialValue||0),0);
  const paid = payments.reduce((s,x)=>s+Number(x.financialValue||0),0);
  return {jars, revenue, paid, outstanding: revenue - paid};
}
function distributors(){ return [...new Set(vehiclesArray().map(v => v.distributorName).filter(Boolean))].sort(); }

function renderView(){
  if (state.view === "entry") return renderEntry();
  if (state.view === "statement") return renderStatement();
  if (state.view === "vehicles") return renderVehicles();
  if (state.view === "users") return renderUsers();
  return renderDashboard();
}
function renderDashboard(){
  const list = periodTx(); const t = totals(list); const today = totals(txArray().filter(tx => new Date(tx.timestamp).toISOString().slice(0,10) === todayISO()));
  return `<div class="hero"><div><h1>📊 Analytics Dashboard</h1><p>Jars, revenue, payments, outstanding and fleet performance.</p></div><div class="hero-tools"><button class="btn btn-soft" onclick="go('entry')">➕ New Entry</button><button class="btn btn-soft" onclick="go('vehicles')">🚚 Vehicle</button><select onchange="state.selectedDistributor=this.value;render()"><option value="all">All Distributors</option>${distributors().map(d=>`<option ${state.selectedDistributor===d?'selected':''}>${esc(d)}</option>`).join('')}</select><div class="seg"><button class="${state.period==='daily'?'active':''}" onclick="state.period='daily';render()">Daily</button><button class="${state.period==='weekly'?'active':''}" onclick="state.period='weekly';render()">Weekly</button><button class="${state.period==='monthly'?'active':''}" onclick="state.period='monthly';render()">Monthly</button></div></div></div>
  <div class="grid"><div class="card"><div class="kpi-title">Jars Delivered</div><div class="kpi-value kpi-blue">${num(t.jars)}</div><p>Selected period</p></div><div class="card"><div class="kpi-title">Total Revenue</div><div class="kpi-value kpi-green">${money(t.revenue)}</div><p>Billing value</p></div><div class="card"><div class="kpi-title">Payments</div><div class="kpi-value kpi-orange">${money(t.paid)}</div><p>Collected amount</p></div><div class="card"><div class="kpi-title">Outstanding</div><div class="kpi-value ${t.outstanding>=0?'kpi-red':'kpi-green'}">${money(t.outstanding)}</div><p>Revenue - payments</p></div></div>
  <div class="two-col"><div class="card"><h3 class="section-title">⚡ Today Performance</h3><table class="table"><tr><td>Jars</td><td class="money"><b>${num(today.jars)}</b></td></tr><tr><td>Payments</td><td class="money"><b>${money(today.paid)}</b></td></tr><tr><td>Today Net</td><td class="money"><b>${money(today.revenue - today.paid)}</b></td></tr></table></div><div class="card"><h3 class="section-title">☁️ Cloud Health</h3><table class="table"><tr><td>Status</td><td><b>${esc(state.cloudMessage)}</b></td></tr><tr><td>Pending saves</td><td><b>${state.pending.length}</b></td></tr><tr><td>Last sync</td><td><b>${esc(state.lastSync)}</b></td></tr></table></div></div>
  <div class="card" style="margin-top:22px"><h3 class="section-title">🏆 Top Outstanding</h3>${renderOutstandingList()}</div>`;
}
function renderOutstandingList(){
  const rows = vehiclesArray().map(v => {
    const list = txArray().filter(tx => tx.vehicle === v.vehicle);
    return {...v, outstanding: totals(list).outstanding};
  }).filter(x => x.outstanding > 0).sort((a,b)=>b.outstanding-a.outstanding).slice(0,10);
  if (!rows.length) return `<div class="empty">No outstanding amount.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Distributor</th><th>Vehicle</th><th>Outstanding</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.distributorName)}</b></td><td>${esc(r.vehicle)}</td><td class="money"><b>${money(r.outstanding)}</b></td></tr>`).join('')}</tbody></table></div>`;
}

function renderEntry(){
  const filteredVehicles = vehiclesArray().filter(v => `${v.vehicle} ${v.distributorName}`.toLowerCase().includes(state.vehicleSearch.toLowerCase()));
  return `<div class="card"><h3 class="section-title">📝 Log Entry</h3><div class="tabs"><button class="${state.tab==='load'?'active':''}" onclick="state.tab='load';render()">🚚 Load Jars</button><button class="${state.tab==='payment'?'active':''}" onclick="state.tab='payment';render()">💵 Payment</button></div>
    <form onsubmit="submitEntry(event)"><div class="form-grid"><div class="field"><label>Search Vehicle / Distributor</label><input value="${esc(state.vehicleSearch)}" oninput="state.vehicleSearch=this.value;render()" placeholder="KA53 or distributor name"></div><div class="field"><label>Vehicle & Distributor</label><select id="entryVehicle" required><option value="">-- Choose Registered Vehicle --</option>${filteredVehicles.map(v=>`<option value="${esc(v.vehicle)}">${esc(v.vehicle)} - ${esc(v.distributorName)} - ₹${Number(v.rate||0)}</option>`).join('')}</select></div><div class="field"><label>Date & Time</label><input id="entryDate" type="datetime-local"></div>${state.tab==='load'?`<div class="field"><label>Number of Jars</label><input id="entryJars" type="number" min="1" step="1" placeholder="0" required></div>`:`<div class="field"><label>Payment Amount</label><input id="entryAmount" type="number" min="1" step="0.01" placeholder="0" required></div>`}</div><div class="form-actions"><button class="btn btn-primary">Save ${state.tab==='load'?'Load':'Payment'}</button><button type="button" class="btn btn-soft" onclick="go('statement')">View Statement</button></div></form></div>`;
}
async function submitEntry(e){
  e.preventDefault();
  const vehicle = byId("entryVehicle").value;
  if (!vehicle) return alert("Choose vehicle first.");
  const inputDate = byId("entryDate").value;
  const ts = inputDate ? new Date(inputDate).getTime() : Date.now();
  const rate = Number(state.vehicles[vehicle]?.rate || 0);
  let tx;
  if (state.tab === "load") {
    const jars = Number(byId("entryJars").value || 0);
    if (!jars) return alert("Enter number of jars.");
    tx = normalizeTx({timestamp: ts, datetimeStr: fmtDateTime(ts), vehicle, type:"load", jars, rateApplied:rate, financialValue:jars*rate});
  } else {
    const amount = Number(byId("entryAmount").value || 0);
    if (!amount) return alert("Enter payment amount.");
    tx = normalizeTx({timestamp: ts, datetimeStr: fmtDateTime(ts), vehicle, type:"payment", jars:0, rateApplied:0, financialValue:amount});
  }
  await saveWrite("upsertTx", {tx});
  state.view = "statement"; render();
}

function renderVehicles(){
  const rows = vehiclesArray();
  return `<div class="card"><h3 class="section-title">🚚 Vehicle Registration</h3><form onsubmit="submitVehicle(event)"><div class="form-grid"><div class="field"><label>Vehicle Number</label><input id="vehicleNo" required placeholder="KA53AA0000"></div><div class="field"><label>Distributor Name</label><input id="distName" required placeholder="Distributor name"></div><div class="field"><label>Phone</label><input id="distPhone" placeholder="Phone number"></div><div class="field"><label>Rate per Jar</label><input id="distRate" type="number" min="0" step="0.01" required placeholder="0.00"></div></div><div class="form-actions"><button class="btn btn-primary">Save Vehicle</button></div></form></div><div class="card" style="margin-top:22px"><h3 class="section-title">Registered Vehicles</h3>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Vehicle</th><th>Distributor</th><th>Phone</th><th>Rate</th><th>Action</th></tr></thead><tbody>${rows.map(v=>`<tr><td><b>${esc(v.vehicle)}</b></td><td>${esc(v.distributorName)}</td><td>${esc(v.distributorPhone)}</td><td>₹${Number(v.rate||0)}</td><td><button class="mini btn-soft" onclick="editVehicle('${esc(v.vehicle)}')">Edit</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">No vehicles registered.</div>`}</div>`;
}
async function submitVehicle(e){
  e.preventDefault();
  const vehicle = normalizeVehicle({vehicle: byId("vehicleNo").value, distributorName: byId("distName").value, distributorPhone: byId("distPhone").value, rate: byId("distRate").value});
  if (!vehicle.vehicle || !vehicle.distributorName) return alert("Enter vehicle and distributor.");
  await saveWrite("upsertVehicle", {vehicle});
  alert("Vehicle saved.");
}
function editVehicle(vehicleNo){
  const v = state.vehicles[vehicleNo]; if (!v) return;
  state.view = "vehicles"; render();
  setTimeout(()=>{ byId("vehicleNo").value=v.vehicle; byId("distName").value=v.distributorName; byId("distPhone").value=v.distributorPhone; byId("distRate").value=v.rate; }, 0);
}

function renderStatement(){
  const list = currentFilteredTx(); const t = totals(list);
  return `<div class="card"><h3 class="section-title">📋 Statement</h3><div class="search-row"><input placeholder="Search vehicle / distributor / user" value="${esc(state.statementSearch)}" oninput="state.statementSearch=this.value;render()"><input type="date" value="${state.dateFrom}" onchange="state.dateFrom=this.value;render()"><input type="date" value="${state.dateTo}" onchange="state.dateTo=this.value;render()"><button class="btn btn-soft" onclick="state.statementSearch='';state.dateFrom='';state.dateTo='';render()">Clear</button></div><div class="grid"><div class="card"><div class="kpi-title">Jars</div><div class="kpi-value kpi-blue">${num(t.jars)}</div></div><div class="card"><div class="kpi-title">Revenue</div><div class="kpi-value kpi-green">${money(t.revenue)}</div></div><div class="card"><div class="kpi-title">Payments</div><div class="kpi-value kpi-orange">${money(t.paid)}</div></div><div class="card"><div class="kpi-title">Outstanding</div><div class="kpi-value kpi-red">${money(t.outstanding)}</div></div></div></div><div class="card" style="margin-top:22px"><h3 class="section-title">Entries</h3>${renderTxTable(list)}</div>`;
}
function renderTxTable(list){
  if (!list.length) return `<div class="empty">No entries found.</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Vehicle</th><th>Distributor</th><th>Type</th><th>Jars</th><th>Rate</th><th>Amount</th><th>User</th><th>Action</th></tr></thead><tbody>${list.map(tx=>`<tr><td>${esc(tx.datetimeStr || fmtDateTime(tx.timestamp))}</td><td><b>${esc(tx.vehicle)}</b></td><td>${esc(distributorFor(tx.vehicle))}</td><td><span class="badge ${tx.type==='payment'?'pay':'load'}">${esc(tx.type)}</span></td><td>${num(tx.jars)}</td><td>${tx.type==='load'?'₹'+Number(tx.rateApplied||0):'-'}</td><td class="money"><b>${money(tx.financialValue)}</b></td><td>${esc(tx.submittedBy)}</td><td><div class="row-actions"><button class="mini btn-soft" onclick="editTx('${esc(tx.id)}')">Edit</button><button class="mini btn-red" onclick="deleteTx('${esc(tx.id)}')">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
async function deleteTx(id){
  if (!confirm("Delete this entry?")) return;
  await saveWrite("deleteTx", {id});
}
function editTx(id){
  const tx = state.transactions.find(x => String(x.id) === String(id)); if (!tx) return;
  const val = prompt(tx.type === "load" ? "Edit jars" : "Edit payment amount", tx.type === "load" ? tx.jars : tx.financialValue);
  if (val === null) return;
  const updated = {...tx};
  if (tx.type === "load") { updated.jars = Number(val||0); updated.financialValue = Number(updated.jars) * Number(updated.rateApplied||0); }
  else updated.financialValue = Number(val||0);
  saveWrite("upsertTx", {tx: updated});
}

function renderUsers(){
  return `<div class="card"><h3 class="section-title">👥 Users</h3><div class="notice">Fresh version uses simple login. <b>admin</b> gets admin access. Any other username gets staff entry access.</div><div class="table-wrap"><table class="table"><tr><th>Username</th><th>Access</th></tr><tr><td>admin</td><td>Full access</td></tr><tr><td>any staff name</td><td>Entry access</td></tr></table></div></div>`;
}
function exportCsv(){
  const rows = [["Date","Vehicle","Distributor","Type","Jars","Rate","Amount","User"]];
  currentFilteredTx().forEach(tx => rows.push([tx.datetimeStr, tx.vehicle, distributorFor(tx.vehicle), tx.type, tx.jars, tx.rateApplied, tx.financialValue, tx.submittedBy]));
  const csv = rows.map(r => r.map(x => '"' + String(x ?? '').replace(/"/g,'""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "KCB_Ledger_Statement.csv"; a.click(); URL.revokeObjectURL(a.href);
}

loadLocal();
renderLogin();
