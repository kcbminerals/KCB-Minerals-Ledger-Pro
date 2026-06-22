# KCB Minerals Ledger Pro v4.2 - Forced Google Sheet Mode

This version fixes the issue shown as **ADMIN / LOCAL**.

## Important behavior

- The app no longer restores old LOCAL sessions.
- Mobile and desktop must both login through the same Google Apps Script backend.
- The app no longer silently displays this-device backup when sync fails.
- The KCB logo is embedded in `index.html`, so it will display even if `assets/logo.png` is not uploaded.

## Upload to GitHub

Upload/replace:

- index.html
- style.css
- app.js
- README.md
- assets/logo.png

## Google Apps Script setup

Open your old Google Sheet, then:

1. Extensions → Apps Script
2. Replace all code with `Code.gs`
3. Save
4. Deploy → Manage deployments → Edit
5. Version: New version
6. Execute as: Me
7. Who has access: Anyone
8. Deploy

## Test

Open your Apps Script `/exec` URL with:

`?action=health`

It should show:

`authVersion: 4.2-forced-google-sheet`

## Browser refresh

After GitHub upload:

- Desktop: Ctrl + Shift + R
- Mobile: clear site data or open in Incognito once

Then login with backend users.
