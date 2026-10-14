# Putting the DVP portal on vrc.mahindra.com

The DVP portal runs next to VRSP on the same server, at **https://vrc.mahindra.com/dvp/**, and people sign in with
the same Microsoft account through VRSP's sign-in.

```
browser ── https://vrc.mahindra.com ── Nginx ─┬─ /dvp/...  →  DVP portal   127.0.0.1:7100  (PM2 "dvp-portal")  DB dvpPortal
                                              └─ /...      →  VRSP         127.0.0.1:7000  (existing)          DB workSystem

Sign in:  DVP "Sign in with Microsoft" → VRSP /api/auth/sso?app=dvp → Microsoft → VRSP /api/auth/callback
          → back to /dvp/login?sso_code=… → the DVP server collects the person from VRSP (server to server,
            with a shared secret) → DVP decides access and signs them in.
```

- **No Azure change.** It uses the redirect URI VRSP already has registered (`/api/auth/callback`).
- **No DNS or certificate change.** It is a folder of the same site.
- **Signing in to the DVP portal never signs anyone out of VRSP**, and it creates no VRSP account. VRSP only passes
  the person's name, emails, job title and department on to the DVP portal.
- **The DVP portal decides access itself.** `ADMIN_EMAILS` are admins. Everyone else waits for an admin to approve
  them on the **Users** tab, unless *Settings → Sign-in* lets first-time sign-ins straight in as User. Phones are
  blocked, the same as VRSP.

---

## 1. VRSP (once)

1. **Code.** Update VRSP on the server from **`main`** the usual way (`git pull origin main`). That brings the sign-in
   for other portals and a *DVP Portal* link in VRSP's header (shown to Admin and Member), with a fresh frontend
   build.
2. **Secret.** Make one shared secret, used by both apps:
   ```bash
   node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
   ```
3. **VRSP `backend/.env`**: add these lines.
   ```
   SSO_APPS=dvp
   SSO_APP_DVP_URL=https://vrc.mahindra.com/dvp
   SSO_APP_DVP_SECRET=<the secret>
   ```
4. **Restart VRSP** so it reads them: `pm2 restart <vrsp app name> --update-env`.

## 2. The DVP portal (first time)

```bash
# Node 18 or newer
node -v

# Code: next to VRSP, e.g. /opt/dvp-portal
sudo mkdir -p /opt/dvp-portal && sudo chown "$USER" /opt/dvp-portal
git clone https://github.com/PraveenUnitydev/dvp-portal.git /opt/dvp-portal
cd /opt/dvp-portal          # branch: main

# Uploaded files live outside the code folder, so updates never touch them
sudo mkdir -p /var/lib/dvp-portal/uploads && sudo chown "$USER" /var/lib/dvp-portal/uploads

# Settings
cp backend/.env.example backend/.env
nano backend/.env
```

In `backend/.env`:

| Setting | What to put |
|---|---|
| `JWT_SECRET` | A **new** random value, different from VRSP's: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/dvpPortal`. If MongoDB needs a login, use the same form as VRSP's `MONGO_URI` with the database `dvpPortal`. |
| `UPLOAD_DIR` | `/var/lib/dvp-portal/uploads` |
| `SSO_APP_SECRET` | **The same secret** as VRSP's `SSO_APP_DVP_SECRET` |
| `ADMIN_EMAILS` | Your email(s), comma-separated, e.g. `25033899@mahindra.com,praveen.k@mahindra.com` |
| `HOST`, `PORT`, `SSO_VRSP_URL`, `SSO_VRSP_INTERNAL_URL`, `SSO_APP_NAME` | Leave as in the example. `SSO_VRSP_INTERNAL_URL` is VRSP's port on the same machine (7000). |

**Data**. Do one of these two:

- **Start fresh:** load the 135 DVPs and the programs in the sheet.
  ```bash
  cd backend && npm ci --omit=dev && npm run seed && cd ..
  ```
- **Bring your local data:** use this if you already entered real colours, remarks, LOP concerns or images on your PC.
  ```bash
  # on your PC
  mongodump --db dvpPortal --archive=dvpPortal.archive
  # also copy your local uploads folder (backend/uploads, or your UPLOAD_DIR) to the server

  # on the server
  mongorestore --archive=dvpPortal.archive
  cp -r <copied uploads>/* /var/lib/dvp-portal/uploads/
  ```

**Build and start** (installs, builds the screens for `/dvp/`, starts PM2, checks it answers):

```bash
bash deploy/deploy.sh
```

**Nginx.** Paste the two blocks from `deploy/nginx-dvp.conf` inside the existing **HTTPS** `server { … }` block for
vrc.mahindra.com, above VRSP's `location / { … }`. Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Optional: a break-glass admin** with a password, for when Microsoft sign-in is down. It is under *Sign in with a
portal account instead* on the login page.

```bash
cd backend && PORTAL_PASSWORD='<10+ characters>' node scripts/create-user.js admin ADMIN "Portal Admin"
```

## 3. Check

1. Open **https://vrc.mahindra.com/dvp/**. You should see *Sign in with Microsoft*.
2. Sign in. You land in the portal as **Admin**, because your email is in `ADMIN_EMAILS`.
3. **Settings → Sign-in**: choose whether first-time sign-ins get in straight away, or wait for approval on
   **Users** (the default).
4. In VRSP, the header shows **DVP Portal** for Admin and Member.

## Updating later

```bash
cd /opt/dvp-portal && bash deploy/deploy.sh
```

## Backups

Back up the database `dvpPortal` together with `/var/lib/dvp-portal/uploads`. They belong together: the database
names the files. If VRSP is already backed up, add these two to the same job, e.g.:

```bash
mongodump --db dvpPortal --archive=/backups/dvpPortal-$(date +%F).archive
tar czf /backups/dvp-uploads-$(date +%F).tgz -C /var/lib/dvp-portal uploads
```

## If something is wrong

| You see | Check |
|---|---|
| *502 Bad Gateway* at /dvp/ | `pm2 logs dvp-portal`. Is it running? (`pm2 ls`) |
| A blank page, or 404s for `/dvp/assets/...` | The screens were built without `build:vrc`. Run `bash deploy/deploy.sh` again. |
| *Microsoft sign-in is not set up correctly on the server* | `SSO_APP_SECRET` (DVP) and `SSO_APP_DVP_SECRET` (VRSP) differ, or VRSP wasn't restarted with `--update-env` |
| *The sign-in service could not be reached* | VRSP is down, or `SSO_VRSP_INTERNAL_URL` is wrong (should be `http://127.0.0.1:7000`) |
| After Microsoft you land on VRSP's login page, not the DVP portal | VRSP doesn't know the app: check `SSO_APPS` / `SSO_APP_DVP_URL` in VRSP's `.env` and restart VRSP |
| *Microsoft sign-in isn't available* on the DVP login page | VRSP's own Azure settings (`AZURE_*`), or Microsoft is unreachable from the server |
| A big VR report fails with *too large* | `client_max_body_size` in the Nginx snippet must be at least the *Largest VR report file* setting |
| Someone can't get in after signing in | They are waiting for approval, or their access is off: see **Users** |
