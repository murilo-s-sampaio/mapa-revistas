"""Compact SCImago Journal Rank table for the page:
{ISSN: [SJR, best quartile, h-index, cites/doc 2y, cites/citable doc 3y, open access 0/1, diamond open access 0/1]}.

Input: the CSV exported by scimagojr.com (journalrank.php?out=xls; semicolon-separated, decimal commas). The 3-year
ratio is Total Citations (3years) / Citable Docs. (3years): citations received in the ranking year by the articles,
reviews and conference papers of the three previous years, per such document.

    venv/bin/python qualis/build_scimago_json.py qualis/scimago.csv qualis/site/data/scimago.json
"""
import csv
import json
import re
import sys
from pathlib import Path


def num(s):
    s = (s or "").strip().replace(".", "").replace(",", ".") if re.search(r",\d", s or "") else (s or "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    rows = list(csv.reader(open(src, encoding="utf-8-sig"), delimiter=";"))
    head = rows[0]
    ix = {h: i for i, h in enumerate(head)}
    docs_col = next(h for h in head if h.startswith("Total Docs. (") and "3years" not in h)
    year = re.search(r"\((\d{4})\)", docs_col).group(1)
    out = {}
    for r in rows[1:]:
        if len(r) < len(head) or r[ix["Type"]] != "journal":
            continue
        sjr = num(r[ix["SJR"]])
        cit3, cdoc3 = num(r[ix["Total Citations (3years)"]]), num(r[ix["Citable Docs. (3years)"]])
        rec = [sjr, r[ix["SJR Best Quartile"]].strip() if r[ix["SJR Best Quartile"]].strip() != "-" else "",
               int(num(r[ix["H index"]]) or 0), num(r[ix["Citations / Doc. (2years)"]]),
               round(cit3 / cdoc3, 2) if cit3 and cdoc3 else None,
               int(r[ix["Open Access"]].strip() == "Yes"), int(r[ix["Open Access Diamond"]].strip() == "Yes")]
        for raw in r[ix["Issn"]].split(","):
            raw = raw.strip().upper()
            if re.fullmatch(r"\d{7}[\dX]", raw):
                out[f"{raw[:4]}-{raw[4:]}"] = rec
    meta = {"source": "SCImago Journal & Country Rank (Scopus)", "year": year}
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps({"meta": meta, "j": out}, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows) - 1} rows -> {len(out)} ISSNs, year {year}; {Path(dst).stat().st_size / 1e6:.2f} MB")
    for k in ("0022-202X", "2041-1723", "1083-3668"):
        print(k, out.get(k))


if __name__ == "__main__":
    main()
