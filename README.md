# DVP Portal

Tracks Design Verification Plans (DVPs) for the Mahindra VR Lab, per vehicle program.

Each program has its own list of applicable DVPs. Selecting a program shows only
those DVPs, grouped by vehicle zone, with their completed status, remarks,
acceptance criteria and procedure.

## Phase 1 scope

- Master DVP catalog (135 DVPs from the *ALL DV PROCEDURE_EXPECTATIONS* sheet)
- Vehicle programs, each with its own subset of the catalog
- Select a program → see its DVPs: DVP no., component, evaluation, zone,
  ergonomic area, CAS, acceptance criteria, procedure, image reference
- Reference images: thumbnails in the table, full-size viewer on click
- Filter by zone and ergonomic area, search by number / component / evaluation

Read-only for now: programs and assignments are loaded from the sheet via the
seed script. Editing, SSO login and roles come in a later phase (reusing VRSP's
Azure AD SSO), which is why the API exposes no write endpoints yet.

## Stack

MongoDB · Express 4 · React 18 (Vite) · Node 18+

```
backend/
  models/        Program, Dvp (catalog), ProgramDvp (applicability + status)
  routes/        /api/programs, /api/programs/:code/dvps
  seed/          dvp-catalog.json  (generated from the sheet)
  public/dvp-images/  reference images (generated from the sheet, served at /dvp-images)
  scripts/seed.js
frontend/        Vite + React UI
scripts/import_dvp_sheet.py   sheet → seed JSON converter
```

## Data model

| Collection | What it holds |
|---|---|
| `dvps` | The program-independent catalog. Codes are stored without the program prefix (`UDVP-101-01`). |
| `programs` | Vehicle programs (`U171`, …). |
| `programdvps` | One row per (program, DVP) that applies, plus that program's progress: responsibility, completed status, result, reason, remarks. A DVP with no row for a program is not shown for it. |

The full DVP number shown in the UI is built per program: `U171-UDVP-101-01`.

## Local setup

```bash
# backend
cd backend
cp .env.example .env          # set MONGO_URI
npm install
npm run seed                  # loads seed/dvp-catalog.json (safe to re-run)
npm start                     # http://localhost:7100

# frontend (dev, proxies /api to 7100)
cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

## Production build

```bash
cd frontend && npm install && npm run build
rm -rf ../backend/build && cp -r dist ../backend/build
cd ../backend && pm2 start server.js --name dvp-portal
```

The backend serves the built UI and sends `Cache-Control: no-store` for `index.html`.

## Updating DVPs from the master sheet

```bash
pip install openpyxl pillow
python3 scripts/import_dvp_sheet.py "/path/to/ALL DV PROCEDURE_EXPECTATIONS.xlsx"
cd backend && npm run seed
```

The converter also extracts the reference images. They are Excel "place in cell"
pictures (they show as `#VALUE!` outside Excel), so it follows the workbook's rich-data
XML to find each picture's cell, then saves them as WebP (22 MB of PNG → about 3 MB).

The converter normalises the sheet's free-text statuses (e.g. "NOT"/"NOT DONE",
"CABABILITY", "PERFOMERD") to a fixed vocabulary and fails loudly on anything it
doesn't recognise, rather than importing bad data.

## Programs

U171 is the assessed base program: the master sheet and its DVPs belong to it.
S302's DVP list is being created with U171 as the reference.

Completed status, result, reason and remarks are still stored per program
(from the sheet) but are not shown in the table in this phase.

Annotation shapes drawn on top of the sheet (arrows, boxes) are not part of the
in-cell pictures and are not imported.
