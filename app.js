/* Mapa de Revistas: keywords -> journals (OpenAlex, live) -> impact (OpenAlex 2-year mean citedness) and Qualis (Sucupira). */
"use strict";

const OA = "https://api.openalex.org";
const STRATA = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
const FETCH_PER_KEYWORD = 80;            // journals fetched per keyword; the Qualis filter then picks the top N shown
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

let qualis = null;                       // {areas: [...], j: {ISSN: [stratum, areaIndex]}, meta}
let result = null;                       // {keywords: [{keyword, total, journals: [...]}], since}
let shownQ = new Set(store.get("mr.q", [...STRATA, "none"]));
let yLog = store.get("mr.ylog", true);
let sortKey = "if2", sortDir = -1;

function qColor(q) {
  if (q === "A1") return "var(--qa1)";
  if (q === "A2") return "var(--qa2)";
  if (q === "A3") return "var(--qa3)";
  if (q === "A4") return "var(--qa4)";
  if (q && q[0] === "B") return "var(--qb)";
  if (q === "C") return "var(--qc)";
  return null;
}

/* ---------- Qualis ---------- */
async function loadQualis() {
  try {
    const r = await fetch("data/qualis.json");
    if (!r.ok) throw new Error(r.status);
    qualis = await r.json();
    const m = qualis.meta || {};
    $("qmeta").textContent = m.event ? `Qualis ${m.event}, lista consultada em ${m.consulted}.` : "";
  } catch {
    qualis = { areas: [], j: {} };
    $("qmeta").textContent = "A lista Qualis (data/qualis.json) não foi encontrada: os pontos aparecem sem estrato.";
  }
}
function qualisOf(issns) {
  let best = null;
  for (const raw of issns || []) {
    const hit = qualis.j[String(raw).toUpperCase()];
    if (hit && (!best || STRATA.indexOf(hit[0]) < STRATA.indexOf(best[0]))) best = hit;
  }
  return best ? { q: best[0], parent: qualis.areas[best[1]] || "" } : { q: "", parent: "" };
}

/* ---------- OpenAlex ---------- */
async function getJSON(url, signal) {
  const r = await fetch(url, { signal });
  if (r.status === 429) throw Object.assign(new Error("limite"), { code: "rate" });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { code: "http" });
  return r.json();
}
async function journalsFor(keyword, since, signal) {
  const phrase = `"${keyword.replace(/"/g, "")}"`;
  const filter = [`title_and_abstract.search:${phrase}`, `from_publication_date:${since}-01-01`,
    "primary_location.source.type:journal"].join(",");
  const url = `${OA}/works?filter=${encodeURIComponent(filter)}&group_by=primary_location.source.id&per_page=200`;
  const d = await getJSON(url, signal);
  const groups = (d.group_by || []).filter((g) => g.key && /openalex\.org\/S\d+/.test(g.key))
    .sort((a, b) => b.count - a.count).slice(0, FETCH_PER_KEYWORD);
  return { keyword, total: d.meta?.count ?? 0, groups };
}
async function sourcesById(ids, signal) {
  const out = new Map();
  const short = [...new Set(ids)].map((k) => k.split("/").pop());
  for (let i = 0; i < short.length; i += 50) {
    const part = short.slice(i, i + 50);
    const url = `${OA}/sources?filter=openalex:${part.join("|")}&per_page=50` +
      "&select=id,display_name,issn_l,issn,summary_stats,host_organization_name,is_oa,homepage_url";
    const d = await getJSON(url, signal);
    for (const s of d.results || []) out.set(s.id, s);
  }
  return out;
}

/* ---------- search ---------- */
let ctl = null;
function setStatus(t, err = false) { const s = $("status"); s.textContent = t; s.classList.toggle("error", err); }

async function search(ev) {
  ev?.preventDefault();
  const kws = $("kw").value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const since = $("since").value;
  if (!kws.length) { setStatus("Escreva pelo menos uma palavra-chave.", true); return; }
  syncURL();
  const key = JSON.stringify([kws, since]);
  const cache = store.get("mr.cache", {});
  if (cache[key] && Date.now() - cache[key].at < 7 * 864e5) {
    result = cache[key].data; render(); setStatus(`Resultado guardado de ${new Date(cache[key].at).toLocaleDateString("pt-BR")}.`); return;
  }
  ctl?.abort(); ctl = new AbortController();
  $("go").disabled = true;
  setStatus("Buscando na OpenAlex…");
  try {
    const per = [];
    for (const k of kws) { per.push(await journalsFor(k, since, ctl.signal)); setStatus(`Buscando na OpenAlex… ${per.length}/${kws.length}`); }
    const src = await sourcesById(per.flatMap((p) => p.groups.map((g) => g.key)), ctl.signal);
    result = {
      since, keywords: per.map((p) => {
        const max = Math.max(1, ...p.groups.map((g) => g.count));
        return {
          keyword: p.keyword, total: p.total, journals: p.groups.map((g) => {
            const s = src.get(g.key) || {};
            const ql = qualisOf([s.issn_l, ...(s.issn || [])]);
            return {
              id: g.key, name: s.display_name || g.key_display_name, count: g.count,
              pos: Math.log(1 + g.count) / Math.log(1 + max),
              if2: typeof s.summary_stats?.["2yr_mean_citedness"] === "number" ? s.summary_stats["2yr_mean_citedness"] : null,
              h: s.summary_stats?.h_index ?? null, pub: s.host_organization_name || "", oa: !!s.is_oa,
              url: /^https?:\/\//.test(s.homepage_url || "") ? s.homepage_url : g.key, q: ql.q, parent: ql.parent,
            };
          }),
        };
      }),
    };
    cache[key] = { at: Date.now(), data: result };
    const keys = Object.keys(cache); if (keys.length > 12) delete cache[keys[0]];
    store.set("mr.cache", cache);
    render();
    setStatus(`${kws.length} palavras-chave, artigos desde ${since}.`);
  } catch (e) {
    if (e.name === "AbortError") return;
    setStatus(e.code === "rate" ? "A OpenAlex limitou as consultas por agora. Tente de novo em alguns minutos."
      : "Não foi possível consultar a OpenAlex. Verifique a conexão e tente de novo.", true);
  } finally { $("go").disabled = false; }
}

/* ---------- chart ---------- */
function visible() {
  const n = Math.max(1, Math.min(40, Math.round(Number($("n").value) || 10)));
  return result.keywords.map((k, ki) => ({
    ...k, ki, shown: k.journals.filter((j) => shownQ.has(j.q || "none")).slice(0, n),
  }));
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  return out;
}
function linTicks(hi) {
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => hi / s <= 6) || 200;
  const out = []; for (let v = 0; v <= hi + 1e-9; v += step) out.push(v); return out;
}

function drawChart() {
  const host = $("chart"), tip = $("tip");
  host.querySelectorAll("svg").forEach((s) => s.remove());
  if (!result) return;
  const cols = visible();
  const W = Math.max(320, host.clientWidth || 900), narrow = W < 560;
  const H = narrow ? 420 : 500, m = { l: 52, r: 14, t: 14, b: narrow ? 70 : 60 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Revistas por palavra-chave e impacto em dois anos");
  const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  const pts = cols.flatMap((c) => c.shown.filter((j) => j.if2 > 0).map((j) => ({ ...j, ki: c.ki, kw: c.keyword })));
  if (!pts.length) {
    const t = el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" });
    t.textContent = "Nenhuma revista com esses filtros. Marque mais estratos Qualis ou aumente o número de revistas.";
    host.insertBefore(svg, tip); return;
  }
  const vals = pts.map((p) => p.if2);
  let y, ticks;
  if (yLog) {
    const lo = Math.max(0.1, Math.min(...vals) / 1.4), hi = Math.max(...vals) * 1.4;
    ticks = logTicks(lo, hi);
    y = (v) => m.t + ih - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * ih;
  } else {
    let hi = Math.max(...vals) * 1.1; ticks = linTicks(hi); hi = Math.max(hi, ticks[ticks.length - 1]);
    y = (v) => m.t + ih - (v / hi) * ih;
  }
  const bw = iw / cols.length, pad = Math.min(24, bw * 0.12);
  const x = (p) => m.l + p.ki * bw + pad + p.pos * (bw - 2 * pad);
  for (const t of ticks) {
    const yy = y(t);
    el("line", { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: "var(--grid)" });
    el("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end", class: "tick" }).textContent = t >= 1 ? String(t) : t.toFixed(1);
  }
  el("text", { x: 12, y: m.t + ih / 2, transform: `rotate(-90 12 ${m.t + ih / 2})`, "text-anchor": "middle" })
    .textContent = "Impacto em 2 anos (OpenAlex)" + (yLog ? ", escala log" : "");
  el("line", { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: "var(--axis)" });
  cols.forEach((c, i) => {
    const x0 = m.l + i * bw;
    if (i > 0) el("line", { x1: x0, x2: x0, y1: m.t, y2: m.t + ih, stroke: "var(--grid)", "stroke-dasharray": "2 4" });
    const words = c.keyword.split(/\s+/), lines = [""], maxCh = Math.max(6, Math.floor(bw / 7));
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && (cur + " " + w).length > maxCh) lines.push(w); else lines[lines.length - 1] = (cur + " " + w).trim();
    }
    const shownLines = lines.slice(0, 2);
    shownLines.forEach((ln, li) => {
      el("text", { x: x0 + bw / 2, y: m.t + ih + 18 + li * 14, "text-anchor": "middle", class: "kw" })
        .textContent = li === 1 && lines.length > 2 ? ln + "…" : ln;
    });
    el("text", { x: x0 + bw / 2, y: m.t + ih + 18 + shownLines.length * 14, "text-anchor": "middle" })
      .textContent = c.total ? `${c.total.toLocaleString("pt-BR")} artigos` : "nenhum artigo";
  });
  const labelled = new Set();
  cols.forEach((c) => [...c.shown].filter((j) => j.if2 > 0).sort((a, b) => b.if2 - a.if2).slice(0, narrow ? 1 : 2)
    .forEach((j) => labelled.add(`${c.ki}|${j.id}`)));
  const placed = [];
  for (const p of pts.sort((a, b) => a.if2 - b.if2)) {
    const cx = x(p), cy = y(p.if2), col = qColor(p.q);
    el("circle", { cx, cy, r: 6.5, fill: col || "var(--surface)", stroke: col ? "var(--surface)" : "var(--muted)", "stroke-width": 2 });
    if (labelled.has(`${p.ki}|${p.id}`)) {
      const text = p.name.length > 26 ? p.name.slice(0, 25) + "…" : p.name, lx = cx + 9, ly = cy + 3.5;
      const box = { x: lx, y: ly - 10, w: text.length * 5.7, h: 13 };
      const hit = placed.some((b) => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y));
      if (!hit && lx + box.w < m.l + iw + 12) { el("text", { x: lx, y: ly, class: "lbl" }).textContent = text; placed.push(box); }
    }
    const h = el("circle", { cx, cy, r: 13, fill: "transparent", tabindex: 0, "aria-label": `${p.name}, impacto ${p.if2.toFixed(1)}, Qualis ${p.q || "sem estrato"}` });
    const show = () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(p.name)}</b>Qualis <span class="mono">${esc(p.q || "—")}</span>${p.parent ? ` (${esc(p.parent.toLowerCase())})` : ""}` +
        `<br>Impacto 2 anos <span class="mono">${p.if2.toFixed(2)}</span>${p.h != null ? ` · h <span class="mono">${p.h}</span>` : ""}` +
        `<br>${esc(p.kw)}: <span class="mono">${p.count}</span> artigos desde ${esc(result.since)}` +
        `${p.pub ? `<br>${esc(p.pub)}` : ""}${p.oa ? " · acesso aberto" : ""}`;
      const r = host.getBoundingClientRect(), sx = r.width / W;
      let tx = cx * sx + 14; const ty = Math.max(0, cy * sx - 10);
      if (tx + 290 > r.width) tx = cx * sx - 304;
      tip.style.left = Math.max(0, tx) + "px"; tip.style.top = ty + "px";
    };
    h.addEventListener("mouseenter", show); h.addEventListener("focus", show);
    h.addEventListener("mouseleave", () => (tip.hidden = true)); h.addEventListener("blur", () => (tip.hidden = true));
    h.addEventListener("click", () => window.open(p.url, "_blank", "noopener"));
  }
  host.insertBefore(svg, tip);
}

/* ---------- table ---------- */
function drawTable() {
  if (!result) return;
  const by = new Map();
  for (const c of visible()) for (const j of c.shown) {
    if (!by.has(j.id)) by.set(j.id, { ...j, kws: [], total: 0 });
    const r = by.get(j.id); r.kws.push({ kw: c.keyword, n: j.count }); r.total += j.count;
  }
  const rows = [...by.values()];
  const val = (r) => sortKey === "q" ? (r.q ? STRATA.indexOf(r.q) : 99) : r[sortKey];
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || va === "") return 1; if (vb == null || vb === "") return -1;
    return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR")) * (sortKey === "q" ? -sortDir : sortDir);
  });
  $("rows").innerHTML = rows.map((r) => {
    const col = qColor(r.q);
    const badge = r.q ? `<span class="qbadge" style="background:${col};color:${["A1", "A2"].includes(r.q) ? "var(--surface)" : "var(--ink)"}">${r.q}</span>` : "—";
    return `<tr><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${badge}</td>
      <td class="num">${r.if2 != null ? r.if2.toFixed(2) : "—"}</td><td class="num">${r.h ?? "—"}</td>
      <td>${r.kws.map((k) => `<span class="kwtag">${esc(k.kw)} <span class="mono">${k.n}</span></span>`).join("")}</td>
      <td>${esc((r.parent || "—").toLowerCase())}</td><td>${esc(r.pub) || "—"}</td><td>${r.oa ? "aberto" : "—"}</td></tr>`;
  }).join("");
  $("count").textContent = `${rows.length} revistas`;
}

function render() {
  $("ylog").setAttribute("aria-pressed", String(yLog));
  $("ylin").setAttribute("aria-pressed", String(!yLog));
  drawChart(); drawTable();
}

/* ---------- controls ---------- */
function drawChips() {
  const items = [...STRATA, "none"];
  $("qchips").innerHTML = items.map((q) => {
    const col = qColor(q === "none" ? "" : q);
    return `<button type="button" class="qchip" data-q="${q}" aria-pressed="${shownQ.has(q)}">` +
      `<i class="sw ${col ? "" : "none"}" style="${col ? `background:${col}` : ""}"></i>${q === "none" ? "sem Qualis" : q}</button>`;
  }).join("") + `<button type="button" class="qchip" id="qA" aria-pressed="false">só A1–A3</button>`;
  $("qchips").querySelectorAll(".qchip[data-q]").forEach((b) => b.addEventListener("click", () => {
    const q = b.dataset.q; shownQ.has(q) ? shownQ.delete(q) : shownQ.add(q); afterFilter();
  }));
  $("qA").addEventListener("click", () => { shownQ = new Set(["A1", "A2", "A3"]); afterFilter(); });
}
function afterFilter() { store.set("mr.q", [...shownQ]); drawChips(); syncURL(); render(); }

function syncURL() {
  const p = new URLSearchParams({ q: $("kw").value, n: $("n").value, desde: $("since").value, qualis: [...shownQ].join(",") });
  history.replaceState(null, "", "?" + p.toString());
}
function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("q")) $("kw").value = p.get("q");
  if (p.get("n")) $("n").value = p.get("n");
  if (p.get("desde")) $("since").value = p.get("desde");
  if (p.get("qualis")) shownQ = new Set(p.get("qualis").split(",").filter((q) => STRATA.includes(q) || q === "none"));
}

(async function init() {
  const yr = new Date().getFullYear();
  $("since").innerHTML = [yr - 2, yr - 4, yr - 6, yr - 10, yr - 20].map((v) => `<option value="${v}">${v}</option>`).join("");
  $("since").value = String(yr - 6);
  readURL(); drawChips();
  $("f").addEventListener("submit", search);
  $("n").addEventListener("change", () => { syncURL(); render(); });
  $("ylog").addEventListener("click", () => { yLog = true; store.set("mr.ylog", true); render(); });
  $("ylin").addEventListener("click", () => { yLog = false; store.set("mr.ylog", false); render(); });
  document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (["if2", "h", "total", "q"].includes(k) ? -1 : 1); sortKey = k; drawTable();
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
  await loadQualis();
  search();
})();
