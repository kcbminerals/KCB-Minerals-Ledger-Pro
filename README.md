# KCB Minerals Ledger Pro — Simple Login Build

This package is changed to **username-only login**. No password is required.

## Login

- Type `admin` for full access: dashboard, statements, export, edit/delete, user management.
- Type any other name, for example `driver1`, for entry access: registration and log entry.
- Mobile and desktop both sync through the same Google Sheet backend.

## Files

- `index.html` — app page for GitHub Pages
- `app.js` — frontend logic
- `style.css` — design
- `Code.gs` — Google Apps Script backend for Google Sheet sync
- `assets/logo.png` — logo

## Important setup

1. In your existing Google Sheet, open **Extensions → Apps Script**.
2. Replace the code with `Code.gs` from this package.
3. In `Code.gs`, paste your existing Sheet ID in `SPREADSHEET_ID` if the script is not bound to your old Sheet.
4. Deploy as Web App:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` Web App URL and paste it into `DEFAULT_CLOUD_API_URL` at the top of `app.js`.
6. Upload `index.html`, `app.js`, `style.css`, and `assets/logo.png` to GitHub Pages.

Version: `4.3-simple-login`
