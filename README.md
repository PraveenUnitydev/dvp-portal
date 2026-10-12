# DVP Portal

Tracks Design Verification Plans (DVPs) for the Mahindra VR Lab, per vehicle program.

Each program has its own list of applicable DVPs. Selecting a program shows only
those DVPs, grouped by vehicle zone, with their completed status, remarks,
acceptance criteria and procedure.

## What it does

**Users** pick a program and see the DVPs that apply to it: DVP no., component,
evaluation, zone, ergonomic area, CAS, acceptance criteria, procedure, image
reference, status and remarks. Clicking a DVP number opens its details, where a
user can set the **colour** (Red / Blue / Green, or Open when not assessed yet)
and **remarks**. Changes apply only to the selected program.

**Admins** can do everything users can, plus choose which catalog DVPs apply to
each program (*Manage program DVPs*): switch DVPs on/off, bulk-switch a filtered
set, or copy another program's selection as a starting point, then save.
Switching a DVP off hides it from that program but keeps its status, colour and
remarks, which return if it's switched back on.

Admins also have three more screens:

- **DVP catalog**: the base reference list, every DVP once, by its plain catalog code
  (`UDVP-101-01`, no program in front). Search and filter it, open a DVP's full details,
  and **Add DVP**: the form builds a valid code for you (type, zone, series and the next
  free running number), takes the details, up to 6 reference images, and can switch the
  new DVP on for chosen programs straight away. A DVP's code and type can't be changed afterwards.
  **Edit** changes a DVP's details and swaps its images (the change shows in every program that uses it).
  **Delete** is only possible for a DVP no program has ever used; one that programs have used (even switched off)
  can't be deleted, because that would erase their status and remarks. If two admins edit the same DVP, the second
  save is refused with a message and the screen refreshes, so nobody's work is silently overwritten.
- **Programs**: the list of vehicle programs, and **Add program** (code, name, description,
  and optionally start with another program's set of DVPs; status, colour and remarks are
  never copied, a new program starts fresh), rename a program, and **archive** one (hides it everywhere but
  keeps all its data; **Restore** brings it back exactly as it was). A program's code can't change, because it
  is part of every DVP number.
- **Manage program DVPs**: as before.

DVP numbers are shown per program as `<program>-<catalog code>`,
e.g. `S302-UDVP-101-01`. In the admin catalog they are shown by catalog code only.

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
  uploads/dvp-images/ images added through the portal (git-ignored; set UPLOAD_DIR to keep them elsewhere)
  tests/api.test.js   end-to-end API test (npm run test:api)
  scripts/seed.js
frontend/        Vite + React UI
scripts/import_dvp_sheet.py   sheet → seed JSON converter
```

## Data model

| Collection | What it holds |
|---|---|
| `dvps` | The program-independent catalog. Codes are stored without the program prefix (`UDVP-101-01`). `createdBy` is set for DVPs added in the portal. |
| `programs` | Vehicle programs (`U171`, …). |
| `programdvps` | One row per (program, DVP) an admin has switched on, with `applicable`, and that program's status, colour, remarks and who last updated it. |
| `users` | Portal accounts: username, name, role (`ADMIN` / `USER`), password hash. |

## API

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone (rate limited; 5 wrong passwords lock the account for 15 min) |
| GET | `/api/programs` | signed in |
| GET | `/api/programs/:code/dvps` | signed in |
| PATCH | `/api/programs/:code/dvps/:dvpCode` `{color, remarks}` | ADMIN, USER |
| GET | `/api/admin/programs/:code/catalog` | ADMIN |
| PUT | `/api/admin/programs/:code/applicability` `{codes: [...]}` | ADMIN |
| GET | `/api/admin/dvps` | ADMIN - the whole base catalog, with how many programs use each DVP |
| POST | `/api/admin/dvps` | ADMIN - add a DVP. Multipart form (fields below + up to 6 `images`) or JSON without images |
| POST | `/api/admin/programs` `{code, name?, description?, copyFrom?}` | ADMIN - add a program |
| PATCH | `/api/admin/dvps/:code` | ADMIN - edit a DVP. Same fields as adding (no code/type) + `expectedUpdatedAt` (as loaded; a changed DVP gives 409), `removeImages` (names), new `images` |
| DELETE | `/api/admin/dvps/:code` | ADMIN - delete a DVP no program has used (409 otherwise) |
| GET | `/api/admin/programs` | ADMIN - every program, archived ones included |
| PATCH | `/api/admin/programs/:code` `{name?, description?, active?}` | ADMIN - rename, or archive / restore (`active`) |

`POST /api/admin/dvps` fields: `type` (Usability or Visibility), `code` (`UDVP-101-08`; the letter must match the type),
`zoneOrder` (+ `zoneName` when it is a new zone), `component`, `evaluationParameter`, `fullName?`, `ergonomicsArea?`, `cas?`,
`requirement?`, `acceptanceCriteria?`, `procedure?`, `vrCapability?` (Yes / No / Partial), `programs?` (codes to switch it on for).

Rules the server enforces on everything an admin types: text can't start with `=`, `+`, `-` or `@` (spreadsheets read
those as formulas), no control characters, length limits, and codes must be unique. Images are accepted only if their
first bytes say PNG, JPEG or WebP (never judged by file name; no SVG), at most 6 per DVP and 3 MB each. Adding a DVP
inserts it first and writes the image files only after that succeeded, so two admins adding the same code at the same
moment can't overwrite each other's images. Admin changes are rate limited.

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

## LOP concerns

For a DVP that is marked **Red** in a program, anyone signed in (user or admin) can raise a **LOP concern** from the
DVP's drawer (second tab, **LOP concerns**) or the **Raise LOP** / **LOP · n** button in the table.

Each entry records: the concern details, the **CAS version** and/or **CAD model version** (at least one), up to 4
pictures, **who raised it** (name and role, taken from the sign-in) and **when**. A later update is **added** to the
history; it never replaces an earlier entry, and nothing can be edited or deleted (the API has no route for it).
The history shows newest first, with what changed in the versions since the previous entry. If the DVP stops being
Red, the history stays readable and new entries are switched off until it is Red again. History belongs to one DVP in
one program (the same DVP in another program has its own).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/programs/:code/dvps/:dvpCode/lop` | the full history, plus `enabled` (true only while the DVP is Red) |
| POST | `/api/programs/:code/dvps/:dvpCode/lop` | add an entry: multipart `details`, `casVersion`, `cadVersion`, up to 4 `images` (409 if not Red) |
| GET | `/api/lop-images/:file` | a picture; signed-in users only |

`GET /api/programs/:code/dvps` now also returns `lopCount` and `lastLopAt` for each DVP. Pictures are kept in
`uploads/lop-images/` (see `UPLOAD_DIR`) and are not publicly reachable. Text follows the same rules as everywhere
else (no leading `=`, `+`, `-`, `@`; no control characters).

## Tests

```bash
cd backend  && npm run test:api    # needs MongoDB; uses a throwaway database (dvpPortalTest) and never touches real data
cd frontend && npm run test:unit   # code-building and image-type logic
```

`test:api` seeds the real 135-DVP catalog, starts the server, and checks permissions, the number format, adding
programs and DVPs (every refusal rule, zones, images, two admins racing for one code), editing (including two admins
editing the same DVP, repeated 8 times because a race can pass by luck once), deleting, archiving programs, that
re-seeding keeps portal edits but still refreshes unedited DVPs, and rate limiting.

## Production build

```bash
cd frontend && npm install && npm run build
rm -rf ../backend/build && cp -r dist ../backend/build
cd ../backend && pm2 start server.js --name dvp-portal
```

The backend serves the built UI and sends `Cache-Control: no-store` for `index.html`.

Images admins upload are stored under `backend/uploads/` (or `UPLOAD_DIR`), outside git, so `git pull` never touches
them. Back that folder up with the database.

## Updating DVPs from the master sheet

```bash
pip install openpyxl pillow
python3 scripts/import_dvp_sheet.py "/path/to/ALL DV PROCEDURE_EXPECTATIONS.xlsx"
cd backend && npm run seed
```

Re-seeding refreshes the catalog definitions (criteria, procedure, images) but
never overwrites status, colour, remarks or admin on/off choices made in the portal.
A DVP an admin has **edited in the portal** is also left alone by a re-seed (the seed prints how many it kept),
so edits are never silently reverted by re-importing the sheet. DVPs nobody edited are still refreshed.

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

## VR capable

The DVP view shows how many of the program's DVPs are **VR capable**, from the catalog's *VR capability*
(Yes / Partial / No, set in the master sheet or under DVP catalog): an overview block with the count and a chip per
value (select one to show only those DVPs), a **VR capable** filter, a column, and a line in each DVP's details.
Marks are neutral (filled = Yes, half = Partial, hollow = No) because colour on that screen always means a DVP's colour.

## Observation images

Each DVP in a program has an **Observation images** column next to *Image reference*: supporting pictures taken
during that program's assessment. Reference images belong to the catalog DVP and are the same in every program;
observation images belong to one program.

- **+ Add images** in the column (or the DVP's details panel) opens the panel at the observation images. Choose or
  drop PNG / JPEG / WebP pictures; they upload straight away. Up to 5 MB each, 12 per DVP (set
  `OBSERVATION_MAX_IMAGES` to change), checked by content.
- Anyone who can update DVPs can add them. A picture can be removed by whoever added it, or by an admin.
- Click a thumbnail to view it full size, with who added it and when.
- They are in the reports: the DVP summary, the DVP PowerPoint (all of them) and the program PowerPoint (up to 6 per
  DVP, to keep the file small).
- Stored in `UPLOAD_DIR/observation-images/` (outside git) and served only to signed-in users. The table loads them
  only as they scroll into view.

| Method | Path | Who |
|---|---|---|
| POST | `/api/programs/:code/dvps/:dvpCode/observations` | admin, user (multipart: `images`, up to 6 at a time) |
| DELETE | `/api/programs/:code/dvps/:dvpCode/observations/:file` | the uploader, or an admin |
| GET | `/api/observation-images/:file` | signed in |

Test with mock data: `cd backend && npm run test:observations`.

## Reports

**Reports** (a tab for everyone) makes a report for **all programs**, **one program** or **one DVP**:

- **View summary** shows it on the page: colour counts (Red / Blue / Green / Open), how many DVPs are assessed,
  LOP concerns; per zone for a program; the LOP history with pictures for a DVP. Rows link to the narrower report.
- **Download VR report** downloads the lab's own VR report for the program: the newest file an admin uploaded (see
  *VR reports* below). For *All programs*, the newest report of each program is listed with a Download button.
- **Generate PowerPoint** builds a `.pptx` in the browser from the portal's data, with the same content as the summary:
  - *All programs*: summary with a chart per program, a table of all programs, then each program's LOP concerns.
  - *One program*: summary with a chart per zone, the DVPs with LOP concerns (each with its details, reference
    images and one slide per LOP entry with its pictures), then every DVP with its colour and remarks.
  - *One DVP*: details and reference images, procedure, one slide per LOP entry (oldest first) with its pictures.

Pictures are converted to JPEG in the browser (PowerPoint can't show WebP). A picture that can't be loaded is left
out; the report is still made.

| Method | Path | Who |
|---|---|---|
| GET | `/api/reports/overall` | signed in |
| GET | `/api/reports/programs/:code` | signed in |
| GET | `/api/reports/programs/:code/dvps/:dvpCode` | signed in |

Tests with mock data (no MongoDB needed): `cd backend && npm run test:report` runs the report API on the real routes
with in-memory data from the 135-DVP catalog and writes sample reports; then `cd frontend && npm run test:unit` builds
the three PowerPoint reports from those samples into `frontend/tests/out/`.

### VR reports (uploaded files)

Admins upload the VR reports made for a program on **Reports → One program → Upload VR report** (PDF, PowerPoint
.pptx, Word .docx or Excel .xlsx; up to 200 MB, set `VR_REPORT_MAX_MB` to change). A program can have several (one
per assessment round, say); all are listed newest first and anyone signed in can download any of them. Admins can
delete one.

- Files are checked by their content, not their name (a picture renamed `.pdf` is refused); old `.ppt/.doc/.xls`
  and macro files (`.pptm`, …) are refused.
- They are stored in `UPLOAD_DIR/vr-reports/` (outside git, like the other uploads) and only served to signed-in
  users: the page asks for a one-minute download link, then the browser downloads the file itself.
- **Nginx**: allow large uploads on the portal's server block, e.g. `client_max_body_size 200m;` (Nginx's default
  is 1 MB and refuses bigger uploads with "413").

| Method | Path | Who |
|---|---|---|
| GET | `/api/vr-reports` | signed in (every active program with its reports) |
| GET | `/api/programs/:code/vr-reports` | signed in |
| POST | `/api/programs/:code/vr-reports` | admin (multipart: `file`, `title`, `notes`) |
| GET | `/api/vr-reports/:id/link` | signed in (a one-minute download link) |
| GET | `/api/vr-reports/:id/file` | the link, or signed in |
| DELETE | `/api/vr-reports/:id` | admin |

Test with mock data: `cd backend && npm run test:vr-reports`.

"Done / Not done" is no longer shown or set anywhere (the stored value is kept but unused). Program lists show
**Assessed** (DVPs with a colour) and **LOP concerns** instead.
