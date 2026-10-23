/* Mapa de Revistas: keywords -> journals (OpenAlex, live) -> impact (SCImago/Scopus or OpenAlex) and Qualis (Sucupira).
   Each journal is one point: x = how many of the keywords it publishes on, y = the chosen impact metric. */
"use strict";

const OA = "https://api.openalex.org";
const STRATA = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
const GROUPS_PER_KEYWORD = 200;          // journals read per keyword (OpenAlex's largest group page)
const DATA_VERSION = "2026-10-23c";      // bump when data/*.json change, so browsers fetch the new files
const METRICS = {
  c3: { label: "Citações por artigo, 3 anos (Scopus)", get: (j) => j.c3 },
  c2: { label: "Citações por documento, 2 anos (Scopus)", get: (j) => j.c2 },
  sjr: { label: "SJR (SCImago)", get: (j) => j.sjr },
  oa: { label: "Impacto em 2 anos (OpenAlex)", get: (j) => j.if2 },
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 2) => (typeof v === "number" ? v.toFixed(d) : "—");
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

let qualis = { areas: [], j: {} };       // {areas: [...], j: {ISSN: [stratum, areaIndex]}, meta}
let scimago = { j: {} };                 // {j: {ISSN: [sjr, quartile, h, cites/doc 2y, cites/citable doc 3y]}, meta}
let result = null;                       // {since, keywords: [{keyword, total}], journals: [...]}
let shownQ = new Set(store.get("mr.q", [...STRATA, "none"]));
let shownA = new Set(store.get("mr.a", ["open", "hybrid"]));  // open = fully open-access journal; hybrid = subscription
let yLog = store.get("mr.ylog", true);
let yMetric = METRICS[store.get("mr.y", "c3")] ? store.get("mr.y", "c3") : "c3";
let sortKey = "nkw", sortDir = -1;

function qColor(q) {
  if (q === "A1") return "var(--qa1)";
  if (q === "A2") return "var(--qa2)";
  if (q === "A3") return "var(--qa3)";
  if (q === "A4") return "var(--qa4)";
  if (q && q[0] === "B") return "var(--qb)";
  if (q === "C") return "var(--qc)";
  return null;
}

/* ---------- reference tables ---------- */
async function loadTables() {
  const notes = [];
  try {
    const r = await fetch("data/qualis.json?v=" + DATA_VERSION); if (!r.ok) throw new Error(r.status);
    qualis = await r.json();
    if (qualis.meta?.event) notes.push(`Qualis ${qualis.meta.event}, lista consultada em ${qualis.meta.consulted}.`);
  } catch { notes.push("A lista Qualis (data/qualis.json) não foi encontrada."); }
  try {
    const r = await fetch("data/scimago.json?v=" + DATA_VERSION); if (!r.ok) throw new Error(r.status);
    scimago = await r.json();
    if (scimago.meta?.year) notes.push(`SCImago ${scimago.meta.year}.`);
  } catch { notes.push("A tabela SCImago (data/scimago.json) não foi encontrada."); }
  $("qmeta").textContent = notes.join(" ");
}
function lookup(table, issns) {
  for (const raw of issns || []) { const hit = raw && table[String(raw).toUpperCase()]; if (hit) return hit; }
  return null;
}
function annotate() {
  for (const j of result.journals) {
    let best = null;
    for (const raw of j.issn || []) {
      const hit = raw && qualis.j[String(raw).toUpperCase()];
      if (hit && (!best || STRATA.indexOf(hit[0]) < STRATA.indexOf(best[0]))) best = hit;
    }
    j.q = best ? best[0] : ""; j.parent = best ? (qualis.areas[best[1]] || "") : "";
    const sc = lookup(scimago.j, j.issn) || [];
    j.sjr = sc[0] ?? null; j.sq = sc[1] || ""; j.c2 = sc[3] ?? null; j.c3 = sc[4] ?? null;
    if (j.h == null && sc[2]) j.h = sc[2];
    j.open = !!(j.oa || sc[5] === 1); j.diamond = sc[6] === 1;
  }
}

/* ---------- OpenAlex ---------- */
function apiKey() { return ($("apikey").value || "").trim(); }
async function getJSON(url, signal) {
  const key = apiKey();
  const r = await fetch(key ? `${url}&api_key=${encodeURIComponent(key)}` : url, { signal });
  if ([402, 403, 429].includes(r.status)) throw Object.assign(new Error(String(r.status)), { code: "rate", status: r.status });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { code: "http", status: r.status });
  return r.json();
}
async function journalsFor(keyword, since, signal) {
  const phrase = `"${keyword.replace(/"/g, "")}"`;
  const filter = [`title_and_abstract.search:${phrase}`, `from_publication_date:${since}-01-01`,
    "primary_location.source.type:journal"].join(",");
  const url = `${OA}/works?filter=${encodeURIComponent(filter)}&group_by=primary_location.source.id&per_page=${GROUPS_PER_KEYWORD}`;
  const d = await getJSON(url, signal);
  const groups = (d.group_by || []).filter((g) => g.key && /openalex\.org\/S\d+/.test(g.key));
  return { keyword, total: d.meta?.count ?? 0, groups };
}
async function sourcesById(ids, signal, onProgress) {
  const out = new Map();
  const short = [...new Set(ids)].map((k) => k.split("/").pop());
  for (let i = 0; i < short.length; i += 50) {
    const part = short.slice(i, i + 50);
    const url = `${OA}/sources?filter=openalex:${part.join("|")}&per_page=50` +
      "&select=id,display_name,issn_l,issn,summary_stats,host_organization_name,is_oa,homepage_url";
    const d = await getJSON(url, signal);
    for (const s of d.results || []) out.set(s.id, s);
    onProgress?.(Math.min(i + 50, short.length), short.length);
  }
  return out;
}

/* ---------- search ---------- */
let ctl = null;
function setStatus(t, err = false) { const s = $("status"); s.textContent = t; s.classList.toggle("error", err); }

async function search(ev) {
  ev?.preventDefault();
  const kws = $("kw").value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const since = $("since").value;
  if (!kws.length) { setStatus("Escreva pelo menos uma palavra-chave.", true); return; }
  syncURL();
  const key = JSON.stringify([kws, since]);
  const cache = store.get("mr.cache3", {});
  if (cache[key] && Date.now() - cache[key].at < 7 * 864e5) {
    result = cache[key].data; render();
    setStatus(`Resultado guardado de ${new Date(cache[key].at).toLocaleDateString("pt-BR")}.`); return;
  }
  ctl?.abort(); ctl = new AbortController();
  $("go").disabled = true;
  try {
    const per = [];
    for (const k of kws) {
      setStatus(`Buscando artigos na OpenAlex… ${per.length + 1}/${kws.length}`);
      per.push(await journalsFor(k, since, ctl.signal));
    }
    const src = await sourcesById(per.flatMap((p) => p.groups.map((g) => g.key)), ctl.signal,
      (a, b) => setStatus(`Lendo as revistas… ${a}/${b}`));
    const by = new Map();
    for (const p of per) for (const g of p.groups) {
      if (!by.has(g.key)) {
        const s = src.get(g.key) || {};
        by.set(g.key, {
          id: g.key, name: s.display_name || g.key_display_name, kws: [], total: 0,
          issn: [...new Set([s.issn_l, ...(s.issn || [])].filter(Boolean))],
          if2: typeof s.summary_stats?.["2yr_mean_citedness"] === "number" ? s.summary_stats["2yr_mean_citedness"] : null,
          h: s.summary_stats?.h_index ?? null, pub: s.host_organization_name || "", oa: !!s.is_oa,
          url: /^https?:\/\//.test(s.homepage_url || "") ? s.homepage_url : g.key,
        });
      }
      const j = by.get(g.key);
      j.kws.push({ kw: p.keyword, n: g.count });
      j.total += g.count;
    }
    const journals = [...by.values()];
    for (const j of journals) j.nkw = j.kws.length;
    result = { since, keywords: per.map((p) => ({ keyword: p.keyword, total: p.total })), journals };
    cache[key] = { at: Date.now(), data: result };
    const keys = Object.keys(cache); if (keys.length > 10) delete cache[keys[0]];
    store.set("mr.cache3", cache);
    render();
    setStatus(`${journals.length} revistas publicaram sobre pelo menos uma das ${kws.length} palavras-chave desde ${since}.`);
  } catch (e) {
    if (e.name === "AbortError") return;
    setStatus(e.code === "rate"
      ? (apiKey() ? "A cota diária da sua chave da OpenAlex acabou. Ela renova à meia-noite (UTC)."
        : "A cota gratuita da OpenAlex sem chave acabou (ela é dividida por todos na sua rede). Cole uma chave gratuita da OpenAlex no campo \"Chave da API\".")
      : `Não foi possível consultar a OpenAlex${e.status ? ` (erro ${e.status})` : ""}. Verifique a conexão e tente de novo.`, true);
  } finally { $("go").disabled = false; }
}

/* ---------- selection ---------- */
function visible() {
  const n = Math.max(1, Math.min(300, Math.round(Number($("n").value) || 30)));
  return result.journals.filter(passes).sort((a, b) => b.nkw - a.nkw || b.total - a.total).slice(0, n);
}
function passes(j) { return shownQ.has(j.q || "none") && shownA.has(j.open ? "open" : "hybrid"); }
function jitter(id) {                    // fixed small horizontal offset per journal, so points on the same x stay apart
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.36;
}

/* ---------- chart ---------- */
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  return out;
}
function linTicks(hi) {
  const step = [0.5, 1, 2, 5, 10, 20, 25, 50, 100].find((s) => hi / s <= 6) || 200;
  const out = []; for (let v = 0; v <= hi + 1e-9; v += step) out.push(+v.toFixed(2)); return out;
}

function drawChart() {
  const host = $("chart"), tip = $("tip");
  host.querySelectorAll("svg").forEach((s) => s.remove());
  if (!result) return;
  const K = result.keywords.length, metric = METRICS[yMetric];
  const vis = visible(), pts = vis.filter((j) => metric.get(j) > 0);
  const miss = vis.length - pts.length;
  $("missing").textContent = miss ? `${miss} ${miss === 1 ? "revista sem esse dado ficou" : "revistas sem esse dado ficaram"} fora do gráfico (estão na tabela).` : "";
  const W = Math.max(320, host.clientWidth || 900), narrow = W < 560;
  const H = narrow ? 420 : 500, m = { l: 52, r: 14, t: 14, b: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Revistas por número de palavras-chave e ${metric.label}`);
  const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  if (!pts.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" })
      .textContent = "Nenhuma revista com esses filtros. Marque mais estratos Qualis ou aumente o número de revistas.";
    host.insertBefore(svg, tip); return;
  }
  const vals = pts.map((p) => metric.get(p));
  let y, ticks;
  if (yLog) {
    const lo = Math.max(0.05, Math.min(...vals) / 1.4), hi = Math.max(...vals) * 1.4;
    ticks = logTicks(lo, hi);
    y = (v) => m.t + ih - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * ih;
  } else {
    let hi = Math.max(...vals) * 1.1; ticks = linTicks(hi); hi = Math.max(hi, ticks[ticks.length - 1]);
    y = (v) => m.t + ih - (v / hi) * ih;
  }
  // numeric x axis: the number of keywords the journal publishes on (1..K), with a small fixed jitter
  const xs = (v) => m.l + ((v - 0.5) / K) * iw;
  const x = (p) => xs(p.nkw + jitter(p.id));
  for (const t of ticks) {
    const yy = y(t);
    el("line", { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: "var(--grid)" });
    el("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end", class: "tick" }).textContent = t >= 1 ? String(t) : String(+t.toFixed(2));
  }
  el("text", { x: 12, y: m.t + ih / 2, transform: `rotate(-90 12 ${m.t + ih / 2})`, "text-anchor": "middle" })
    .textContent = metric.label + (yLog ? ", escala log" : "");
  el("line", { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: "var(--axis)" });
  for (let k = 1; k <= K; k++) {
    el("line", { x1: xs(k), x2: xs(k), y1: m.t, y2: m.t + ih, stroke: "var(--grid)" });
    el("line", { x1: xs(k), x2: xs(k), y1: m.t + ih, y2: m.t + ih + 5, stroke: "var(--axis)" });
    el("text", { x: xs(k), y: m.t + ih + 20, "text-anchor": "middle", class: "kw" }).textContent = String(k);
  }
  el("text", { x: m.l + iw / 2, y: m.t + ih + 44, "text-anchor": "middle" })
    .textContent = "Número de palavras-chave em que a revista publica";

  const labelled = new Set();
  for (let k = 1; k <= K; k++) pts.filter((p) => p.nkw === k).sort((a, b) => metric.get(b) - metric.get(a))
    .slice(0, narrow ? 1 : 3).forEach((p) => labelled.add(p.id));
  const placed = [];
  for (const p of [...pts].sort((a, b) => metric.get(a) - metric.get(b))) {
    const v = metric.get(p), cx = x(p), cy = y(v), col = qColor(p.q);
    el("circle", { cx, cy, r: 6.5, fill: col || "var(--surface)", stroke: col ? "var(--surface)" : "var(--muted)", "stroke-width": 2 });
    if (labelled.has(p.id)) {
      const text = p.name.length > 28 ? p.name.slice(0, 27) + "…" : p.name;
      const right = cx + 9 + text.length * 5.7 < m.l + iw + 12;
      const lx = right ? cx + 9 : cx - 9, ly = cy + 3.5;
      const box = { x: right ? lx : lx - text.length * 5.7, y: ly - 10, w: text.length * 5.7, h: 13 };
      const hit = placed.some((b) => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y));
      if (!hit) {
        el("text", { x: lx, y: ly, class: "lbl", "text-anchor": right ? "start" : "end" }).textContent = text;
        placed.push(box);
      }
    }
    const h = el("circle", { cx, cy, r: 13, fill: "transparent", tabindex: 0,
      "aria-label": `${p.name}, ${metric.label} ${fmt(v)}, Qualis ${p.q || "sem estrato"}, ${p.nkw} de ${K} palavras-chave` });
    const show = () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(p.name)}</b>Qualis <span class="mono">${esc(p.q || "—")}</span>${p.parent ? ` (${esc(p.parent.toLowerCase())})` : ""}` +
        `${p.sq ? ` · SJR ${esc(p.sq)}` : ""}` +
        `<br>Cit./artigo 3 anos <span class="mono">${fmt(p.c3)}</span> · SJR <span class="mono">${fmt(p.sjr, 3)}</span>` +
        `<br>OpenAlex 2 anos <span class="mono">${fmt(p.if2)}</span>${p.h != null ? ` · h <span class="mono">${p.h}</span>` : ""}` +
        `<br>Publica sobre ${p.nkw} de ${K} palavras-chave (artigos desde ${esc(result.since)}):` +
        p.kws.map((k) => `<br>· ${esc(k.kw)} <span class="mono">${k.n}</span>`).join("") +
        `${p.pub ? `<br>${esc(p.pub)}` : ""} · ${p.open ? (p.diamond ? "acesso aberto sem taxa" : "acesso aberto") : "híbrida ou assinatura"}`;
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
  const K = result.keywords.length;
  const rows = [...visible()];
  const rank = { q: (r) => (r.q ? STRATA.indexOf(r.q) : 99), sq: (r) => (r.sq ? Number(r.sq.slice(1)) : 99) };
  const val = (r) => (rank[sortKey] ? rank[sortKey](r) : r[sortKey]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || va === "") return 1; if (vb == null || vb === "") return -1;
    const d = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
    return (d || b.total - a.total) * (rank[sortKey] ? -sortDir : sortDir);
  });
  $("rows").innerHTML = rows.map((r) => {
    const col = qColor(r.q);
    const badge = r.q ? `<span class="qbadge" style="background:${col};color:${["A1", "A2"].includes(r.q) ? "var(--surface)" : "var(--ink)"}">${r.q}</span>` : "—";
    return `<tr><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${badge}</td>
      <td>${esc(r.sq) || "—"}</td><td class="num">${fmt(r.c3)}</td><td class="num">${fmt(r.sjr, 3)}</td>
      <td class="num">${fmt(r.if2)}</td><td class="num">${r.h ?? "—"}</td><td class="num">${r.nkw}/${K}</td>
      <td>${r.kws.map((k) => `<span class="kwtag">${esc(k.kw)} <span class="mono">${k.n}</span></span>`).join("")}</td>
      <td>${esc((r.parent || "—").toLowerCase())}</td><td>${esc(r.pub) || "—"}</td>
      <td>${r.open ? (r.diamond ? "aberta, sem taxa" : "aberta") : "híbrida/assinatura"}</td></tr>`;
  }).join("");
  $("count").textContent = `${rows.length} de ${result.journals.filter(passes).length} revistas`;
}

function render() {
  if (!result) return;
  annotate();
  $("ylog").setAttribute("aria-pressed", String(yLog));
  $("ylin").setAttribute("aria-pressed", String(!yLog));
  $("metric").value = yMetric;
  drawChart(); drawTable();
}

/* ---------- controls ---------- */
function drawChips() {
  const items = [...STRATA, "none"];
  $("qchips").innerHTML = items.map((q) => {
    const col = qColor(q === "none" ? "" : q);
    return `<button type="button" class="qchip" data-q="${q}" aria-pressed="${shownQ.has(q)}">` +
      `<i class="sw ${col ? "" : "none"}" style="${col ? `background:${col}` : ""}"></i>${q === "none" ? "sem Qualis" : q}</button>`;
  }).join("") + `<button type="button" class="qchip" id="qA" aria-pressed="false">só A1–A3</button>` +
    `<button type="button" class="qchip" id="qAll" aria-pressed="false">todos</button>`;
  $("qchips").querySelectorAll(".qchip[data-q]").forEach((b) => b.addEventListener("click", () => {
    const q = b.dataset.q; shownQ.has(q) ? shownQ.delete(q) : shownQ.add(q); afterFilter();
  }));
  $("qA").addEventListener("click", () => { shownQ = new Set(["A1", "A2", "A3"]); afterFilter(); });
  $("qAll").addEventListener("click", () => { shownQ = new Set([...STRATA, "none"]); afterFilter(); });
}
function drawAccess() {
  const items = [["open", "Acesso aberto"], ["hybrid", "Híbrida ou assinatura"]];
  $("achips").innerHTML = items.map(([k, label]) =>
    `<button type="button" class="qchip" data-a="${k}" aria-pressed="${shownA.has(k)}">${label}</button>`).join("");
  $("achips").querySelectorAll(".qchip").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.a; shownA.has(k) ? shownA.delete(k) : shownA.add(k); afterFilter();
  }));
}
function afterFilter() {
  store.set("mr.q", [...shownQ]); store.set("mr.a", [...shownA]); drawChips(); drawAccess(); syncURL(); render();
}

function syncURL() {
  const p = new URLSearchParams({ q: $("kw").value, n: $("n").value, desde: $("since").value,
    qualis: [...shownQ].join(","), acesso: [...shownA].join(","), y: yMetric });
  history.replaceState(null, "", "?" + p.toString());
}
function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.get("q")) $("kw").value = p.get("q");
  if (p.get("n")) $("n").value = p.get("n");
  if (p.get("desde")) $("since").value = p.get("desde");
  if (p.get("qualis")) shownQ = new Set(p.get("qualis").split(",").filter((q) => STRATA.includes(q) || q === "none"));
  if (METRICS[p.get("y")]) yMetric = p.get("y");
  if (p.get("acesso")) shownA = new Set(p.get("acesso").split(",").filter((a) => a === "open" || a === "hybrid"));
}

(async function init() {
  const yr = new Date().getFullYear();
  $("since").innerHTML = [yr - 2, yr - 4, yr - 6, yr - 10, yr - 20].map((v) => `<option value="${v}">${v}</option>`).join("");
  $("since").value = String(yr - 6);
  $("metric").innerHTML = Object.entries(METRICS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  readURL(); drawChips(); drawAccess();
  $("apikey").value = store.get("mr.key", "");
  $("apikey").addEventListener("change", () => store.set("mr.key", apiKey()));
  $("f").addEventListener("submit", search);
  $("n").addEventListener("change", () => { syncURL(); render(); });
  $("metric").addEventListener("change", () => { yMetric = $("metric").value; store.set("mr.y", yMetric); syncURL(); render(); });
  $("ylog").addEventListener("click", () => { yLog = true; store.set("mr.ylog", true); render(); });
  $("ylin").addEventListener("click", () => { yLog = false; store.set("mr.ylog", false); render(); });
  document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    sortDir = sortKey === k ? -sortDir : (["c3", "sjr", "if2", "h", "total", "q", "sq", "nkw"].includes(k) ? -1 : 1);
    sortKey = k; drawTable();
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
  await loadTables();
  search();
})();
