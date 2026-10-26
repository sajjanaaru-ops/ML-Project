"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decimals = (step) => (String(step).split(".")[1] || "").length;
const fmt = (v, step = 1) => Number(v).toFixed(decimals(step));
const pct = (v) => Math.round(v * 100);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const OUTCOME = {
  Graduate: "Likely to graduate",
  Enrolled: "Likely to be delayed",
  Dropout: "At risk of dropping out",
};
const RING = 2 * Math.PI * 52;

const state = { meta: null, values: {}, controls: {}, shownPct: 0, label: null };

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

async function api(path, body, signal) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("request failed"), { status: res.status, detail: data.detail });
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

/* ---------------- Controls ---------------- */

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
    state.controls[f.key].clamp = clamp;
  }
}

function applyValues(values) {
  state.values = { ...values };
  for (const [key, control] of Object.entries(state.controls)) control.set(values[key]);
  for (const control of Object.values(state.controls)) control.clamp && control.clamp();
}

/* ---------------- Prediction ---------------- */

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
    render(result);
  } catch (err) {
    if (err.name !== "AbortError") toast("Couldn't reach the model. Is the server still running?");
  }
}

function tweenNumber(node, from, to) {
  if (reduceMotion || from === to) { node.textContent = to; return; }
  const start = performance.now(), dur = 420;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    node.textContent = Math.round(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function render({ label, probabilities, drivers }) {
  const p = pct(probabilities[label]);
  const card = $("#result");
  card.className = `result card c-${label}`;

  const ring = $("#ring-value");
  ring.style.stroke = "var(--c)";
  ring.style.strokeDashoffset = RING * (1 - probabilities[label]);
  tweenNumber($("#result-pct"), state.shownPct, p);
  state.shownPct = p;

  const outcome = $("#result-outcome");
  outcome.textContent = OUTCOME[label];
  outcome.style.color = "var(--c)";

  for (const cls of state.meta.classes) {
    const row = $(`#bar-${cls}`);
    $(".pct", row).textContent = `${pct(probabilities[cls])}%`;
    $(".fill", row).style.width = `${probabilities[cls] * 100}%`;
  }

  const list = $("#drivers");
  list.innerHTML = drivers.map((d) => {
    const v = Math.round(d.effect * 100);
    const cls = v > 0 ? "up" : "down";
    return `<li><span>${esc(d.text)}</span><span class="effect ${cls}">${v > 0 ? "+" : "−"}${Math.abs(v)}%</span></li>`;
  }).join("");
  $("#drivers-empty").hidden = drivers.length > 0;

  const peek = $("#peek");
  peek.className = `peek c-${label}${peek.classList.contains("show") ? " show" : ""}`;
  $("#peek-text").textContent = `${OUTCOME[label]} · ${p}%`;
  state.label = label;
}

function buildBars(classes) {
  $("#result-bars").innerHTML = classes.map((c) => `
    <li id="bar-${c}" class="c-${c}">
      <div class="row"><span class="name">${c}</span><span class="pct">–</span></div>
      <div class="track"><div class="fill" style="background: var(--c)"></div></div>
    </li>`).join("");
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

let lastCsv = null;

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
  $("#download").addEventListener("click", () => {
    if (!lastCsv) return;
    const url = URL.createObjectURL(new Blob([lastCsv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "predictions.csv" });
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function scoreFile(file) {
  const status = $("#dz-status"), error = $("#batch-error");
  error.hidden = true;
  status.textContent = `Scoring ${file.name}…`;
  try {
    const data = await api("/api/batch", { csv: await file.text() });
    status.textContent = file.name;
    renderBatch(data);
  } catch (err) {
    status.textContent = "Semicolon or comma separated";
    $("#batch-result").hidden = true;
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

function renderBatch(data) {
  lastCsv = data.csv;
  const classes = state.meta.classes;
  $("#batch-rows").textContent = data.rows.toLocaleString();
  $("#batch-stack").innerHTML = classes.map((c) => `<span class="c-${c}" style="flex-grow:${data.counts[c]}" title="${c}: ${data.counts[c]}"></span>`).join("");
  $("#batch-legend").innerHTML = classes.map((c) => `
    <li class="c-${c}"><span class="dot"></span>${c}<span class="n">${data.counts[c].toLocaleString()} · ${pct(data.counts[c] / data.rows)}%</span></li>`).join("");
  const acc = $("#batch-accuracy");
  acc.hidden = data.accuracy === null;
  if (data.accuracy !== null) acc.textContent = `Accuracy ${(data.accuracy * 100).toFixed(1)}%`;
  $("#table-note").textContent = data.rows > data.top.length ? `Top ${data.top.length} of ${data.rows.toLocaleString()}` : "";
  $("#batch-table").innerHTML = data.top.map((r) => `
    <tr>
      <td class="row-n">${r.row}</td>
      <td>${esc(r.course)}</td>
      <td><span class="pill c-${r.label}">${r.label}</span></td>
      ${classes.map((c) => `<td class="num">${pct(r.probabilities[c])}%</td>`).join("")}
    </tr>`).join("");
  $("#batch-result").hidden = false;
  $("#dropzone").classList.add("compact");
}

/* ---------------- Model ---------------- */

function renderModel(meta) {
  const m = meta.metrics, b = meta.baseline;
  $("#model-lede").textContent = `Tuned ${meta.modelName}, tested on ${meta.testRows.toLocaleString()} students it never saw.`;
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

/* ---------------- Init ---------------- */

async function init() {
  bindNav();
  bindBatch();
  try {
    state.meta = await api("/api/meta");
  } catch {
    toast("Couldn't load the model. Start it with: python app/server.py");
    return;
  }
  buildBars(state.meta.classes);
  buildForm(state.meta.fields);
  const defaults = Object.fromEntries(state.meta.fields.map((f) => [f.key, f.default]));
  applyValues(defaults);
  $("#reset").addEventListener("click", () => { applyValues(defaults); predict(); });
  renderModel(state.meta);
  watchResultVisibility();
  predict();
}

init();
