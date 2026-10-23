/* Mapa de Revistas: keywords -> journals (OpenAlex, live) -> impact (OpenAlex 2-year mean citedness) and Qualis (Sucupira).
   Each journal is one point: x = how many of the keywords it publishes on, y = impact. */
"use strict";

const OA = "https://api.openalex.org";
const STRATA = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
const GROUPS_PER_KEYWORD = 200;          // journals read per keyword (OpenAlex's largest group page)
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

let qualis = null;                       // {areas: [...], j: {ISSN: [stratum, areaIndex]}, meta}
let result = null;                       // {since, keywords: [{keyword, total}], journals: [...]}
let shownQ = new Set(store.get("mr.q", [...STRATA, "none"]));
let yLog = store.get("mr.ylog", true);
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
    const hit = raw && qualis.j[String(raw).toUpperCase()];
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
  const cache = store.get("mr.cache2", {});
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
        const ql = qualisOf([s.issn_l, ...(s.issn || [])]);
        by.set(g.key, {
          id: g.key, name: s.display_name || g.key_display_name, kws: [], total: 0,
          if2: typeof s.summary_stats?.["2yr_mean_citedness"] === "number" ? s.summary_stats["2yr_mean_citedness"] : null,
          h: s.summary_stats?.h_index ?? null, pub: s.host_organization_name || "", oa: !!s.is_oa,
          url: /^https?:\/\//.test(s.homepage_url || "") ? s.homepage_url : g.key, q: ql.q, parent: ql.parent,
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
    store.set("mr.cache2", cache);
    render();
    setStatus(`${journals.length} revistas publicaram sobre pelo menos uma das ${kws.length} palavras-chave desde ${since}.`);
  } catch (e) {
    if (e.name === "AbortError") return;
    setStatus(e.code === "rate" ? "A OpenAlex limitou as consultas por agora. Tente de novo em alguns minutos."
      : "Não foi possível consultar a OpenAlex. Verifique a conexão e tente de novo.", true);
  } finally { $("go").disabled = false; }
}

/* ---------- selection ---------- */
function visible() {
  const n = Math.max(1, Math.min(300, Math.round(Number($("n").value) || 30)));
  return result.journals.filter((j) => shownQ.has(j.q || "none"))
    .sort((a, b) => b.nkw - a.nkw || b.total - a.total).slice(0, n);
}

/* ---------- chart ---------- */
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
  const K = result.keywords.length;
  const pts = visible().filter((j) => j.if2 > 0);
  const W = Math.max(320, host.clientWidth || 900), narrow = W < 560;
  const H = narrow ? 420 : 500, m = { l: 52, r: 14, t: 14, b: 62 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Revistas por número de palavras-chave e impacto em dois anos");
  const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  if (!pts.length) {
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" })
      .textContent = "Nenhuma revista com esses filtros. Marque mais estratos Qualis ou aumente o número de revistas.";
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
  // one band per number of keywords matched (1..K); inside a band, more articles on the topics -> further right
  const bw = iw / K, pad = Math.min(26, bw * 0.12);
  const maxTot = Math.max(1, ...pts.map((p) => p.total));
  const x = (p) => m.l + (p.nkw - 1) * bw + pad + (Math.log(1 + p.total) / Math.log(1 + maxTot)) * (bw - 2 * pad);
  for (const t of ticks) {
    const yy = y(t);
    el("line", { x1: m.l, x2: m.l + iw, y1: yy, y2: yy, stroke: "var(--grid)" });
    el("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end", class: "tick" }).textContent = t >= 1 ? String(t) : t.toFixed(1);
  }
  el("text", { x: 12, y: m.t + ih / 2, transform: `rotate(-90 12 ${m.t + ih / 2})`, "text-anchor": "middle" })
    .textContent = "Impacto em 2 anos (OpenAlex)" + (yLog ? ", escala log" : "");
  el("line", { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: "var(--axis)" });
  for (let k = 1; k <= K; k++) {
    const x0 = m.l + (k - 1) * bw, inBand = pts.filter((p) => p.nkw === k).length;
    if (k > 1) el("line", { x1: x0, x2: x0, y1: m.t, y2: m.t + ih, stroke: "var(--grid)", "stroke-dasharray": "2 4" });
    el("text", { x: x0 + bw / 2, y: m.t + ih + 18, "text-anchor": "middle", class: "kw" }).textContent = String(k);
    el("text", { x: x0 + bw / 2, y: m.t + ih + 32, "text-anchor": "middle" })
      .textContent = `${inBand} ${inBand === 1 ? "revista" : "revistas"}`;
  }
  el("text", { x: m.l + iw / 2, y: m.t + ih + 52, "text-anchor": "middle" })
    .textContent = `Palavras-chave em que a revista publica (de ${K})`;

  const labelled = new Set();
  for (let k = 1; k <= K; k++) pts.filter((p) => p.nkw === k).sort((a, b) => b.if2 - a.if2)
    .slice(0, narrow ? 1 : 3).forEach((p) => labelled.add(p.id));
  const placed = [];
  for (const p of [...pts].sort((a, b) => a.if2 - b.if2)) {
    const cx = x(p), cy = y(p.if2), col = qColor(p.q);
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
      "aria-label": `${p.name}, impacto ${p.if2.toFixed(1)}, Qualis ${p.q || "sem estrato"}, ${p.nkw} de ${K} palavras-chave` });
    const show = () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(p.name)}</b>Qualis <span class="mono">${esc(p.q || "—")}</span>${p.parent ? ` (${esc(p.parent.toLowerCase())})` : ""}` +
        `<br>Impacto 2 anos <span class="mono">${p.if2.toFixed(2)}</span>${p.h != null ? ` · h <span class="mono">${p.h}</span>` : ""}` +
        `<br>Publica sobre ${p.nkw} de ${K} palavras-chave (artigos desde ${esc(result.since)}):` +
        p.kws.map((k) => `<br>· ${esc(k.kw)} <span class="mono">${k.n}</span>`).join("") +
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
  const K = result.keywords.length;
  const rows = [...visible()];
  const val = (r) => sortKey === "q" ? (r.q ? STRATA.indexOf(r.q) : 99) : r[sortKey];
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || va === "") return 1; if (vb == null || vb === "") return -1;
    const d = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
    return (d || b.total - a.total) * (sortKey === "q" ? -sortDir : sortDir);
  });
  $("rows").innerHTML = rows.map((r) => {
    const col = qColor(r.q);
    const badge = r.q ? `<span class="qbadge" style="background:${col};color:${["A1", "A2"].includes(r.q) ? "var(--surface)" : "var(--ink)"}">${r.q}</span>` : "—";
    return `<tr><td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${badge}</td>
      <td class="num">${r.if2 != null ? r.if2.toFixed(2) : "—"}</td><td class="num">${r.h ?? "—"}</td>
      <td class="num">${r.nkw}/${K}</td>
      <td>${r.kws.map((k) => `<span class="kwtag">${esc(k.kw)} <span class="mono">${k.n}</span></span>`).join("")}</td>
      <td>${esc((r.parent || "—").toLowerCase())}</td><td>${esc(r.pub) || "—"}</td><td>${r.oa ? "aberto" : "—"}</td></tr>`;
  }).join("");
  $("count").textContent = `${rows.length} de ${result.journals.filter((j) => shownQ.has(j.q || "none")).length} revistas`;
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
  }).join("") + `<button type="button" class="qchip" id="qA" aria-pressed="false">só A1–A3</button>` +
    `<button type="button" class="qchip" id="qAll" aria-pressed="false">todos</button>`;
  $("qchips").querySelectorAll(".qchip[data-q]").forEach((b) => b.addEventListener("click", () => {
    const q = b.dataset.q; shownQ.has(q) ? shownQ.delete(q) : shownQ.add(q); afterFilter();
  }));
  $("qA").addEventListener("click", () => { shownQ = new Set(["A1", "A2", "A3"]); afterFilter(); });
  $("qAll").addEventListener("click", () => { shownQ = new Set([...STRATA, "none"]); afterFilter(); });
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
    const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (["if2", "h", "total", "q", "nkw"].includes(k) ? -1 : 1); sortKey = k; drawTable();
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
  await loadQualis();
  search();
})();
