# KCB Minerals Ledger Pro

This package contains the enhanced KCB Minerals Ledger with backend-secured Admin/User login.

## Files

- `index.html` - Main GitHub Pages app
- `style.css` - Styling and responsive layout
- `app.js` - Frontend logic, reports, charts, exports, sync
- `Code.gs` - Google Apps Script backend with secure login and role permissions

## GitHub Pages setup

Upload these files to your GitHub repository root:

- `index.html`
- `style.css`
- `app.js`
- `README.md`

Then enable GitHub Pages from repository Settings → Pages.

## Google Apps Script setup - required

1. Open your existing Google Apps Script project.
2. Replace your current script code with the contents of `Code.gs`.
3. Click Save.
4. Click Deploy → Manage deployments.
5. Edit your Web App deployment or create a new one.
6. Use these settings:
   - Execute as: Me
   - Who has access: Anyone
7. Deploy.
8. If Google gives you a new Web App URL, paste that URL into the first line of `app.js`:

```js
const CLOUD_API_URL = "YOUR_NEW_WEB_APP_URL_HERE";
```

## Default backend accounts

- Admin: `admin` / `admin123`
- User: `user` / `user123`

Change these after first login from Admin Users.

## Access control

Admin can access:

- Dashboard
- Customer Statement
- Registration
- Log Entry and Payment Entry
- Exports
- User Management
- Edit/Delete transactions

User can access only:

- Log Entry
- Payment Entry
- Registration

The backend also checks permissions before saving data. Users cannot delete transactions or manage users from direct API calls.

## Sync fix

Background Drive sync no longer opens the full white loading overlay. The overlay is used only while saving records; automatic sync updates the sidebar status silently.

## Data storage

The backend stores ledger data in a Google Drive JSON file named:

`KCB_Minerals_Ledger_DB.json`

User accounts are stored in Apps Script Properties with hashed passwords.


## If login fails

1. Open Apps Script and confirm the latest `Code.gs` from this ZIP is pasted and saved.
2. Click **Deploy → Manage deployments → Edit**.
3. Choose **Version: New version** and click **Deploy**. Saving code alone is not enough.
4. Confirm `app.js` line 1 uses the same Web App URL ending in `/exec`.
5. If `admin / admin123` still fails, reset the backend users:
   - In Apps Script, open the function dropdown near the Run button.
   - Select `resetUsersToDefaultManual`.
   - Click **Run** and approve permissions if asked.
   - Deploy a new version again.
   - Try login again with `admin / admin123`.

You can also test the backend by opening your Web App URL with:

`?action=health`

It should return JSON/JSONP containing `authVersion: 3.2-fixed-login`.
