# DVP Portal

Tracks Design Verification Plans (DVPs) for the Mahindra VR Lab, per vehicle program.

Each program has its own list of applicable DVPs. Selecting a program shows only
those DVPs, grouped by vehicle zone, with their completed status, remarks,
acceptance criteria and procedure.

## What it does

**Users** pick a program and see the DVPs that apply to it: DVP no., component,
evaluation, zone, ergonomic area, CAS, acceptance criteria, procedure, image
reference, status and remarks. Clicking a DVP number opens its details, where a
user can set the **status** (Done / Not done), **colour** (Red / Blue / Green)
and **remarks**. Changes apply only to the selected program.

**Admins** can do everything users can, plus choose which catalog DVPs apply to
each program (*Manage program DVPs*): switch DVPs on/off, bulk-switch a filtered
set, or copy another program's selection as a starting point, then save.
Switching a DVP off hides it from that program but keeps its status, colour and
remarks, which return if it's switched back on.

DVP numbers are shown per program as `VRC-<program>-<catalog code>`,
e.g. `VRC-S302-UDVP-101-01`.

Sample programs: U171 (the assessed base program, all 135 DVPs from the master
sheet), S302 and D101 (empty until an admin assigns DVPs).

## Stack

MongoDB · Express 4 · React 18 (Vite) · Node 18+

```
backend/
  models/        Program, Dvp (catalog), ProgramDvp (applicability + status)
  routes/        auth, programs (list, view, update), admin (catalog, selection)
  middleware/    auth.js - sign-in check and role check
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
| `programdvps` | One row per (program, DVP) an admin has switched on, with `applicable`, and that program's status, colour, remarks and who last updated it. |
| `users` | Portal accounts: username, name, role (`ADMIN` / `USER`), password hash. |

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone (rate limited; 5 wrong passwords lock the account for 15 min) |
| GET | `/api/programs` | signed in |
| GET | `/api/programs/:code/dvps` | signed in |
| PATCH | `/api/programs/:code/dvps/:dvpCode` `{completedStatus, color, remarks}` | ADMIN, USER |
| GET | `/api/admin/programs/:code/catalog` | ADMIN |
| PUT | `/api/admin/programs/:code/applicability` `{codes: [...]}` | ADMIN |

## Local setup

```bash
# backend
cd backend
cp .env.example .env          # set MONGO_URI and JWT_SECRET (server won't start without it)
npm install
npm run seed                  # loads seed/dvp-catalog.json (safe to re-run)

# create accounts (password via env var, at least 10 characters)
PORTAL_PASSWORD='...' npm run create-user -- admin ADMIN "Portal Admin"
PORTAL_PASSWORD='...' npm run create-user -- naveen USER "Naveen S"

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

Re-seeding refreshes the catalog definitions (criteria, procedure, images) but
never overwrites status, colour, remarks or admin on/off choices made in the portal.

The converter also extracts the reference images. They are Excel "place in cell"
pictures (they show as `#VALUE!` outside Excel), so it follows the workbook's rich-data
XML to find each picture's cell, then saves them as WebP (22 MB of PNG → about 3 MB).

The converter normalises the sheet's free-text statuses (e.g. "NOT"/"NOT DONE",
"CABABILITY", "PERFOMERD") to a fixed vocabulary and fails loudly on anything it
doesn't recognise, rather than importing bad data.

## Programs

U171 is the assessed base program: the master sheet and its DVPs belong to it.
S302's DVP list is being created with U171 as the reference.

U171's Green/Red results from the master sheet were imported as DVP colours.

Annotation shapes drawn on top of the sheet (arrows, boxes) are not part of the
in-cell pictures and are not imported.

## Sign-in

Local username/password accounts for now. The rest of the app only relies on a
user's name and role, so this can be swapped for Azure AD SSO (as in VRSP)
without changing the pages or the data.
