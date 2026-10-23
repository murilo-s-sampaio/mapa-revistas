"""Journal table for the page from the SCImago Journal Rank export (scimagojr.com, journalrank.php?out=xls).

Output (compact JSON):
  meta   {source, year}
  cats   subject category names; areas: subject area names
  j      one row per journal: [title, [ISSN...], SJR, best quartile, h-index, cites/doc 2y, cites/citable doc 3y,
         open access 0/1, diamond open access 0/1, publisher, [category index...], [area index...]]
The 3-year ratio is Total Citations (3years) / Citable Docs. (3years): citations received in the ranking year by the
articles, reviews and conference papers of the three previous years, per such document.

    python tools/build_scimago_json.py scimago.csv data/scimago.json
"""
import csv
import json
import re
import sys
from pathlib import Path


def num(s):
    s = (s or "").strip()
    if re.search(r",\d", s):
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    rows = list(csv.reader(open(src, encoding="utf-8-sig"), delimiter=";"))
    head = rows[0]
    ix = {}
    for i, h in enumerate(head):
        ix.setdefault(h, i)                                      # "Publisher" appears twice; keep the first
    docs_col = next(h for h in head if h.startswith("Total Docs. (") and "3years" not in h)
    year = re.search(r"\((\d{4})\)", docs_col).group(1)
    cats, cat_ix, areas, area_ix, out = [], {}, [], {}, []
    for r in rows[1:]:
        if len(r) < len(head) or r[ix["Type"]] != "journal":
            continue
        issns = []
        for raw in r[ix["Issn"]].split(","):
            raw = raw.strip().upper()
            if re.fullmatch(r"\d{7}[\dX]", raw):
                issns.append(f"{raw[:4]}-{raw[4:]}")
        cit3, cdoc3 = num(r[ix["Total Citations (3years)"]]), num(r[ix["Citable Docs. (3years)"]])
        ci = []
        for c in r[ix["Categories"]].split(";"):
            name = re.sub(r"\s*\(Q\d\)\s*$", "", c).strip()
            if name:
                if name not in cat_ix:
                    cat_ix[name] = len(cats)
                    cats.append(name)
                ci.append(cat_ix[name])
        ai = []
        for a in r[ix["Areas"]].split(";"):
            name = a.strip()
            if name:
                if name not in area_ix:
                    area_ix[name] = len(areas)
                    areas.append(name)
                ai.append(area_ix[name])
        q = r[ix["SJR Best Quartile"]].strip()
        out.append([r[ix["Title"]].strip(), issns, num(r[ix["SJR"]]), q if q != "-" else "", int(num(r[ix["H index"]]) or 0),
                    num(r[ix["Citations / Doc. (2years)"]]), round(cit3 / cdoc3, 2) if cit3 and cdoc3 else None,
                    int(r[ix["Open Access"]].strip() == "Yes"), int(r[ix["Open Access Diamond"]].strip() == "Yes"),
                    r[ix["Publisher"]].strip(), ci, ai])
    meta = {"source": "SCImago Journal & Country Rank (Scopus)", "year": year}
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps({"meta": meta, "cats": cats, "areas": areas, "j": out}, ensure_ascii=False,
                                    separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} journals, {len(cats)} categories, {len(areas)} areas, year {year}; "
          f"{Path(dst).stat().st_size / 1e6:.2f} MB")
    for row in out:
        if row[0] in ("Journal of Biomedical Optics", "Journal of Investigative Dermatology"):
            print(row[0], row[1:9], [cats[i] for i in row[10]])


if __name__ == "__main__":
    main()
