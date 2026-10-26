"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decimals = (step) => (String(step).split(".")[1] || "").length;
const fmt = (v, step = 1) => Number(v).toFixed(decimals(step));
const pct = (v) => Math.round(v * 100);
const num = (v) => Number(v).toLocaleString();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const OUTCOME = {
  Graduate: "Likely to graduate",
  Enrolled: "Likely to be delayed",
  Dropout: "At risk of dropping out",
};
const OUTCOME_CLASSES = ["c-Dropout", "c-Enrolled", "c-Graduate"];
const RING = 2 * Math.PI * 52;

const state = { meta: null, values: {}, controls: {}, label: null };

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function api(path, body, signal) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const isJson = (res.headers.get("content-type") || "").includes("json");
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) throw Object.assign(new Error("request failed"), { status: res.status, detail: data && data.detail });
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function tweenNumber(node, from, to, format = (v) => Math.round(v)) {
  if (reduceMotion || from === to) { node.textContent = format(to); return; }
  const start = performance.now(), dur = 500;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    node.textContent = format(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- Tooltip (any element with data-tip) ---------------- */

function bindTooltips() {
  const tip = $("#tooltip");
  document.addEventListener("pointerover", (e) => {
    const target = e.target.closest("[data-tip]");
    if (!target || e.pointerType === "touch") return;
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener("pointermove", (e) => {
    if (tip.hidden) return;
    if (!e.target.closest("[data-tip]")) { tip.hidden = true; return; }
    tip.style.left = `${e.clientX}px`;
    tip.style.top = `${e.clientY}px`;
  }, { passive: true });
  document.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest("[data-tip]")) tip.hidden = true;
  });
}

/* ---------------- Form controls ---------------- */

let uid = 0;
const nextId = () => `f${++uid}`;

function slider(f) {
  const id = nextId();
  const node = el(`<div class="field">
      <div class="field-head"><label for="${id}">${esc(f.label)}</label><output for="${id}"></output></div>
      <input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}">
    </div>`);
  const input = $("input", node), out = $("output", node);
  const sync = () => {
    const v = Number(input.value), lo = Number(input.min), hi = Number(input.max);
    out.innerHTML = `${fmt(v, f.step)}${f.suffix ? `<small>${esc(f.suffix)}</small>` : ""}`;
    input.style.setProperty("--pct", `${hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0}%`);
  };
  input.addEventListener("input", () => { sync(); update(f.key, Number(input.value)); });
  return { node, input, sync, set(v) { input.value = v; sync(); } };
}

function toggle(f) {
  const node = el(`<label class="toggle-row"><span>${esc(f.label)}</span><input type="checkbox" role="switch" class="switch"></label>`);
  const input = $("input", node);
  input.addEventListener("change", () => update(f.key, input.checked ? 1 : 0));
  return { node, set(v) { input.checked = Number(v) === 1; } };
}

function select(f) {
  const id = nextId();
  const options = f.options.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
  const node = el(`<div class="field">
      <div class="field-head"><label for="${id}">${esc(f.label)}</label></div>
      <div class="select-wrap"><select id="${id}">${options}</select></div>
    </div>`);
  const input = $("select", node);
  input.addEventListener("change", () => update(f.key, Number(input.value)));
  return { node, set(v) { input.value = v; } };
}

function segmented(f) {
  const id = nextId();
  const buttons = f.options.map((o) => `<button type="button" role="radio" aria-checked="false" data-value="${o.value}">${esc(o.label)}</button>`).join("");
  const node = el(`<div class="field">
      <div class="field-head"><span class="label" id="${id}">${esc(f.label)}</span></div>
      <div class="segmented" role="radiogroup" aria-labelledby="${id}">${buttons}</div>
    </div>`);
  const btns = $$("button", node);
  const set = (v) => btns.forEach((b) => {
    const on = Number(b.dataset.value) === Number(v);
    b.setAttribute("aria-checked", on);
    b.tabIndex = on ? 0 : -1;
  });
  btns.forEach((b, i) => {
    b.addEventListener("click", () => { set(b.dataset.value); update(f.key, Number(b.dataset.value)); });
    b.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const next = btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length];
      next.focus();
      next.click();
    });
  });
  return { node, set };
}

const BUILDERS = { slider, toggle, select, segmented };

function buildForm(fields) {
  for (const f of fields) {
    const control = BUILDERS[f.control](f);
    state.controls[f.key] = control;
    $(`[data-group="${f.group}"]`).appendChild(control.node);
  }
  // "Units passed" can never exceed "Units enrolled".
  for (const f of fields.filter((f) => f.maxFrom)) {
    const parent = state.controls[f.maxFrom].input;
    const child = state.controls[f.key];
    const clamp = () => {
      child.input.max = parent.value;
      if (Number(child.input.value) > Number(parent.value)) {
        child.set(parent.value);
        state.values[f.key] = Number(parent.value);
      }
      child.sync();
    };
    parent.addEventListener("input", clamp);
    child.clamp = clamp;
  }
}

function applyValues(values) {
  state.values = { ...values };
  for (const [key, control] of Object.entries(state.controls)) control.set(values[key]);
  for (const control of Object.values(state.controls)) control.clamp && control.clamp();
}

/* ---------------- Result card (Student view + detail sheet) ---------------- */

function buildBars(root) {
  $(".bars", root).innerHTML = state.meta.classes.map((c) => `
    <li data-cls="${c}" class="c-${c}">
      <div class="row"><span class="name">${c}</span><span class="pct">–</span></div>
      <div class="track"><div class="fill"></div></div>
    </li>`).join("");
}

function paintDrivers(root, drivers) {
  $(".drivers-list", root).innerHTML = drivers.map((d) => {
    const v = Math.round(d.effect * 100);
    return `<li><span>${esc(d.text)}</span><span class="effect ${v > 0 ? "up" : "down"}">${v > 0 ? "+" : "−"}${Math.abs(v)}%</span></li>`;
  }).join("");
  $(".drivers-empty", root).hidden = drivers.length > 0;
}

function paintResult(root, { label, probabilities, drivers }) {
  const p = pct(probabilities[label]);
  root.classList.remove(...OUTCOME_CLASSES);
  root.classList.add(`c-${label}`);
  $(".ring-value", root).style.strokeDashoffset = RING * (1 - probabilities[label]);
  tweenNumber($(".pct-num", root), Number(root.dataset.shown || 0), p);
  root.dataset.shown = p;
  $(".outcome", root).textContent = OUTCOME[label];
  for (const cls of state.meta.classes) {
    const row = $(`[data-cls="${cls}"]`, root);
    $(".pct", row).textContent = `${pct(probabilities[cls])}%`;
    $(".fill", row).style.width = `${probabilities[cls] * 100}%`;
  }
  if (drivers) paintDrivers(root, drivers);
}

/* ---------------- Student prediction ---------------- */

let timer = null, inflight = null;

function update(key, value) {
  state.values[key] = value;
  clearTimeout(timer);
  timer = setTimeout(predict, 120);
}

async function predict() {
  if (inflight) inflight.abort();
  inflight = new AbortController();
  try {
    const result = await api("/api/predict", { values: state.values }, inflight.signal);
    paintResult($("#result"), result);
    const peek = $("#peek");
    peek.classList.remove(...OUTCOME_CLASSES);
    peek.classList.add(`c-${result.label}`);
    $("#peek-text").textContent = `${OUTCOME[result.label]} · ${pct(result.probabilities[result.label])}%`;
    state.label = result.label;
  } catch (err) {
    if (err.name !== "AbortError") toast("Couldn't reach the model. Is the server still running?");
  }
}

function watchResultVisibility() {
  const peek = $("#peek");
  new IntersectionObserver(([entry]) => {
    const studentVisible = !$("#view-student").hidden;
    peek.classList.toggle("show", studentVisible && !entry.isIntersecting && state.label !== null);
  }, { threshold: 0.15 }).observe($("#result"));
}

/* ---------------- Views ---------------- */

function showView(name) {
  for (const tab of $$(".nav button")) {
    const on = tab.dataset.view === name;
    tab.setAttribute("aria-selected", on);
    tab.tabIndex = on ? 0 : -1;
  }
  for (const view of $$(".view")) view.hidden = view.id !== `view-${name}`;
  if (name !== "student") $("#peek").classList.remove("show");
  history.replaceState(null, "", name === "student" ? location.pathname : `#${name}`);
  window.scrollTo({ top: 0 });
}

function bindNav() {
  const tabs = $$(".nav button");
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
    tab.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  });
  const initial = location.hash.slice(1);
  showView(["batch", "model"].includes(initial) ? initial : "student");
}

/* ---------------- Batch ---------------- */

const PAGE = 25;
const B = {
  rows: [], hasTarget: false, tiers: [], file: "",
  f: { tier: null, bin: null, course: null, cell: null, q: "" },
  sort: { key: "risk", dir: -1 }, page: 0, view: [], sheetRow: null,
};
const binOf = (r) => Math.min(9, Math.floor(r.p.Dropout * 10));
const tierOfBin = (i) => (i >= 6 ? "High" : i >= 3 ? "Watch" : "Low");
const filtering = () => B.f.tier || B.f.bin !== null || B.f.course || B.f.cell || B.f.q.trim();

function bindBatch() {
  const zone = $("#dropzone"), input = $("#file");
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    if (e.dataTransfer.files[0]) scoreFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => { if (input.files[0]) scoreFile(input.files[0]); input.value = ""; });

  $("#try-sample").addEventListener("click", async () => {
    setBusy("Loading sample data…");
    try {
      const text = await api("/api/sample");
      await scoreText(text, "Sample · original dataset");
    } catch { setBusy(null); toast("Couldn't load the sample data."); }
  });
  $("#get-template").addEventListener("click", async () => download(await api("/api/template"), "dropout-template.csv"));
  $("#new-file").addEventListener("click", () => {
    $("#batch-result").hidden = true;
    $("#batch-empty").hidden = false;
    $("#dz-status").textContent = "Same columns as the original dataset";
  });
  $("#download-all").addEventListener("click", () => download(toCsv(B.rows), "predictions.csv"));
  $("#download-filtered").addEventListener("click", () => download(toCsv(B.view), "predictions-filtered.csv"));

  const toggleFilter = (key, value, same) => { B.f[key] = same ? null : value; B.page = 0; refresh(); };
  $("#tiers").addEventListener("click", (e) => {
    const t = e.target.closest(".tier");
    if (t) toggleFilter("tier", t.dataset.tier, B.f.tier === t.dataset.tier);
  });
  $("#hist").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) toggleFilter("bin", Number(b.dataset.bin), B.f.bin === Number(b.dataset.bin));
  });
  $("#courses").addEventListener("click", (e) => {
    const c = e.target.closest(".course");
    if (c) toggleFilter("course", c.dataset.course, B.f.course === c.dataset.course);
  });
  $("#confusion").addEventListener("click", (e) => {
    const c = e.target.closest(".cell");
    if (!c) return;
    const cell = { actual: c.dataset.actual, pred: c.dataset.pred };
    const same = B.f.cell && B.f.cell.actual === cell.actual && B.f.cell.pred === cell.pred;
    toggleFilter("cell", cell, same);
  });
  $("#chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-clear]");
    if (!chip) return;
    const key = chip.dataset.clear;
    if (key === "all") { B.f = { tier: null, bin: null, course: null, cell: null, q: "" }; $("#search").value = ""; }
    else if (key === "q") { B.f.q = ""; $("#search").value = ""; }
    else B.f[key] = null;
    B.page = 0;
    refresh();
  });
  let searchTimer = null;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { B.f.q = e.target.value; B.page = 0; refresh(); }, 150);
  });
  $("#thead-row").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    B.sort = B.sort.key === key ? { key, dir: -B.sort.dir } : { key, dir: key === "risk" ? -1 : 1 };
    B.page = 0;
    refresh();
  });
  const openFrom = (tr) => { const row = B.rows[Number(tr.dataset.id) - 1]; if (row) openSheet(row); };
  $("#rows").addEventListener("click", (e) => { const tr = e.target.closest("tr"); if (tr) openFrom(tr); });
  $("#rows").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr");
    if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFrom(tr); }
  });
  $("#prev").addEventListener("click", () => { B.page--; renderList(); });
  $("#next").addEventListener("click", () => { B.page++; renderList(); });

  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#open-student").addEventListener("click", () => {
    const row = B.sheetRow;
    if (!row) return;
    applyValues(row.values);
    closeSheet();
    showView("student");
    predict();
    toast(`Row ${row.id} loaded. Adjust anything to explore what-ifs.`);
  });
}

function setBusy(message) {
  const zone = $("#dropzone");
  zone.classList.toggle("busy", Boolean(message));
  $("#dz-status").textContent = message || "Same columns as the original dataset";
}

async function scoreFile(file) {
  await scoreText(await file.text(), file.name);
}

async function scoreText(text, name) {
  const error = $("#batch-error");
  error.hidden = true;
  setBusy(`Scoring ${name}…`);
  try {
    const data = await api("/api/batch", { csv: text });
    setBusy(null);
    renderBatch(data, name);
  } catch (err) {
    setBusy(null);
    const d = err.detail;
    let msg = typeof d === "string" ? d : (d && d.message) || "Something went wrong scoring that file.";
    if (d && d.missing && d.missing.length) {
      const shown = d.missing.slice(0, 3).map((m) => `“${m}”`).join(", ");
      msg += `: ${shown}${d.missing.length > 3 ? ` and ${d.missing.length - 3} more` : ""}.`;
    }
    error.textContent = msg;
    error.hidden = false;
  }
}

function renderBatch(data, name) {
  // Rows arrive with their inputs as a compact array; expose them as a keyed object.
  for (const r of data.rows) r.values = Object.fromEntries(data.columns.map((c, i) => [c, r.v[i]]));
  Object.assign(B, {
    rows: data.rows, hasTarget: data.hasTarget, tiers: data.tiers, file: name, page: 0,
    f: { tier: null, bin: null, course: null, cell: null, q: "" }, sort: { key: "risk", dir: -1 },
  });
  $("#search").value = "";
  $("#batch-empty").hidden = true;
  $("#batch-result").hidden = false;

  const total = B.rows.length;
  const count = (t) => B.rows.filter((r) => r.tier === t).length;
  const high = count("High"), watch = count("Watch"), low = count("Low");

  $("#batch-file").textContent = name;
  tweenNumber($("#hl-count"), 0, high, (v) => num(Math.round(v)));
  $("#hl-noun").textContent = high === 1 ? "student" : "students";
  $("#hl-sub").textContent = `of ${num(total)} scored · ${num(watch)} to watch · ${num(low)} low risk`;

  $("#tiers").innerHTML = B.tiers.map((t) => {
    const n = count(t.key);
    return `<button class="tier c-${t.key}" type="button" data-tier="${t.key}" aria-pressed="false">
      <span class="top"><span class="name">${t.label}</span><span class="share">${pct(n / total)}%</span></span>
      <span class="n" data-count="${n}">${num(n)}</span>
      <span class="hint">${esc(t.hint)}</span></button>`;
  }).join("");
  $$("#tiers .n").forEach((node) => tweenNumber(node, 0, Number(node.dataset.count), (v) => num(Math.round(v))));

  renderHist();
  renderCourses();
  renderConfusion(data.accuracy);
  refresh();
}

function renderHist() {
  const bins = Array(10).fill(0);
  B.rows.forEach((r) => bins[binOf(r)]++);
  const max = Math.max(...bins, 1);
  $("#hist").innerHTML = bins.map((n, i) => {
    const range = `${i * 10}–${i * 10 + 10}%`;
    return `<button type="button" class="c-${tierOfBin(i)}" data-bin="${i}" aria-pressed="false"
        aria-label="${range} dropout risk: ${n} students" data-tip="${range} dropout risk · ${num(n)} students">
      <span class="lbl">${n ? num(n) : ""}</span>
      <span class="bar" style="--h:${(n / max) * 100}%; --i:${i}"></span></button>`;
  }).join("");
}

function renderCourses() {
  const agg = new Map();
  for (const r of B.rows) {
    const a = agg.get(r.course) || { n: 0, sum: 0, high: 0 };
    a.n++; a.sum += r.p.Dropout; a.high += r.tier === "High" ? 1 : 0;
    agg.set(r.course, a);
  }
  const list = [...agg.entries()].map(([course, a]) => ({ course, ...a, avg: a.sum / a.n })).sort((x, y) => y.avg - x.avg);
  $("#courses").innerHTML = list.map((c, i) => `
    <button type="button" class="course" data-course="${esc(c.course)}" aria-pressed="false"
        data-tip="${esc(c.course)} · ${num(c.n)} students · ${num(c.high)} high risk">
      <span class="cname">${esc(c.course)}</span>
      <span class="track"><span class="fill" style="width:${c.avg * 100}%; --i:${i}; display:block"></span></span>
      <span class="v">${pct(c.avg)}%</span>
    </button>`).join("");
  const box = $("#courses");
  const edge = () => box.classList.toggle("at-end", box.scrollTop + box.clientHeight >= box.scrollHeight - 4);
  box.onscroll = edge;
  box.scrollTop = 0;
  edge();
}

function renderConfusion(accuracy) {
  const card = $("#accuracy-card");
  card.hidden = !B.hasTarget;
  if (!B.hasTarget) return;
  const classes = state.meta.classes;
  $("#acc-value").textContent = `${(accuracy * 100).toFixed(1)}%`;
  let html = `<span class="h">Actual ↓</span>${classes.map((c) => `<span class="h col">${c}</span>`).join("")}`;
  for (const a of classes) {
    const rowTotal = B.rows.filter((r) => r.target === a).length || 1;
    html += `<span class="h">${a}</span>`;
    for (const p of classes) {
      const n = B.rows.filter((r) => r.target === a && r.label === p).length;
      const share = n / rowTotal;
      const alpha = a === p ? 0.12 + share * 0.45 : Math.max(0.04, share * 0.9);
      html += `<button type="button" class="cell ${a === p ? "ok" : "miss"}" style="--a:${alpha.toFixed(3)}"
          data-actual="${a}" data-pred="${p}" aria-pressed="false"
          data-tip="Actual ${a}, predicted ${p} · ${num(n)} students">${num(n)}<small>${pct(share)}%</small></button>`;
    }
  }
  $("#confusion").innerHTML = html;
}

function applyFilters() {
  const { tier, bin, course, cell } = B.f;
  const q = B.f.q.trim().toLowerCase();
  const list = B.rows.filter((r) =>
    (!tier || r.tier === tier) &&
    (bin === null || binOf(r) === bin) &&
    (!course || r.course === course) &&
    (!cell || (r.target === cell.actual && r.label === cell.pred)) &&
    (!q || String(r.id) === q || r.course.toLowerCase().includes(q)));
  const { key, dir } = B.sort;
  const val = (r) => (key === "risk" ? r.p.Dropout : key === "id" ? r.id : key === "course" ? r.course : key === "label" ? r.label : r.target || "");
  list.sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
  });
  B.view = list;
}

function refresh() {
  applyFilters();
  const active = Boolean(filtering());
  $("#tiers").classList.toggle("filtering", Boolean(B.f.tier));
  $$("#tiers .tier").forEach((t) => t.setAttribute("aria-pressed", B.f.tier === t.dataset.tier));
  $("#hist").classList.toggle("filtering", B.f.bin !== null);
  $$("#hist button").forEach((b) => b.setAttribute("aria-pressed", B.f.bin === Number(b.dataset.bin)));
  $("#courses").classList.toggle("filtering", Boolean(B.f.course));
  $$("#courses .course").forEach((c) => c.setAttribute("aria-pressed", B.f.course === c.dataset.course));
  $$("#confusion .cell").forEach((c) => c.setAttribute("aria-pressed",
    Boolean(B.f.cell && B.f.cell.actual === c.dataset.actual && B.f.cell.pred === c.dataset.pred)));

  const chips = [];
  const tier = B.tiers.find((t) => t.key === B.f.tier);
  if (tier) chips.push(["tier", tier.label]);
  if (B.f.bin !== null) chips.push(["bin", `Risk ${B.f.bin * 10}–${B.f.bin * 10 + 10}%`]);
  if (B.f.course) chips.push(["course", B.f.course]);
  if (B.f.cell) chips.push(["cell", `Actual ${B.f.cell.actual} · predicted ${B.f.cell.pred}`]);
  if (B.f.q.trim()) chips.push(["q", `“${B.f.q.trim()}”`]);
  $("#chips").innerHTML = chips.map(([k, label]) =>
    `<button type="button" class="chip" data-clear="${k}" aria-label="Remove filter ${esc(label)}">${esc(label)}<span class="x">✕</span></button>`).join("")
    + (chips.length > 1 ? `<button type="button" class="chip clear" data-clear="all">Clear all</button>` : "");

  $("#list-count").textContent = active ? `${num(B.view.length)} of ${num(B.rows.length)}` : num(B.rows.length);
  const dl = $("#download-filtered");
  dl.hidden = !active || B.view.length === 0;
  dl.textContent = `Download ${num(B.view.length)} shown`;
  renderHead();
  renderList();
}

function renderHead() {
  const cols = [["id", "Row"], ["course", "Course"], ["risk", "Dropout risk"], ["label", "Prediction"]];
  if (B.hasTarget) cols.push(["target", "Actual"]);
  $("#thead-row").innerHTML = cols.map(([key, label]) => {
    const sorted = B.sort.key === key ? ` aria-sort="${B.sort.dir > 0 ? "ascending" : "descending"}"` : "";
    return `<th data-sort="${key}"${sorted}>${label}<span class="arrow">↓</span></th>`;
  }).join("") + `<th class="flags-col"></th><th></th>`;
}

function renderList() {
  const pages = Math.max(1, Math.ceil(B.view.length / PAGE));
  B.page = Math.min(Math.max(0, B.page), pages - 1);
  const start = B.page * PAGE, slice = B.view.slice(start, start + PAGE);
  $("#rows").innerHTML = slice.map((r, i) => {
    const v = r.values, ok = r.target === r.label;
    const flags = (v["Tuition fees up to date"] === 0 ? `<span class="flag">Fees unpaid</span>` : "")
      + (v.Debtor === 1 ? `<span class="flag">Debtor</span>` : "");
    return `<tr tabindex="0" data-id="${r.id}" style="animation-delay:${Math.min(i, 12) * 18}ms">
      <td class="row-n">${r.id}</td>
      <td class="course-cell">${esc(r.course)}</td>
      <td><div class="risk c-${r.tier}"><div class="track"><div class="fill" style="width:${r.p.Dropout * 100}%"></div></div><span class="v">${pct(r.p.Dropout)}%</span></div></td>
      <td><span class="pill c-${r.label}">${r.label}</span></td>
      ${B.hasTarget ? `<td><span class="match"><span class="mk ${ok ? "ok" : "no"}" aria-label="${ok ? "correct" : "incorrect"}">${ok ? "✓" : "✕"}</span>${esc(r.target)}</span></td>` : ""}
      <td class="flags-col">${flags}</td>
      <td class="row-chev" aria-hidden="true">›</td>
    </tr>`;
  }).join("");
  $("#empty-list").hidden = slice.length > 0;
  $("#page-info").textContent = B.view.length ? `${num(start + 1)}–${num(start + slice.length)} of ${num(B.view.length)}` : "";
  $("#prev").disabled = B.page === 0;
  $("#next").disabled = B.page >= pages - 1;
}

function toCsv(rows) {
  const keys = Object.keys(rows[0].values);
  const head = ["Row", "Course name", "Prediction", "Risk tier", "P(Dropout)", "P(Enrolled)", "P(Graduate)",
    ...(B.hasTarget ? ["Target"] : []), ...keys];
  const q = (s) => (/[",\n;]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const lines = [head.map(q).join(",")];
  for (const r of rows) {
    lines.push([r.id, r.course, r.label, r.tier, r.p.Dropout, r.p.Enrolled, r.p.Graduate,
      ...(B.hasTarget ? [r.target] : []), ...keys.map((k) => r.values[k])].map(q).join(","));
  }
  return lines.join("\n");
}

/* ---------------- Detail sheet ---------------- */

let sheetReturn = null, sheetTimer = null;

function openSheet(row) {
  B.sheetRow = row;
  sheetReturn = document.activeElement;
  clearTimeout(sheetTimer);
  const root = $("#sheet-result");
  $("#sheet-eyebrow").textContent = `Row ${row.id}`;
  $("#sheet-title").textContent = row.course;
  const actual = $("#sheet-actual");
  actual.hidden = !row.target;
  if (row.target) actual.textContent = `Actual outcome: ${row.target} · ${row.target === row.label ? "prediction correct" : "prediction missed"}`;

  root.dataset.shown = 0;
  $(".ring-value", root).style.strokeDashoffset = RING;
  $$(".fill", root).forEach((f) => (f.style.width = "0"));
  $(".drivers-list", root).innerHTML = "";
  $(".drivers-empty", root).hidden = true;

  const v = row.values, yn = (x) => (Number(x) === 1 ? "Yes" : "No");
  const passed = (s) => {
    const e = v[`Curricular units ${s} sem (enrolled)`], a = v[`Curricular units ${s} sem (approved)`];
    return [`${a} of ${e}`, e > 0 && a / e < 0.5];
  };
  const [p1, bad1] = passed("1st"), [p2, bad2] = passed("2nd");
  const facts = [
    ["Tuition paid", yn(v["Tuition fees up to date"]), v["Tuition fees up to date"] === 0],
    ["Owes the institution", yn(v.Debtor), v.Debtor === 1],
    ["Scholarship", yn(v["Scholarship holder"])],
    ["Age at enrolment", v["Age at enrollment"]],
    ["1st sem units passed", p1, bad1],
    ["2nd sem units passed", p2, bad2],
    ["1st sem grade", `${Number(v["Curricular units 1st sem (grade)"]).toFixed(1)} / 20`],
    ["2nd sem grade", `${Number(v["Curricular units 2nd sem (grade)"]).toFixed(1)} / 20`],
    ["Admission grade", Number(v["Admission grade"]).toFixed(1)],
    ["Attendance", v["Daytime/evening attendance"] === 1 ? "Daytime" : "Evening"],
  ];
  $("#sheet-facts").innerHTML = facts.map(([k, val, bad]) =>
    `<div><dt>${k}</dt><dd${bad ? ' class="bad"' : ""}>${esc(val)}</dd></div>`).join("");

  const sheet = $("#sheet"), backdrop = $("#sheet-backdrop");
  sheet.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sheet.classList.add("open");
    backdrop.classList.add("open");
    paintResult(root, { label: row.label, probabilities: row.p });
  }));
  $("#sheet-close").focus({ preventScroll: true });
  $(".sheet-body", sheet).scrollTop = 0;

  api("/api/predict", { values: row.values }).then((res) => {
    if (B.sheetRow === row) paintDrivers(root, res.drivers);
  }).catch(() => {});
}

function closeSheet() {
  const sheet = $("#sheet"), backdrop = $("#sheet-backdrop");
  sheet.classList.remove("open");
  backdrop.classList.remove("open");
  sheetTimer = setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, reduceMotion ? 0 : 420);
  B.sheetRow = null;
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
}

/* ---------------- Model ---------------- */

function renderModel(meta) {
  const m = meta.metrics, b = meta.baseline;
  $("#model-lede").textContent = `Tuned ${meta.modelName}, tested on ${num(meta.testRows)} students it never saw.`;
  const tiles = [
    ["Macro-F1", m.macro_f1.toFixed(3), `Baseline ${b.macro_f1.toFixed(3)}`],
    ["Balanced accuracy", `${(m.balanced_accuracy * 100).toFixed(1)}%`, "Average recall per class"],
    ["Accuracy", `${(m.accuracy * 100).toFixed(1)}%`, `Baseline ${(b.accuracy * 100).toFixed(1)}%`],
    ["ROC-AUC", m.roc_auc_ovr_macro.toFixed(3), "One-vs-rest, macro"],
  ];
  $("#tiles").innerHTML = tiles.map(([name, value, sub]) => `
    <div class="tile"><div class="value">${value}</div><div class="name">${name}</div><div class="sub">${sub}</div></div>`).join("");
  const max = Math.max(...meta.importance.map((r) => r.value));
  $("#importance").innerHTML = meta.importance.map((r) => `
    <li><span>${esc(r.label)}</span>
      <div class="track"><div class="fill" style="width:${(r.value / max) * 100}%"></div></div>
      <span class="v">${r.value.toFixed(3)}</span></li>`).join("");
}

/* ---------------- Logo, splash, background ---------------- */

function runSplash() {
  const splash = $("#splash");
  if (splash.hidden) return;
  try { sessionStorage.setItem("splashSeen", "1"); } catch { /* private mode */ }
  const html = document.documentElement;
  setTimeout(() => {
    const logo = $("#splash-logo"), brand = $("#brand-logo");
    const from = logo.getBoundingClientRect(), to = brand.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    html.classList.add("brand-wait");
    html.classList.remove("splashing");
    splash.classList.add("leaving");
    logo.style.transition = "transform .75s cubic-bezier(0.32, 0.72, 0, 1)";
    logo.style.transform = `translate(${dx}px, ${dy}px) scale(${to.width / from.width})`;
    setTimeout(() => { html.classList.remove("brand-wait"); splash.remove(); }, 780);
  }, 1500);
}

function bindLogo() {
  const brand = $(".brand"), logo = $("#brand-logo");
  brand.addEventListener("mouseenter", () => {
    if (reduceMotion) return;
    logo.classList.remove("draw");
    void logo.getBoundingClientRect();
    logo.classList.add("draw");
  });
}

function fluidBackground() {
  if (reduceMotion) return;
  const bg = $("#bg");
  let tx = 0, ty = 0, x = 0, y = 0, raf = null;
  const loop = () => {
    x += (tx - x) * 0.05;
    y += (ty - y) * 0.05;
    bg.style.setProperty("--px", `${x.toFixed(1)}px`);
    bg.style.setProperty("--py", `${y.toFixed(1)}px`);
    raf = Math.abs(tx - x) > 0.2 || Math.abs(ty - y) > 0.2 ? requestAnimationFrame(loop) : null;
  };
  addEventListener("pointermove", (e) => {
    tx = (e.clientX / innerWidth - 0.5) * -48;
    ty = (e.clientY / innerHeight - 0.5) * -48;
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
}

/* ---------------- Init ---------------- */

async function init() {
  runSplash();
  bindLogo();
  fluidBackground();
  bindTooltips();
  bindNav();
  bindBatch();
  try {
    state.meta = await api("/api/meta");
  } catch {
    toast("Couldn't load the model. Start it with: python app/server.py");
    return;
  }
  buildBars($("#result"));
  buildBars($("#sheet-result"));
  buildForm(state.meta.fields);
  const defaults = Object.fromEntries(state.meta.fields.map((f) => [f.key, f.default]));
  applyValues(defaults);
  $("#reset").addEventListener("click", () => { applyValues(defaults); predict(); });
  renderModel(state.meta);
  watchResultVisibility();
  predict();
}

init();
