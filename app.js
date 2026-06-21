const CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbyAJRWI2XiKLViz30C-VzaEPs2AX7cUJfOv1eiQcEphwiBB2GCX-y4j_4MiZbU2a0fC/exec";

let vehicles = {};
let transactions = [];
let currentEntryType = "load";
let activeReportPeriod = "daily";
let activeTab = "dashboard";
let revenueChart = null;
let paymentChart = null;

const $ = id => document.getElementById(id);

function showToast(message, type = "success") {
  const toast = $("toast");
  toast.textContent = message;
  toast.style.background = type === "error" ? "#dc2626" : type === "warn" ? "#d97706" : "#0f172a";
  toast.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.add("hidden"), 2800);
}

function showLoading(text = "Loading...") {
  $("loadingText").textContent = text;
  $("loadingOverlay").classList.remove("hidden");
  setSync("⌛ " + text, "working");
}

function hideLoading(text = "Ready") {
  $("loadingOverlay").classList.add("hidden");
  setSync("🟢 " + text, "ok");
}

function setSync(text) {
  const el = $("syncIndicator");
  if (el) el.textContent = text;
}

function formatINR(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cleanFormatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:true });
}

function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}

function toggleDarkMode() {
  document.body.classList.toggle("dark");
  localStorage.setItem("kcb_dark", document.body.classList.contains("dark"));
  updateDashboardCharts();
}

function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll(".tab-page").forEach(el => el.classList.add("hidden"));
  $("page-" + tabName)?.classList.remove("hidden");
  ["dashboard","logentry","statement","register"].forEach(name => $("nav-" + name)?.classList.toggle("active", name === tabName));
  const titles = { dashboard:"Dashboard", logentry:"Log Transactions", statement:"Customer Statement", register:"Fleet Registration" };
  $("topBarContextTitle").textContent = titles[tabName] || "KCB Minerals";
  if (tabName === "dashboard") setTimeout(updateDashboardCharts, 100);
  if (tabName === "statement") renderDetailedDistributorReport();
}

async function fetchCloudData() {
  showLoading("Syncing with Google Drive...");
  try {
    const res = await fetch(CLOUD_API_URL, { method: "GET", mode: "cors" });
    if (!res.ok) throw new Error("Network error");
    const data = await res.json();
    applyCloudData(data);
    hideLoading("Connected");
    showToast("Cloud sync completed");
  } catch (err) {
    console.warn(err);
    fetchCloudDataFallback();
  }
}

function fetchCloudDataFallback() {
  const cb = "kcb_jsonp_" + Date.now();
  const script = document.createElement("script");
  window[cb] = data => {
    applyCloudData(data);
    hideLoading("Connected via fallback");
    showToast("Cloud sync completed");
    delete window[cb];
    script.remove();
  };
  script.onerror = () => {
    hideLoading("Offline");
    showToast("Cloud sync failed. Check Apps Script deployment.", "error");
    loadLocalBackup();
  };
  script.src = CLOUD_API_URL + (CLOUD_API_URL.includes("?") ? "&" : "?") + "callback=" + cb;
  document.body.appendChild(script);
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

async function postToCloud(payload) {
  showLoading("Saving to Google Drive...");
  try {
    if (window.location.protocol === "file:") return postToCloudFallback(payload);
    await fetch(CLOUD_API_URL, { method:"POST", mode:"no-cors", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    hideLoading("Saved");
    showToast("Saved successfully");
    setTimeout(fetchCloudData, 1200);
  } catch (err) {
    console.warn(err);
    postToCloudFallback(payload);
  }
}

function postToCloudFallback(payload) {
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
  showToast("Data sent to cloud");
  setTimeout(() => { form.remove(); iframe.remove(); fetchCloudData(); }, 1500);
}

function renderAll() {
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

function renderDetailedDistributorReport() {
  const selected = $("statementDistributor")?.value || $("reportFilterDistributor")?.value || "all";
  const rows = $("detailedDistributorRows");
  if (!rows) return;
  rows.innerHTML = "";
  let running = 0, totalJars = 0, totalBill = 0, totalPaid = 0;
  const filtered = transactions.filter(t => selected === "all" || (vehicles[t.vehicle]?.distributorName || "N/A") === selected).sort((a,b) => a.timestamp - b.timestamp);
  filtered.forEach(t => {
    const dist = vehicles[t.vehicle]?.distributorName || "N/A";
    const amount = Number(t.financialValue || 0);
    if (t.type === "load") { running += amount; totalBill += amount; totalJars += Number(t.jars || 0); }
    else { running -= amount; totalPaid += amount; }
    rows.insertAdjacentHTML("beforeend", `<tr><td>${cleanFormatDate(t.timestamp)}</td><td>${escapeHTML(dist)}</td><td>${escapeHTML(t.vehicle)}</td><td>${t.type === "load" ? '<span class="badge badge-load">LOAD</span>' : '<span class="badge badge-payment">PAYMENT</span>'}</td><td class="right">${t.jars || "-"}</td><td class="right">${t.rateApplied ? formatINR(t.rateApplied) : "-"}</td><td class="right">${t.type === "payment" ? "-" : "+"}${formatINR(amount)}</td><td class="right"><b>${formatINR(running)}</b></td></tr>`);
  });
  if (!filtered.length) rows.innerHTML = `<tr><td colspan="8" class="center">No records found.</td></tr>`;
  $("stTotalJars").textContent = totalJars;
  $("stTotalBill").textContent = formatINR(totalBill);
  $("stTotalPaid").textContent = formatINR(totalPaid);
  $("stOutstanding").textContent = formatINR(totalBill - totalPaid);
  $("statementPrintSub").textContent = selected === "all" ? "All Distributors" : selected;
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
    body.insertAdjacentHTML("beforeend", `<tr><td>${cleanFormatDate(t.timestamp)}</td><td><b>${escapeHTML(t.vehicle)}</b><br><small>${escapeHTML(dist)}</small></td><td>${t.type === "load" ? '<span class="badge badge-load">LOAD</span>' : '<span class="badge badge-payment">PAYMENT</span>'}</td><td class="right">${t.jars || "-"}</td><td class="right">${t.rateApplied ? formatINR(t.rateApplied) : "-"}</td><td class="right"><b>${formatINR(t.financialValue)}</b></td><td class="center"><button class="btn btn-secondary" onclick="inlineEditTx(${t.id})">Edit</button> <button class="btn btn-red" onclick="deleteTx(${t.id})">Delete</button></td></tr>`);
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
  if (typeof XLSX === "undefined") return showToast("Excel library not loaded", "error");
  const rows = transactions.map(t => ({ Date: cleanFormatDate(t.timestamp), Distributor: vehicles[t.vehicle]?.distributorName || "N/A", Vehicle: t.vehicle, Type: t.type, Jars: t.jars, Rate: t.rateApplied, Amount: t.financialValue }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Transactions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(vehicles).map(v => ({ Vehicle:v, ...vehicles[v] }))), "Vehicles");
  XLSX.writeFile(wb, "KCB_Minerals_Ledger.xlsx");
}

async function exportPDF() {
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
  $("vehicleForm").addEventListener("submit", e => {
    e.preventDefault();
    const vehicle = $("cfgVehicle").value.trim().toUpperCase();
    const distributorName = $("cfgDistributorName").value.trim();
    const distributorPhone = $("cfgDistributorPhone").value.trim();
    const rate = Number($("cfgRate").value);
    if (!vehicle || !distributorName || !rate && rate !== 0) return showToast("Fill all vehicle fields", "error");
    postToCloud({ action:"saveVehicle", vehicle, distributorName, distributorPhone, rate });
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
    const tx = { id: $("txForm").dataset.editId ? Number($("txForm").dataset.editId) : Date.now(), timestamp, datetimeStr: cleanFormatDate(timestamp), vehicle, type:currentEntryType, jars, rateApplied: currentEntryType === "load" ? rate : 0, financialValue: amount };
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
  fetchCloudData();
  setInterval(() => { if (document.visibilityState === "visible") fetchCloudData(); }, 60000);
});
