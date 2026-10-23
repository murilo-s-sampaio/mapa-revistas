"""Download the Qualis classification of journals from the public Sucupira query (headless Chrome).

For each stratum (A1-A4, B1-B4, C) the query is run for the chosen classification event and every result page is read
(50 rows per page: ISSN, title, area with publications in the period, stratum, parent area). Rows are appended to
<out>/qualis_<event>_<stratum>.csv as they are read; a stratum whose file is complete (its row count equals the total the
query reports) is skipped on a rerun. A pause between pages keeps the load on the server low.

    venv/bin/python qualis/scrape_qualis.py --event 237 --out qualis/raw        # 237 = quadrennium 2021-2024

Afterwards build the page data with qualis/build_qualis_json.py.
"""
import argparse
import csv
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PAGE = ("https://sucupira.capes.gov.br/sucupira/public/consultas/coleta/veiculoPublicacaoQualis/"
        "listaConsultaGeralPeriodicos.jsf")
STRATA = {"A1": "21", "A2": "22", "A3": "111", "A4": "112", "B1": "23", "B2": "24", "B3": "25", "B4": "26", "B5": "27",
          "C": "28"}


def counter(pg):
    try:
        text = pg.inner_text("body")
    except Exception:
        return None
    m = re.search(r"(\d+)\s*a\s*(\d+)\s*de\s*(\d+)\s*registro", text)
    return tuple(int(x) for x in m.groups()) if m else None


def rows(pg):
    out = []
    for tr in pg.query_selector_all("table tbody tr"):
        td = [c.inner_text().strip() for c in tr.query_selector_all("td")]
        if len(td) == 5 and re.match(r"^\w{4}-\w{4}$", td[0]):
            out.append(td)
    return out


def run_stratum(browser, event, name, value, path, pause):
    if path.exists():
        done = sum(1 for _ in open(path, encoding="utf-8")) - 1
    else:
        done = -1
    pg = browser.new_page()
    pg.goto(PAGE, timeout=120000)
    try:
        pg.get_by_text("ACEITO", exact=True).first.click(timeout=5000)
    except Exception:
        pass
    pg.select_option("#form\\:evento", event)
    pg.wait_for_timeout(2500)
    pg.check("#form\\:checkEstrato")
    pg.select_option("#form\\:estrato", value)
    pg.click("#form\\:consultar")
    pg.wait_for_load_state("load", timeout=120000)
    pg.wait_for_function("() => document.body && /registro\\(s\\)/.test(document.body.innerText)", timeout=120000)
    first, last, total = counter(pg)
    if done == total:
        print(f"{name}: complete ({total}), skipped", flush=True)
        pg.close()
        return
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["issn", "title", "area", "stratum", "parent_area"])
        n, t0 = 0, time.time()
        while True:
            for r in rows(pg):
                w.writerow(r)
                n += 1
            fh.flush()
            if last >= total:
                break
            prev = last
            pg.click("#form\\:j_idt74\\:botaoProxPagina")
            for _ in range(240):
                pg.wait_for_timeout(250)
                c = counter(pg)
                if c and c[1] != prev:
                    break
            first, last, total = c
            if (last // 50) % 40 == 0:
                print(f"{name}: {last}/{total} ({(time.time() - t0) / 60:.1f} min)", flush=True)
            time.sleep(pause)
    print(f"{name}: wrote {n} rows of {total}", flush=True)
    pg.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", default="237")
    ap.add_argument("--out", default="qualis/raw")
    ap.add_argument("--strata", nargs="*", default=list(STRATA))
    ap.add_argument("--pause", type=float, default=1.0)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
        for name in args.strata:
            for attempt in range(3):
                try:
                    run_stratum(browser, args.event, name, STRATA[name], out / f"qualis_{args.event}_{name}.csv",
                                args.pause)
                    break
                except Exception as e:
                    print(f"{name}: attempt {attempt + 1} failed: {type(e).__name__}: {str(e)[:160]}", flush=True)
                    time.sleep(30)
        browser.close()


if __name__ == "__main__":
    main()
