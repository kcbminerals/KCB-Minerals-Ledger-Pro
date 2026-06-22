# KCB Minerals Ledger Pro v3.6 - Google Sheets Fix

## What this version fixes

- New vehicle registrations are saved into a real Google Sheet.
- Load entries and payment entries are saved into a real Google Sheet.
- Existing old JSON Drive data is automatically migrated into the sheet once.
- Better light/dark color contrast.
- Local fallback login can still submit entry data to Google Sheets.

## Files for GitHub

Upload these files/folders to your GitHub repository root:

- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `assets/logo.png`

After upload, open your website and press `Ctrl + Shift + R`.

## File for Google Apps Script

Open Google Apps Script and replace your backend with:

- `Code.gs`

Then redeploy:

`Deploy → Manage deployments → Edit → Version: New version → Deploy`

Saving Code.gs is not enough. You must deploy a new version.

## Where your data appears

This backend creates or uses a Google Sheet named:

`KCB_Minerals_Ledger_Data`

It contains two sheets:

- `Vehicles`
- `Transactions`

Find it in the same Google Drive account that owns/runs the Apps Script deployment.

## Existing Google Sheet

If you already have a specific Google Sheet and want the data to go there, open `Code.gs` and paste the Sheet ID here:

```javascript
const SPREADSHEET_ID = '';
```

Example:

```javascript
const SPREADSHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';
```

Then redeploy Apps Script again.

## Test backend

Open your Apps Script web app URL and add:

`?action=health`

You should see:

`authVersion: 3.6-fixed-login-sheets`

and a `spreadsheetUrl`.

## Login

Admin:

- username: `admin`
- password: `admin123`

User:

- username: `user`
- password: `user123`
