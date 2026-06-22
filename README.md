# KCB Minerals Ledger Pro v3.3

## What is included

- `index.html` - website UI
- `style.css` - website styling
- `app.js` - website logic
- `Code.gs` - Google Apps Script backend
- `assets/logo.png` - KCB Minerals logo

## Login

Default accounts:

- Admin: `admin` / `admin123`
- User: `user` / `user123`

This version first tries secure backend login through Google Apps Script. If the backend is not updated or not reachable, it allows a local fallback login using the default accounts so you are not locked out.

For real backend security, paste the included `Code.gs` into Apps Script and deploy a new Web App version.

## GitHub upload

Upload these files/folders to your GitHub repository root:

- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `assets/`

## Google Apps Script upload

1. Open your Apps Script project.
2. Open `Code.gs`.
3. Delete old code.
4. Paste the included `Code.gs` code.
5. Save.
6. Deploy → Manage deployments → Edit → Version: New version → Deploy.

## Important

If you use a new Apps Script Web App URL, update the first line in `app.js`:

```js
const CLOUD_API_URL = "YOUR_NEW_EXEC_URL";
```

## Fix login if backend login fails

In Apps Script editor:

1. Select function `resetUsersToDefaultManual`.
2. Click Run.
3. Deploy a new version.
4. Try login again.



## Emergency login fix v3.4

This build fixes the previous login screen problem caused by missing core browser utility functions in `app.js`.

Default local login works immediately on GitHub Pages:

- Admin: `admin` / `admin123`
- User: `user` / `user123`

The app still attempts Google Apps Script backend login first, but if the backend is not redeployed or not responding, it falls back to local login so you are not locked out.

Important: upload the complete `assets` folder with `logo.png`, plus `index.html`, `style.css`, and `app.js`.
