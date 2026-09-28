"""
Convert the "ALL DV PROCEDURE_EXPECTATIONS" workbook into clean seed JSON.

Usage:
    python3 scripts/import_dvp_sheet.py "<path to .xlsx>"

Writes backend/seed/dvp-catalog.json and the reference images to
backend/public/dvp-images/ (converted to WebP). Re-run whenever the master sheet
changes, then run `npm run seed` in backend/ to load it into MongoDB.

The sheet's status columns are free text with typos and mixed casing
("NOT" vs "NOT DONE", "CABABILITY", "PERFOMERD"...). Everything is mapped
onto a small fixed vocabulary here so the portal can filter reliably.
"""
import json, re, sys, os, io, shutil, zipfile, posixpath
from openpyxl import load_workbook
from PIL import Image

# Sheet1 column positions (0-based), verified against the header row
C = dict(owner=1, number=2, component=4 - 1, parameter=4, procAvail=5, completed=6,
         vrCap=7, result=8, reason=9, remarks=10, zone=11, area=12, fullName=14,
         cas=15, requirement=16, criteria=17, procedure=18)

ZONE_NAMES = {"IP": "Instrument panel", "CONSOLE": "Console", "SIDE DOOR": "Side door",
              "SEATS": "Seats", "ROOF & PILLARS": "Roof & pillars", "CARGO": "Cargo",
              "EXTERIOR": "Exterior", "REFLECTION": "Reflection & glare",
              "3RD ROW": "3rd row", "NRS": "NRS"}

REASONS = {"INSUFFICIENT DATA": "Insufficient data", "INSUFFICIENT DVP INFO": "Insufficient DVP info",
           "PERFOMERD": "Performed", "PERFORMED": "Performed", "TO BE PERFORMED": "To be performed",
           "NO CAPABILITY": "No VR capability", "NO CABABILITY": "No VR capability"}


# "Reference Images" columns are T-X, but one row overflows into Y and Z,
# so every picture from column T onward counts
IMAGE_COLS = ["T", "U", "V", "W", "X", "Y", "Z"]
IMAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "public", "dvp-images")

def extract_cell_images(path):
    """
    Return {sheet1 row number: [image bytes, ...]} for Excel "place in cell"
    pictures in the Reference Images columns. openpyxl can't read these (they
    show as #VALUE!), so the chain is followed in the raw XML:
    cell vm="N" -> metadata valueMetadata[N-1] -> futureMetadata rvb i
    -> richData rv -> richValueRel rel -> xl/media/imageX.png
    """
    z = zipfile.ZipFile(path)
    read = lambda n: z.read(n).decode("utf-8")
    meta = read("xl/metadata.xml")
    future = re.findall(r'<xlrd:rvb i="(\d+)"/>', meta[:meta.find("<valueMetadata")])
    value_meta = re.findall(r'<rc t="\d+" v="(\d+)"/>', meta[meta.find("<valueMetadata"):])
    rich_values = [re.findall(r"<v>([^<]*)</v>", rv)[0]
                   for rv in re.findall(r"<rv [^>]*>(.*?)</rv>", read("xl/richData/rdrichvalue.xml"), re.S)]
    rel_ids = re.findall(r'<rel r:id="([^"]+)"/>', read("xl/richData/richValueRel.xml"))
    targets = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', read("xl/richData/_rels/richValueRel.xml.rels")))

    by_row = {}
    for ref, vm in re.findall(r'<c r="([A-Z]+\d+)"[^>]*?vm="(\d+)"', read("xl/worksheets/sheet1.xml")):
        col, row = re.match(r"([A-Z]+)(\d+)", ref).groups()
        if col not in IMAGE_COLS: continue
        rv_index = int(future[int(value_meta[int(vm) - 1])])
        rel = rel_ids[int(rich_values[rv_index])]
        media = posixpath.normpath(posixpath.join("xl/richData", targets[rel]))
        by_row.setdefault(int(row), []).append((IMAGE_COLS.index(col), media))
    return {row: [z.read(m) for _, m in sorted(items)] for row, items in by_row.items()}

def save_images(code, blobs):
    """Write a DVP's images as WebP; returns the file names in column order."""
    names, seen = [], set()
    for blob in blobs:
        if blob in seen: continue                  # same picture pasted twice in one row
        seen.add(blob)
        name = f"{code}-{len(names) + 1}.webp"
        Image.open(io.BytesIO(blob)).save(os.path.join(IMAGE_DIR, name), "WEBP", quality=85, method=6)
        names.append(name)
    return names

def text(v):
    if v is None: return ""
    s = str(v).replace("\r", "").strip()
    return re.sub(r"\n{3,}", "\n\n", s)

def key(v): return re.sub(r"\s+", " ", text(v)).upper()

def main(path):
    wb = load_workbook(path, read_only=True)
    numbered = [(i, r) for i, r in enumerate(wb["Sheet1"].iter_rows(values_only=True), start=1)
                if any(c not in (None, "") for c in r)]
    header, data = numbered[0][1], numbered[1:]
    images_by_row = extract_cell_images(path)
    shutil.rmtree(IMAGE_DIR, ignore_errors=True)
    os.makedirs(IMAGE_DIR)
    assert "DVP NO" in key(header[C["number"]]) and "PROCEDURE" in key(header[C["procedure"]]), "Unexpected sheet layout"

    catalog, assignments, programs = [], [], set()
    for row_no, r in data:
        # Keep only letters, digits and hyphens - the sheet has stray characters
        # (e.g. a trailing backtick on U171-VDVP-802-01)
        full = re.sub(r"[^A-Za-z0-9-]", "", text(r[C["number"]])).upper()   # e.g. U171-UDVP-101-01
        m = re.match(r"^([A-Z0-9]+)-([UV]DVP-\d{3,4}-\d{2})$", full)
        if not m: raise SystemExit(f"Unrecognised DVP number: {full!r}")
        program, code = m.groups()
        programs.add(program)

        zm = re.match(r"^(\d+)\s*-\s*(.+)$", text(r[C["zone"]]))
        zone_order, zone_key = (int(zm.group(1)), key(zm.group(2))) if zm else (99, "OTHER")

        param = text(r[C["parameter"]])
        # A few rows hold a numbered list ("1.Reachability 2.Accessibility")
        # instead of a name - fall back to the full part nomenclature there
        if re.match(r"^\d+\s*\.", param): param = text(r[C["fullName"]])

        vr = key(r[C["vrCap"]])
        catalog.append({
            "code": code,
            "type": "Usability" if code.startswith("U") else "Visibility",
            "component": text(r[C["component"]]),
            "evaluationParameter": param,
            "fullName": text(r[C["fullName"]]),
            "zone": {"order": zone_order, "name": ZONE_NAMES.get(zone_key, zone_key.title())},
            "ergonomicsArea": text(r[C["area"]]),
            "cas": text(r[C["cas"]]),
            "requirement": text(r[C["requirement"]]),
            "acceptanceCriteria": text(r[C["criteria"]]),
            "procedure": text(r[C["procedure"]]),
            "procedureAvailable": key(r[C["procAvail"]]) == "YES",
            "vrCapability": "Partial" if vr.startswith("PARTIAL") else ("Yes" if vr == "YES" else "No"),
            "referenceImages": save_images(code, images_by_row.get(row_no, [])),
        })
        res = key(r[C["result"]])
        assignments.append({
            "program": program, "code": code,
            "responsibility": text(r[C["owner"]]).title(),
            "completedStatus": "Done" if key(r[C["completed"]]) == "DONE" else "Not done",
            "result": {"GREEN": "Green", "RED": "Red"}.get(res, "Pending"),
            "reason": REASONS.get(key(r[C["reason"]]), text(r[C["reason"]])),
            "remarks": text(r[C["remarks"]]),
        })

    codes = [c["code"] for c in catalog]
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes: raise SystemExit(f"Duplicate DVP codes in sheet: {sorted(dupes)}")

    out = {"source": os.path.basename(path), "programs": sorted(programs),
           "catalog": catalog, "assignments": assignments}
    dest = os.path.join(os.path.dirname(__file__), "..", "backend", "seed", "dvp-catalog.json")
    with open(dest, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, indent=1)
    n_img = sum(len(c["referenceImages"]) for c in catalog)
    print(f"Wrote {len(catalog)} DVPs for program(s) {sorted(programs)} -> {os.path.normpath(dest)}")
    print(f"Wrote {n_img} reference images for {sum(1 for c in catalog if c['referenceImages'])} DVPs -> {os.path.normpath(IMAGE_DIR)}")

if __name__ == "__main__":
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
