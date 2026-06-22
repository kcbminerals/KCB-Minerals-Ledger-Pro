# KCB Minerals Ledger Pro v3.7 - Existing Google Sheet Fix

This version fixes the issue where Apps Script created a new Google Sheet.

## Important

To use your OLD Google Sheet, open `Code.gs` and set:

```javascript
const SPREADSHEET_ID = 'PASTE_YOUR_OLD_SHEET_ID_HERE';
```

The Sheet ID is the long part in your Google Sheet URL:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

If your Apps Script is attached directly to the old Google Sheet, this version will also try to use that attached Sheet automatically.

## Required sheet tabs

The backend will create these tabs in your old Sheet if they do not exist:

- Vehicles
- Transactions

## Deploy

After changing Code.gs:

Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy

Then open:

```text
YOUR_APPS_SCRIPT_URL?action=health
```

It should show:

```text
authVersion: 3.7-use-existing-sheet
```

and the `spreadsheetUrl` should be your OLD Google Sheet URL.
