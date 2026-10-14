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
IMAGE_FIRST_COL = 19        # column T, 0-based, as drawing anchors count columns
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
    return {row: [(col, z.read(m)) for col, m in sorted(items)] for row, items in by_row.items()}

def drawing_notes(path):
    """
    Return ({sheet1 row: [(image column index, text), ...]}, [rows of floating pictures]).
    Notes are text boxes drawn on top of the reference pictures (e.g. "13 to 25 mm"). The drawn arrows and boxes
    can't be placed reliably over an in-cell picture, so their TEXT is kept as a caption under the picture.
    Labels like "IMAGE #1" are only captions in the sheet and are skipped.
    """
    z = zipfile.ZipFile(path)
    read = lambda n: z.read(n).decode("utf-8")
    try:
        target = re.search(r'Target="([^"]*drawings/[^"]+)"', read("xl/worksheets/_rels/sheet1.xml.rels")).group(1)
        drawing = read(posixpath.normpath(posixpath.join("xl/worksheets", target)))
    except (KeyError, AttributeError):
        return {}, []
    notes, floating = {}, []
    for a in re.findall(r"<xdr:(?:twoCellAnchor|oneCellAnchor)\b.*?</xdr:(?:twoCellAnchor|oneCellAnchor)>", drawing, re.S):
        col, row = (int(v) for v in re.search(r"<xdr:from><xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>", a, re.S).groups())
        if "<xdr:pic>" in a:
            floating.append(row + 1)
            continue
        t = re.sub(r"\s+", " ", " ".join(re.findall(r"<a:t>([^<]*)</a:t>", a))).strip()
        if t and not re.fullmatch(r"IMAGE\s*#\s*\d+", t, re.I):
            notes.setdefault(row + 1, []).append((col - IMAGE_FIRST_COL, t))
    return notes, floating

CAPTION_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

def on_white(im):
    """Transparent areas become white. Converting a transparent PNG straight to RGB turns them BLACK, which blacked
    out the reference tables in the first import."""
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    return im.convert("RGB")

def add_caption(im, lines):
    """A light strip under the picture with the notes that were drawn on it in the sheet."""
    from PIL import ImageDraw, ImageFont
    size = max(14, min(28, im.width // 42))
    try: font = ImageFont.truetype(CAPTION_FONT, size)
    except OSError: font = ImageFont.load_default()
    text = "Notes in the sheet: " + "; ".join(lines)
    draw = ImageDraw.Draw(im)
    words, rows, cur = text.split(" "), [], ""
    for w in words:                                   # wrap to the picture's width
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) > im.width - 2 * size and cur: rows.append(cur); cur = w
        else: cur = trial
    rows.append(cur)
    pad, line_h = size // 2 + 4, int(size * 1.4)
    out = Image.new("RGB", (im.width, im.height + 2 * pad + line_h * len(rows)), (241, 243, 246))
    out.paste(im, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, im.height), (im.width, im.height)], fill=(195, 204, 214), width=1)
    for i, line in enumerate(rows):
        d.text((size, im.height + pad + i * line_h), line, fill=(27, 39, 51), font=font)
    return out

def save_images(code, items, notes=()):
    """Write a DVP's images as WebP; returns the file names in column order.
    items: [(image column index, bytes)]; notes: [(image column index, text)] drawn on top in the sheet."""
    names, seen, col_to_name = [], {}, {}
    for col, blob in items:
        if blob in seen:                            # same picture pasted twice in one row
            col_to_name[col] = seen[blob]; continue
        name = f"{code}-{len(names) + 1}.webp"
        seen[blob] = name; col_to_name[col] = name
        names.append(name)
    for col, blob in items:
        name = col_to_name[col]
        if seen.get(blob) != name or os.path.exists(os.path.join(IMAGE_DIR, name)): continue
        src = Image.open(io.BytesIO(blob))
        im = on_white(src)
        # a note belongs to the picture in its column; if that column has none, to the nearest picture
        mine = [t for c, t in notes if min(col_to_name, key=lambda k: abs(k - c)) == col] if col_to_name else []
        if mine: im = add_caption(im, mine)
        # screenshots and tables stay sharp (lossless); photos use high-quality compression
        if src.format == "PNG" and im.width * im.height <= 2_500_000:
            im.save(os.path.join(IMAGE_DIR, name), "WEBP", lossless=True, method=6)
        else:
            im.save(os.path.join(IMAGE_DIR, name), "WEBP", quality=90, method=6)
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
    notes_by_row, floating_rows = drawing_notes(path)
    data_rows = {row for row, _ in data}
    stray = [r for r in floating_rows if r not in data_rows]
    if floating_rows:
        print(f"Note: {len(floating_rows)} picture(s) float on Sheet1 instead of sitting in a Reference Images cell"
              + (f"; {len(stray)} of them are below/outside the DVP rows (rows {min(stray)}-{max(stray)}) and are not linked to any DVP" if stray else "")
              + ". Not imported.")
    other = [n for n in zipfile.ZipFile(path).namelist() if re.match(r"xl/drawings/drawing\d+\.xml$", n)]
    other_pics = sum(zipfile.ZipFile(path).read(n).decode("utf-8").count("<xdr:pic>") for n in other) - len(floating_rows)
    if other_pics > 0:
        print(f"Note: other sheets hold {other_pics} picture(s) with no DVP number next to them. Not imported.")
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
            "referenceImages": save_images(code, images_by_row.get(row_no, []), notes_by_row.get(row_no, [])),
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
