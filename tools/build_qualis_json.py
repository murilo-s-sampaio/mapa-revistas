"""Build the page's Qualis table from the Sucupira downloads (scrape_qualis.py).

Each journal is listed once per evaluation area in Sucupira, always with the same stratum (assigned by its parent area);
this keeps one entry per ISSN: {ISSN: [stratum, parent-area index]}. If an ISSN were listed with different strata, the
higher one is kept and the conflict is counted.

    venv/bin/python qualis/build_qualis_json.py --raw qualis/raw --event 237 --label 2021-2024 --out site/data/qualis.json
"""
import argparse
import csv
import datetime as dt
import json
from pathlib import Path

ORDER = ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "B5", "C"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="qualis/raw")
    ap.add_argument("--event", default="237")
    ap.add_argument("--label", default="2021-2024")
    ap.add_argument("--out", default="qualis/qualis.json")
    args = ap.parse_args()
    areas, area_ix, j, conflicts, rows = [], {}, {}, 0, 0
    for path in sorted(Path(args.raw).glob(f"qualis_{args.event}_*.csv")):
        for r in csv.DictReader(open(path, encoding="utf-8")):
            rows += 1
            issn, q, parent = r["issn"].strip().upper(), r["stratum"].strip(), r["parent_area"].strip()
            if q not in ORDER:
                continue
            if parent not in area_ix:
                area_ix[parent] = len(areas)
                areas.append(parent)
            if issn in j and j[issn][0] != q:
                conflicts += 1
                if ORDER.index(q) > ORDER.index(j[issn][0]):
                    continue
            j[issn] = [q, area_ix[parent]]
    counts = {q: sum(1 for v in j.values() if v[0] == q) for q in ORDER}
    meta = {"event": args.label, "consulted": dt.date.today().strftime("%d/%m/%Y"), "source": "Plataforma Sucupira (CAPES)",
            "journals": len(j), "per_stratum": counts}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"meta": meta, "areas": areas, "j": j}, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")
    print(f"{rows} rows -> {len(j)} ISSNs, {len(areas)} parent areas, {conflicts} conflicting strata; {counts}; "
          f"{out.stat().st_size / 1e6:.2f} MB -> {out}")


if __name__ == "__main__":
    main()
