"""
Convert the "ALL DV PROCEDURE_EXPECTATIONS" workbook into clean seed JSON.

Usage:
    python3 scripts/import_dvp_sheet.py "<path to .xlsx>"

Writes backend/seed/dvp-catalog.json. Re-run whenever the master sheet
changes, then run `npm run seed` in backend/ to load it into MongoDB.

The sheet's status columns are free text with typos and mixed casing
("NOT" vs "NOT DONE", "CABABILITY", "PERFOMERD"...). Everything is mapped
onto a small fixed vocabulary here so the portal can filter reliably.
"""
import json, re, sys, os
from openpyxl import load_workbook

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

def text(v):
    if v is None: return ""
    s = str(v).replace("\r", "").strip()
    return re.sub(r"\n{3,}", "\n\n", s)

def key(v): return re.sub(r"\s+", " ", text(v)).upper()

def main(path):
    wb = load_workbook(path, read_only=True)
    rows = [r for r in wb["Sheet1"].iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
    header, data = rows[0], rows[1:]
    assert "DVP NO" in key(header[C["number"]]) and "PROCEDURE" in key(header[C["procedure"]]), "Unexpected sheet layout"

    catalog, assignments, programs = [], [], set()
    for r in data:
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
    print(f"Wrote {len(catalog)} DVPs for program(s) {sorted(programs)} -> {os.path.normpath(dest)}")

if __name__ == "__main__":
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
