"""Download the OpenAlex snapshot files for sources and topics (public S3 bucket, no key, no API quota).

    python tools/get_openalex_topics.py openalex/         # ~370 MB of .gz files, resumable
"""
import json
import sys
import urllib.request
from pathlib import Path

BASE = "https://openalex.s3.amazonaws.com/"


def fetch(url, path):
    if path.exists() and path.stat().st_size > 0:
        return
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as fh:
        while chunk := r.read(1 << 20):
            fh.write(chunk)
    tmp.rename(path)


def main():
    out = Path(sys.argv[1])
    for entity in ("topics", "sources"):
        d = out / entity
        d.mkdir(parents=True, exist_ok=True)
        man = json.loads(urllib.request.urlopen(f"{BASE}data/jsonl/{entity}/manifest.json", timeout=120).read())
        files = man["files"]
        for i, f in enumerate(files):
            key = f["url"].replace("s3://openalex/", "")
            name = key.split("/")[-2].replace("updated_date=", "") + "_" + key.split("/")[-1]
            fetch(BASE + key, d / name)
            if i % 20 == 0:
                print(f"{entity}: {i + 1}/{len(files)}", flush=True)
        print(f"{entity}: {len(files)} files, {man['record_count']} records", flush=True)


if __name__ == "__main__":
    main()
