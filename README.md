# KCB Minerals Ledger Pro v3.9 - Mobile/Desktop Shared Sync Fix

## Fixes in this version

- Desktop and mobile now use the same backend login instead of local-only users.
- Backend health detection accepts the Google Sheets backend version correctly.
- Previous Google Sheet data is loaded through `getData/getDataPublic` from the shared Apps Script backend.
- Log entries and registrations continue to save to the same Google Sheet.
- Mobile layout is reorganized with horizontal navigation, compact sidebar, better buttons, and cleaner cards.
- Sync remains quiet: no white full-screen syncing page.

## Upload to GitHub

Upload/replace:

- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `assets/logo.png`

Then open the website and hard refresh:

- Desktop: `Ctrl + Shift + R`
- Mobile Chrome: open in Incognito once, or clear site data for your GitHub Pages URL.

## Upload to Google Apps Script

Open your OLD Google Sheet → Extensions → Apps Script.

Replace `Code.gs` with the new `Code.gs` from this package.

Deploy:

Deploy → Manage deployments → Edit → Version: New version → Deploy

## Verify

Open your Apps Script `/exec` URL with:

`?action=health`

It should show:

`authVersion: 3.9-mobile-desktop-sync`

Then open:

`?action=getDataPublic`

The data shown there is what both mobile and desktop will load.

## Important about users

Users created while the app showed `LOCAL` were saved only on that device.
This v3.9 version uses backend login when Apps Script is deployed correctly, so users created by admin will work on both desktop and mobile.


## v4.0 fixes

- Files are packaged at ZIP root, not inside a nested folder.
- Logo path fixed: `./assets/logo.png`.
- Added Connection setup inside the app. If sync fails, paste your Apps Script Web App `/exec` URL there and press Test.
- Sync failure no longer says “device backup” as the main status; it tells you Google Sheet is not connected.
- Apps Script health version should show `4.0-sync-url-logo-fix`.

After uploading to GitHub, hard refresh desktop with Ctrl+Shift+R. On mobile, clear site data or open once in Incognito.
