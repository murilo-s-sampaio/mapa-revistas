"""Topic index for the page from the OpenAlex snapshot (get_openalex_topics.py), limited to the journals in scimago.json.

Output data/topics.json:
  topics  [[name, [keyword...]], ...]           keywords = OpenAlex keywords + legacy keywords, lower case, unique
  j       {ISSN: [[topic index, works], ...]}   each journal's topics (OpenAlex lists up to 25) with >= 3 works,
                                                one ISSN per journal of scimago.json

    python tools/build_topics_json.py openalex/ data/scimago.json data/topics.json
"""
import glob
import gzip
import json
import sys
from pathlib import Path


def main():
    src, scimago, dst = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    sc = json.load(open(scimago, encoding="utf-8"))
    wanted = {i for row in sc["j"] for i in row[1]}
    topics, tix = [], {}
    for f in sorted(glob.glob(str(src / "topics" / "*.gz"))):
        for line in gzip.open(f, "rt", encoding="utf-8"):
            d = json.loads(line)
            kws = [k["display_name"].strip().lower() for k in d.get("keywords") or []]
            kws += [k.strip().lower() for k in (d.get("legacy_keywords") or "").split(";")]
            kws = list(dict.fromkeys(k for k in kws if k))
            tix[d["id"]] = len(topics)
            topics.append([d["display_name"], kws])
    out, journals = {}, 0
    for f in sorted(glob.glob(str(src / "sources" / "*.gz"))):
        for line in gzip.open(f, "rt", encoding="utf-8"):
            d = json.loads(line)
            if d.get("type") != "journal" or not d.get("topics"):
                continue
            issns = [i.upper() for i in (d.get("issn") or []) if i] + ([d["issn_l"].upper()] if d.get("issn_l") else [])
            hit = [i for i in dict.fromkeys(issns) if i in wanted]
            if not hit:
                continue
            tl = [[tix[t["id"]], int(t["count"])] for t in d["topics"] if t["id"] in tix and t.get("count", 0) >= 3]
            if not tl:
                continue
            journals += 1
            for i in hit:
                if i not in out or sum(c for _, c in tl) > sum(c for _, c in out[i]):
                    out[i] = tl
    # one key per SCImago journal (the page looks a journal up by any of its ISSNs)
    slim = {}
    for row in sc["j"]:
        best = max((i for i in row[1] if i in out), key=lambda i: sum(c for _, c in out[i]), default=None)
        if best:
            slim[best] = out[best]
    out = slim
    meta = {"source": "OpenAlex snapshot", "topics": len(topics), "journals": journals}
    Path(dst).write_text(json.dumps({"meta": meta, "topics": topics, "j": out}, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")
    print(f"{len(topics)} topics, {journals} journals ({len(out)} ISSNs); {Path(dst).stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
