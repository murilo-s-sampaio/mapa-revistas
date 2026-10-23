/* Mapa de Revistas: downloaded data only (no live API).
   Journals and impact metrics from SCImago (Scopus); Qualis strata from the Plataforma Sucupira, joined by ISSN.
   A keyword "matches" a journal when it appears in the journal's title, in its Scopus subject categories or areas, or in
   an OpenAlex research topic (name or keywords) in which the journal has published (topics.json, OpenAlex snapshot).
   Each journal is one point: x = number of keywords that match it, y = the chosen impact metric. */
"use strict";

const STRATA = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "C"];
const DATA_VERSION = "2026-10-23f";      // bump when data/*.json change, so browsers fetch the new files
const METRICS = {
  c3: { label: "Citações por artigo, 3 anos (Scopus)", get: (j) => j.c3, d: 2 },
  c2: { label: "Citações por documento, 2 anos (Scopus)", get: (j) => j.c2, d: 2 },
  sjr: { label: "SJR (SCImago)", get: (j) => j.sjr, d: 3 },
};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 2) => (typeof v === "number" ? v.toFixed(d) : "—");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

let journals = [];                       // all SCImago journals, with Qualis attached
let cats = [];                           // Scopus subject categories, for the suggestion list
let shownQ = new Set(store.get("mr.q", [...STRATA, "none"]));
let shownA = new Set(store.get("mr.a2", ["open", "hybrid"]));
let yLog = store.get("mr.ylog", true);
let yMetric = METRICS[store.get("mr.y", "c3")] ? store.get("mr.y", "c3") : "c3";
let sortKey = "nkw", sortDir = -1;
let matched = [], K = 0, keywords = [];
let vocab = [];                          // indexed terms: [{term, kind, n}] from categories, areas, titles and topics
let topics = [], topicHay = [];          // OpenAlex topics [[name, [keywords]]] and their normalized search text
const ABBR = {                           // abbreviations OpenAlex does not index, mapped to the indexed term
  sfdi: "spatial frequency domain imaging", sfd: "spatial frequency domain imaging", dot: "diffuse optical tomography",
  drs: "diffuse reflectance spectroscopy", oct: "optical coherence tomography", pdt: "photodynamic therapy",
  pbm: "photobiomodulation", lllt: "low-level laser therapy", nirs: "near-infrared spectroscopy",
  fnirs: "functional near-infrared spectroscopy", dcs: "diffuse correlation spectroscopy", lsci: "laser speckle contrast imaging",
  pai: "photoacoustic imaging", pat: "photoacoustic tomography", flim: "fluorescence lifetime imaging", mc: "monte carlo",
  mcml: "monte carlo", hsi: "hyperspectral imaging", ai: "artificial intelligence", ml: "machine learning",
  cnn: "convolutional neural network", mri: "magnetic resonance imaging", ct: "computed tomography",
};
const STOP = new Set(("journal journals international research review reviews letters letter advances annals archives " +
  "bulletin proceedings transactions acta revista studies study series part section new current open society " +
  "and for the of in on de la et des der und del e y do da di a an to with from by at or its world global " +
  "frontiers reports report communications perspectives topics trends issues").split(" "));

function qColor(q) {
  if (q === "A1") return "var(--qa1)";
  if (q === "A2") return "var(--qa2)";
  if (q === "A3") return "var(--qa3)";
  if (q === "A4") return "var(--qa4)";
  if (q && q[0] === "B") return "var(--qb)";
  if (q === "C") return "var(--qc)";
  return null;
}

/* ---------- data ---------- */
async function loadData() {
  const get = async (f) => { const r = await fetch(`data/${f}?v=${DATA_VERSION}`); if (!r.ok) throw new Error(f); return r.json(); };
  const [sc, ql, tp] = await Promise.all([get("scimago.json"), get("qualis.json").catch(() => ({ areas: [], j: {}, meta: {} })),
    get("topics.json").catch(() => ({ topics: [], j: {} }))]);
  cats = sc.cats;
  topics = tp.topics;
  topicHay = topics.map(([name, kws]) => " " + norm([name, ...kws].join(" | ")));
  journals = sc.j.map((r) => {
    const [name, issn, sjr, sq, h, c2, c3, oa, diamond, pub, ci, ai] = r;
    let best = null;
    for (const i of issn) { const hit = ql.j[i]; if (hit && (!best || STRATA.indexOf(hit[0]) < STRATA.indexOf(best[0]))) best = hit; }
    const catNames = ci.map((i) => sc.cats[i]), areaNames = ai.map((i) => sc.areas[i]);
    let tl = [];
    for (const i of issn) if (tp.j[i] && tp.j[i].length > tl.length) tl = tp.j[i];
    return {
      name, issn, sjr, sq, h, c2, c3, open: oa === 1, diamond: diamond === 1, pub, cats: catNames, areas: areaNames, tl,
      q: best ? best[0] : "", parent: best ? (ql.areas[best[1]] || "") : "",
      hayTitle: norm(name), hayScope: norm(catNames.concat(areaNames).join(" | ")),
    };
  });
  buildVocab(sc);
  const notes = [`SCImago ${sc.meta.year}: ${journals.length.toLocaleString("pt-BR")} revistas.`];
  if (topics.length) notes.push(`OpenAlex: ${topics.length.toLocaleString("pt-BR")} temas de pesquisa.`);
  if (ql.meta?.event) notes.push(`Qualis ${ql.meta.event}, lista consultada em ${ql.meta.consulted}.`);
  $("qmeta").textContent = notes.join(" ");
  $("catlist").innerHTML = cats.slice().sort((a, b) => a.localeCompare(b)).map((c) =>
    `<button type="button" class="cat">${esc(c)}</button>`).join("");
  $("catlist").querySelectorAll(".cat").forEach((b) => b.addEventListener("click", () => addKeyword(b.textContent)));
}

/* ---------- indexed vocabulary and keyword search bar ---------- */
function buildVocab(sc) {
  const count = new Map();                // normalized term -> {term, kind, n}
  const bump = (term, kind) => {
    const k = norm(term);
    const e = count.get(k);
    if (e) e.n++; else count.set(k, { term, kind, n: 1 });
  };
  sc.j.forEach((r) => { for (const i of r[10]) bump(sc.cats[i], "categoria"); for (const i of r[11]) bump(sc.areas[i], "área"); });
  const titleTerms = new Map();
  for (const j of journals) {
    const words = j.name.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter(Boolean);
    const seen = new Set();
    for (let i = 0; i < words.length; i++) {
      const w = words[i], wl = norm(w);
      if (wl.length >= 4 && !STOP.has(wl) && !/^\d+$/.test(wl)) seen.add(w.toLowerCase());
      const w2 = words[i + 1];
      if (w2 && !STOP.has(wl) && !STOP.has(norm(w2)) && wl.length > 2 && norm(w2).length > 2) seen.add(`${w} ${w2}`.toLowerCase());
    }
    for (const t of seen) titleTerms.set(t, (titleTerms.get(t) || 0) + 1);
  }
  for (const [t, n] of titleTerms) {
    if (n < 2) continue;
    const k = norm(t), e = count.get(k);
    if (!e) count.set(k, { term: t, kind: "nome", n });
    else e.n = Math.max(e.n, n);
  }
  // topics and topic keywords: count the journals that publish in the topic (summed over topics for a keyword)
  const perTopic = new Array(topics.length).fill(0);
  for (const j of journals) for (const [ti] of j.tl) perTopic[ti]++;
  const kwCount = new Map();
  topics.forEach(([name, kws], ti) => {
    const k = norm(name), e = count.get(k);
    if (!e) count.set(k, { term: name, kind: "tema", n: perTopic[ti] }); else e.n = Math.max(e.n, perTopic[ti]);
    for (const w of kws) { const kk = norm(w); kwCount.set(kk, { term: w, n: (kwCount.get(kk)?.n || 0) + perTopic[ti] }); }
  });
  for (const [kk, v] of kwCount) if (!count.has(kk) && v.n) count.set(kk, { term: v.term, kind: "termo", n: v.n });
  // suggestion counts are approximate; the chip shows the exact number of journals that match
  vocab = [...count.values()].filter((v) => v.n > 0).sort((a, b) => b.n - a.n);
}
function suggestions(text) {
  const t = norm(text.trim());
  if (!t) return [];
  const chosen = new Set(keywords.map(norm));
  const hits = [];
  for (const v of vocab) {
    const k = norm(v.term);
    if (chosen.has(k)) continue;
    const at = k.indexOf(t);
    if (at < 0 || (at > 0 && /[a-z0-9]/.test(k[at - 1]))) continue;      // match at the start of a word only
    hits.push({ ...v, prefix: at === 0 });
  }
  hits.sort((a, b) => b.n - a.n || b.prefix - a.prefix);
  const full = ABBR[t];
  if (full && !chosen.has(norm(full))) {
    const v = vocab.find((x) => norm(x.term) === norm(full));
    hits.unshift({ term: full, kind: `sigla ${text.trim().toUpperCase()}`, n: v ? v.n : 0 });
  }
  return hits.slice(0, 12);
}
let sugg = [], suggAt = -1;
function drawSuggest() {
  const box = $("suggest"), text = $("kwInput").value;
  sugg = suggestions(text);
  if (!text.trim()) { box.hidden = true; return; }
  box.hidden = false;
  if (!sugg.length) {
    const full = ABBR[norm(text.trim())];
    box.innerHTML = full && keywords.map(norm).includes(norm(full))
      ? `<div class="sg empty">${esc(text.trim().toUpperCase())} = “${esc(full)}”, que já está escolhida.</div>`
      : `<div class="sg empty">“${esc(text)}” não aparece no nome, nas categorias nem nos temas de nenhuma revista. ` +
        "Tente outro termo, por extenso e em inglês.</div>";
    return;
  }
  box.innerHTML = sugg.map((v, i) => `<div class="sg${i === suggAt ? " on" : ""}" role="option" data-i="${i}">` +
    `<span>${esc(v.term)}</span><span class="kind">${v.kind}</span><span class="mono n">${v.n.toLocaleString("pt-BR")}</span></div>`).join("");
  box.querySelectorAll(".sg[data-i]").forEach((d) => d.addEventListener("mousedown", (e) => {
    e.preventDefault(); addKeyword(sugg[Number(d.dataset.i)].term);
  }));
}
function addKeyword(term) {
  const t = term.trim();
  if (t && !keywords.map(norm).includes(norm(t))) keywords.push(t);
  $("kwInput").value = ""; suggAt = -1; $("suggest").hidden = true;
  drawKeywords(); update();
}
function drawKeywords() {
  $("kwchips").innerHTML = keywords.map((k, i) => {
    const nk = norm(k), ts = topicsFor(nk);
    const n = journals.filter((j) => matchOne(j, nk, ts) >= 0).length;
    return `<span class="kwchip${n ? "" : " zero"}">${esc(k)} <span class="mono">${n}</span>` +
      `<button type="button" aria-label="Remover ${esc(k)}" data-i="${i}">×</button></span>`;
  }).join("");
  $("kwchips").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    keywords.splice(Number(b.dataset.i), 1); drawKeywords(); update();
  }));
}

/* ---------- matching and selection ---------- */
const topicCache = new Map();
function topicsFor(k) {                  // topics whose name or keywords contain the term at the start of a word
  if (!topicCache.has(k)) {
    const set = new Set(), needle = " " + k;
    topicHay.forEach((h, ti) => {
      let at = h.indexOf(k);
      while (at >= 0) { if (!/[a-z0-9]/.test(h[at - 1] || " ")) { set.add(ti); break; } at = h.indexOf(k, at + 1); }
    });
    topicCache.set(k, set);
  }
  return topicCache.get(k);
}
function matchOne(j, k, tset) {          // -> works in matched topics (>= 0) if the journal matches, else -1
  let works = 0, hit = false;
  for (const [ti, c] of j.tl) if (tset.has(ti)) { works += c; hit = true; }
  if (hit) return works;
  return j.hayTitle.includes(k) || j.hayScope.includes(k) ? 0 : -1;
}
function update() {
  keywords = keywords.slice(0, 15);
  K = keywords.length;
  const keys = keywords.map(norm), sets = keys.map(topicsFor);
  matched = [];
  for (const j of journals) {
    const hits = []; let works = 0;
    keys.forEach((k, i) => { const w = matchOne(j, k, sets[i]); if (w >= 0) { hits.push(keywords[i]); works += w; } });
    if (hits.length) matched.push(Object.assign(j, { kws: hits, nkw: hits.length, works }));
  }
  syncURL(); render();
}
function passes(j) { return shownQ.has(j.q || "none") && shownA.has(j.open ? "open" : "hybrid"); }
function visible() {
  const n = Math.max(1, Math.min(500, Math.round(Number($("n").value) || 40)));
  const m = METRICS[yMetric].get;
  return matched.filter(passes).sort((a, b) => b.nkw - a.nkw || b.works - a.works || (m(b) ?? -1) - (m(a) ?? -1)).slice(0, n);
}
function jitter(s) {                     // fixed small horizontal offset per journal, so points on the same x stay apart
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.4;
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
  const metric = METRICS[yMetric];
  const vis = visible(), pts = vis.filter((j) => metric.get(j) > 0);
  const miss = vis.length - pts.length;
  $("missing").textContent = miss ? `${miss} ${miss === 1 ? "revista sem esse dado ficou" : "revistas sem esse dado ficaram"} fora do gráfico (estão na tabela).` : "";
  const W = Math.max(320, host.clientWidth || 900), narrow = W < 560;
  const H = narrow ? 420 : 500, m = { l: 52, r: 14, t: 14, b: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Revistas por número de palavras-chave e ${metric.label}`);
  const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  if (!pts.length) {
    const why = !K ? "Escreva pelo menos uma palavra-chave."
      : !matched.length ? "Nenhuma revista tem essas palavras no título ou nas categorias. Tente termos de escopo em inglês (veja as categorias abaixo)."
      : !shownA.size ? "Os dois botões de acesso estão desligados. Ligue pelo menos um."
      : "Nenhuma revista com esses filtros. Marque mais estratos Qualis ou aumente o número de revistas.";
    el("text", { x: W / 2, y: H / 2, "text-anchor": "middle" }).textContent = why;
    host.insertBefore(svg, tip); return;
  }
  const vals = pts.map((p) => metric.get(p));
  let y, ticks;
  if (yLog) {
    const lo = Math.max(0.02, Math.min(...vals) / 1.4), hi = Math.max(...vals) * 1.4;
    ticks = logTicks(lo, hi);
    y = (v) => m.t + ih - (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * ih;
  } else {
    let hi = Math.max(...vals) * 1.1; ticks = linTicks(hi); hi = Math.max(hi, ticks[ticks.length - 1]);
    y = (v) => m.t + ih - (v / hi) * ih;
  }
  const xs = (v) => m.l + ((v - 0.5) / K) * iw;
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
    .textContent = "Número de palavras-chave que combinam com a revista";

  const labelled = new Set();
  for (let k = 1; k <= K; k++) pts.filter((p) => p.nkw === k).sort((a, b) => metric.get(b) - metric.get(a))
    .slice(0, narrow ? 1 : 3).forEach((p) => labelled.add(p.name));
  const placed = [];
  for (const p of [...pts].sort((a, b) => metric.get(a) - metric.get(b))) {
    const v = metric.get(p), cx = xs(p.nkw + jitter(p.name)), cy = y(v), col = qColor(p.q);
    el("circle", { cx, cy, r: 6, fill: col || "var(--surface)", stroke: col ? "var(--surface)" : "var(--muted)", "stroke-width": 1.8 });
    if (labelled.has(p.name)) {
      const text = p.name.length > 30 ? p.name.slice(0, 29) + "…" : p.name;
      const right = cx + 9 + text.length * 5.7 < m.l + iw + 12;
      const lx = right ? cx + 9 : cx - 9, ly = cy + 3.5;
      const box = { x: right ? lx : lx - text.length * 5.7, y: ly - 10, w: text.length * 5.7, h: 13 };
      const hit = placed.some((b) => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y));
      if (!hit) { el("text", { x: lx, y: ly, class: "lbl", "text-anchor": right ? "start" : "end" }).textContent = text; placed.push(box); }
    }
    const h = el("circle", { cx, cy, r: 12, fill: "transparent", tabindex: 0,
      "aria-label": `${p.name}, ${metric.label} ${fmt(v, metric.d)}, Qualis ${p.q || "sem estrato"}, ${p.nkw} de ${K} palavras-chave` });
    const show = () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(p.name)}</b>Qualis <span class="mono">${esc(p.q || "—")}</span>${p.parent ? ` (${esc(p.parent.toLowerCase())})` : ""}` +
        `${p.sq ? ` · quartil ${esc(p.sq)}` : ""}` +
        `<br>Cit./artigo 3 anos <span class="mono">${fmt(p.c3)}</span> · 2 anos <span class="mono">${fmt(p.c2)}</span>` +
        `<br>SJR <span class="mono">${fmt(p.sjr, 3)}</span> · h <span class="mono">${p.h ?? "—"}</span>` +
        `<br>Combina com ${p.nkw} de ${K}: ${p.kws.map(esc).join(", ")}` +
        (p.works ? `<br>Artigos nos temas dessas palavras: <span class="mono">${p.works.toLocaleString("pt-BR")}</span>` : "") +
        `<br><span class="muted">${esc(p.cats.join("; "))}</span>` +
        `<br>${esc(p.pub)} · ${p.open ? (p.diamond ? "acesso aberto sem taxa" : "acesso aberto") : "híbrida ou assinatura"}`;
      const r = host.getBoundingClientRect(), sx = r.width / W;
      let tx = cx * sx + 14; const ty = Math.max(0, cy * sx - 10);
      if (tx + 300 > r.width) tx = cx * sx - 314;
      tip.style.left = Math.max(0, tx) + "px"; tip.style.top = ty + "px";
    };
    h.addEventListener("mouseenter", show); h.addEventListener("focus", show);
    h.addEventListener("mouseleave", () => (tip.hidden = true)); h.addEventListener("blur", () => (tip.hidden = true));
    h.addEventListener("click", () => window.open(scimagoLink(p), "_blank", "noopener"));
  }
  host.insertBefore(svg, tip);
}
const scimagoLink = (p) => `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(p.issn[0] || p.name)}`;

/* ---------- table ---------- */
function drawTable() {
  const rows = [...visible()];
  const rank = { q: (r) => (r.q ? STRATA.indexOf(r.q) : 99), sq: (r) => (r.sq ? Number(r.sq.slice(1)) : 99) };
  const val = (r) => (rank[sortKey] ? rank[sortKey](r) : r[sortKey]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null || va === "") return 1; if (vb == null || vb === "") return -1;
    const d = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
    return d * (rank[sortKey] ? -sortDir : sortDir);
  });
  $("rows").innerHTML = rows.map((r) => {
    const col = qColor(r.q);
    const badge = r.q ? `<span class="qbadge" style="background:${col};color:${["A1", "A2"].includes(r.q) ? "var(--surface)" : "var(--ink)"}">${r.q}</span>` : "—";
    return `<tr><td><a href="${scimagoLink(r)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${badge}</td>
      <td>${esc(r.sq) || "—"}</td><td class="num">${fmt(r.c3)}</td><td class="num">${fmt(r.c2)}</td><td class="num">${fmt(r.sjr, 3)}</td>
      <td class="num">${r.h ?? "—"}</td><td class="num">${r.nkw}/${K}</td><td>${r.kws.map(esc).join(", ")}</td>
      <td class="num">${r.works ? r.works.toLocaleString("pt-BR") : "—"}</td>
      <td class="small">${esc(r.cats.join("; "))}</td><td>${esc((r.parent || "—").toLowerCase())}</td><td>${esc(r.pub) || "—"}</td>
      <td>${r.open ? (r.diamond ? "aberta, sem taxa" : "aberta") : "híbrida/assinatura"}</td></tr>`;
  }).join("");
  const total = matched.filter(passes).length;
  $("count").textContent = `${rows.length} de ${total.toLocaleString("pt-BR")} revistas que combinam`;
}

function render() {
  $("ylog").setAttribute("aria-pressed", String(yLog));
  $("ylin").setAttribute("aria-pressed", String(!yLog));
  $("metric").value = yMetric;
  drawChart(); drawTable();
}

/* ---------- controls ---------- */
function chip(attr, key, label, on, swatch) {
  return `<button type="button" class="qchip" ${attr}="${key}" aria-pressed="${on}">` +
    (swatch === undefined ? "" : `<i class="sw ${swatch ? "" : "none"}" style="${swatch ? `background:${swatch}` : ""}"></i>`) +
    `${label}</button>`;
}
function drawChips() {
  $("qchips").innerHTML = [...STRATA, "none"].map((q) =>
    chip("data-q", q, q === "none" ? "sem Qualis" : q, shownQ.has(q), qColor(q === "none" ? "" : q))).join("") +
    `<button type="button" class="qchip action" id="qA">só A1–A3</button><button type="button" class="qchip action" id="qAll">todos</button>`;
  $("qchips").querySelectorAll(".qchip[data-q]").forEach((b) => b.addEventListener("click", () => {
    const q = b.dataset.q; shownQ.has(q) ? shownQ.delete(q) : shownQ.add(q); afterFilter();
  }));
  $("qA").addEventListener("click", () => { shownQ = new Set(["A1", "A2", "A3"]); afterFilter(); });
  $("qAll").addEventListener("click", () => { shownQ = new Set([...STRATA, "none"]); afterFilter(); });
  $("achips").innerHTML = chip("data-a", "open", "Acesso aberto", shownA.has("open")) +
    chip("data-a", "hybrid", "Híbrida ou assinatura", shownA.has("hybrid"));
  $("achips").querySelectorAll(".qchip").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.a; shownA.has(k) ? shownA.delete(k) : shownA.add(k); afterFilter();
  }));
}
function afterFilter() { store.set("mr.q", [...shownQ]); store.set("mr.a2", [...shownA]); drawChips(); syncURL(); render(); }

function syncURL() {
  const p = new URLSearchParams({ q: keywords.join(","), n: $("n").value, qualis: [...shownQ].join(","),
    acesso: [...shownA].join(","), y: yMetric });
  history.replaceState(null, "", "?" + p.toString());
}
function readURL() {
  const p = new URLSearchParams(location.search);
  keywords = (p.get("q") || "spatial frequency domain imaging,monte carlo,tissue optical properties,skin pigmentation,photodynamic therapy,photobiomodulation")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (p.get("n")) $("n").value = p.get("n");
  if (p.get("qualis")) shownQ = new Set(p.get("qualis").split(",").filter((q) => STRATA.includes(q) || q === "none"));
  if (p.get("acesso")) shownA = new Set(p.get("acesso").split(",").filter((a) => a === "open" || a === "hybrid"));
  if (METRICS[p.get("y")]) yMetric = p.get("y");
  if (!shownA.size) shownA = new Set(["open", "hybrid"]);
}

(async function init() {
  $("metric").innerHTML = Object.entries(METRICS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  readURL(); drawChips();
  $("f").addEventListener("submit", (e) => e.preventDefault());
  const inp = $("kwInput");
  inp.addEventListener("input", () => { suggAt = -1; drawSuggest(); });
  inp.addEventListener("focus", drawSuggest);
  inp.addEventListener("blur", () => setTimeout(() => ($("suggest").hidden = true), 120));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!sugg.length) return;
      suggAt = (suggAt + (e.key === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length; drawSuggest();
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (suggAt >= 0 && sugg[suggAt]) addKeyword(sugg[suggAt].term);
      else if (sugg.length) addKeyword((sugg.find((v) => norm(v.term) === norm(inp.value.trim())) || sugg[0]).term);
    } else if (e.key === "Backspace" && !inp.value && keywords.length) {
      keywords.pop(); drawKeywords(); update();
    } else if (e.key === "Escape") { $("suggest").hidden = true; }
  });
  $("n").addEventListener("change", () => { syncURL(); render(); });
  $("metric").addEventListener("change", () => { yMetric = $("metric").value; store.set("mr.y", yMetric); syncURL(); render(); });
  $("ylog").addEventListener("click", () => { yLog = true; store.set("mr.ylog", true); render(); });
  $("ylin").addEventListener("click", () => { yLog = false; store.set("mr.ylog", false); render(); });
  document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    sortDir = sortKey === k ? -sortDir : (["c3", "c2", "sjr", "h", "q", "sq", "nkw", "works"].includes(k) ? -1 : 1);
    sortKey = k; drawTable();
  }));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawChart, 120); });
  $("status").textContent = "Carregando as tabelas…";
  try { await loadData(); $("status").textContent = ""; }
  catch { $("status").textContent = "Não foi possível carregar data/scimago.json."; $("status").classList.add("error"); return; }
  drawKeywords(); update();
})();
