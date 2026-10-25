#!/usr/bin/env python3
"""Exam formats from the TUM module handbook (Modulhandbuch / Module Catalog).

TUMonline publishes both PDFs without login. This module downloads them into data/mhb/ when
they are missing or a newer version is listed, extracts the text (PyMuPDF, fallback pypdf) and
returns per module code the paragraph "Beschreibung der Studien-/Prüfungsleistungen" (German
handbook) and "Description of Examination Method" (English catalog).

    python scripts/handbook.py            # download/refresh and print a summary
    python scripts/handbook.py MGTHN0094  # show the exam text of one module

The listing URL below is the MMDT program (TUM School of Management, Heilbronn). Other programs:
open TUMonline > Studies > Degree programs > your program > "Module handbook" and copy the URL
into HANDBOOK_URL or pass --url.
"""
import argparse
import html as html_mod
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HANDBOOK_URL = "https://campus.tum.de/tumonline/wbModhbReport.downloadPublicMHBVersion?pOrgNr=51900&pStpStpNr=5205"
MODULE_HEAD = re.compile(r"^([A-Z]{2,6}\d{4,6}[A-Z]?): (.+?) \| ")
FOOTER = re.compile(r"^(Modulhandbuch des Studiengangs|Module Catalog of the|Generiert am |Generated on |\d+ von \d+$|\d+ of \d+$)")
FIELDS = {
    "de": ("Beschreibung der Studien-/ Prüfungsleistungen:", "Wiederholungsmöglichkeit:"),
    "en": ("Description of Examination Method:", "Repeat Examination:"),
}


def log(msg):
    print(msg, file=sys.stderr)


# ------------------------------------------------------------------ download
def listed_documents(url):
    """[(pDocNr, filename)] of the handbook PDFs linked on the public TUMonline listing page."""
    with urllib.request.urlopen(url, timeout=60) as resp:
        page = resp.read().decode("utf-8", "replace")
    page = html_mod.unescape(page)
    docs = []
    for m in re.finditer(r'href="(wbModhbReport\.downloadPublicMHBVersion\?[^"]*pDocNr=(\d+))"[^>]*>(.*?)</a>', page, re.S):
        name = re.sub(r"<[^>]+>", "", m.group(3)).strip()
        if name.lower().endswith(".pdf"):
            docs.append((m.group(2), name))
    if not docs:   # layout without link text: pair the pDocNr links with the .pdf names in order
        nrs = re.findall(r"pDocNr=(\d+)", page)
        names = re.findall(r"[^\">]*\.pdf", page)
        docs = list(zip(nrs, names))
    return docs


def ensure_pdfs(mhb_dir, url=HANDBOOK_URL):
    """Download the handbook PDFs listed on the TUMonline page unless they are already cached. Returns [paths]."""
    os.makedirs(mhb_dir, exist_ok=True)
    try:
        docs = listed_documents(url)
    except Exception as e:  # offline: use what is cached
        log(f"Handbook listing not reachable ({e}); using cached PDFs")
        return sorted(os.path.join(mhb_dir, f) for f in os.listdir(mhb_dir) if f.lower().endswith(".pdf"))
    paths = []
    base = url.split("?")[0].rsplit("/", 1)[0] + "/"
    for nr, name in docs:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
        path = os.path.join(mhb_dir, safe)
        if not os.path.exists(path):
            log(f"Downloading {name}")
            link = f"{base}wbModhbReport.downloadPublicMHBVersion?{urllib.parse.urlencode({'pOrgNr': _param(url, 'pOrgNr'), 'pStpStpNr': _param(url, 'pStpStpNr'), 'pDocNr': nr})}"
            with urllib.request.urlopen(link, timeout=300) as resp, open(path, "wb") as fh:
                fh.write(resp.read())
        paths.append(path)
    return paths


def _param(url, key):
    return urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get(key, [""])[0]


# ------------------------------------------------------------------ text
def pdf_text(path):
    try:
        try:
            import pymupdf as fitz  # PyMuPDF >= 1.24
        except ImportError:
            import fitz  # older PyMuPDF
        with fitz.open(path) as doc:
            return "\n".join(page.get_text() for page in doc)
    except ImportError:
        pass
    try:
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    except ImportError:
        log("Neither PyMuPDF nor pypdf installed: pip install pymupdf  (handbook skipped)")
        return ""


def parse(text):
    """{'stand': 'DD.MM.YYYY', 'lang': 'de'|'en', 'modules': {code: {'title', 'exam', 'credits', 'offered'}}}"""
    stand_m = re.search(r"(?:Generiert am|Generated on) (\d{2}\.\d{2}\.\d{4})", text)
    lang = "de" if "Beschreibung der Studien-/" in text else "en"
    label, stop = FIELDS[lang]
    blocks, order = {}, []
    code = None
    for line in text.splitlines():
        line = line.rstrip()
        m = MODULE_HEAD.match(line)
        if m:
            code = m.group(1)
            if code not in blocks:
                blocks[code] = {"title": m.group(2).strip(), "lines": []}
                order.append(code)
            continue
        if code and line and not FOOTER.match(line):
            blocks[code]["lines"].append(line)
    modules = {}
    for code in order:
        lines = blocks[code]["lines"]
        exam = section(lines, label, stop)
        credits = section(lines, "Credits:*" if lang == "de" else "Credits:*", "Gesamtstunden:" if lang == "de" else "Total Hours:")
        offered = section(lines, "Häufigkeit:" if lang == "de" else "Frequency:", "Credits:*")
        modules[code] = {"title": blocks[code]["title"], "exam": exam, "credits": credits, "offered": offered}
    return {"stand": stand_m.group(1) if stand_m else "", "lang": lang, "modules": modules}


def section(lines, label, stop):
    """Text between a label line and the next stop label, joined into one paragraph."""
    out, on = [], False
    for line in lines:
        if line.startswith(label):
            on = True
            rest = line[len(label):].strip()
            if rest:
                out.append(rest)
            continue
        if on and line.startswith(stop):
            break
        if on and re.match(r"^[A-ZÄÖÜ(][^:]{2,60}:$", line) and line != label:   # another field label: stop
            break
        if on:
            out.append(line.strip())
    return re.sub(r"\s+", " ", " ".join(out)).strip()


# ------------------------------------------------------------------ public
def load(mhb_dir=None, url=HANDBOOK_URL, download=True):
    """{'stand': ..., 'exams': {code: {'de': ..., 'en': ...}}, 'modules': {code: {...}}}  (empty when no PDF is available)."""
    mhb_dir = mhb_dir or os.path.join(ROOT, "data", "mhb")
    if not mhb_dir.endswith("mhb") and os.path.basename(mhb_dir) == "processed":
        mhb_dir = os.path.dirname(mhb_dir)
    paths = ensure_pdfs(mhb_dir, url) if download else sorted(
        os.path.join(mhb_dir, f) for f in os.listdir(mhb_dir) if f.lower().endswith(".pdf"))
    cache = os.path.join(mhb_dir, "handbook.json")
    sig = sorted([os.path.basename(p), os.path.getsize(p)] for p in paths)   # lists, like json.load returns them
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            cached = json.load(fh)
        if cached.get("sig") == sig:
            return cached
    result = {"sig": sig, "stand": "", "exams": {}, "modules": {}}
    for path in paths:
        text = pdf_text(path)
        if not text:
            continue
        parsed = parse(text)
        result["stand"] = result["stand"] or parsed["stand"]
        for code, m in parsed["modules"].items():
            result["modules"].setdefault(code, {}).update({k: v for k, v in m.items() if k != "exam"})
            if m["exam"]:
                result["exams"].setdefault(code, {})[parsed["lang"]] = m["exam"]
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=1, ensure_ascii=False)
    return result


def main():
    p = argparse.ArgumentParser(description="Exam formats from the TUM module handbook")
    p.add_argument("code", nargs="?", help="module code to show")
    p.add_argument("--url", default=HANDBOOK_URL, help="TUMonline handbook listing URL of your program")
    p.add_argument("--dir", default=os.path.join(ROOT, "data", "mhb"))
    a = p.parse_args()
    hb = load(a.dir, a.url)
    if a.code:
        e = hb["exams"].get(a.code.upper())
        print(json.dumps({"module": hb["modules"].get(a.code.upper()), "exam": e}, indent=2, ensure_ascii=False))
        return
    print(f"Handbook as of {hb['stand'] or '?'}: {len(hb['modules'])} modules, {len(hb['exams'])} with exam description")
    no_exam = [c for c in hb["modules"] if c not in hb["exams"]]
    if no_exam:
        print("Without exam description:", ", ".join(no_exam))


if __name__ == "__main__":
    main()
