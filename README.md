# KCB Minerals Ledger Pro v3.5

## Fixes in this version

- Fixed `Sync failed` showing continuously.
- Added legacy Google Apps Script sync fallback.
- Added public read endpoint support: `getDataPublic`.
- Fixed Dark Mode button.
- Fixed light-mode select/dropdown text visibility.
- Added Change Password button.
- Added local fallback user creation so Admin can create users even before Apps Script auth is redeployed.
- Added backend `changePassword` action in `Code.gs`.
- Added your KCB Minerals logo.

## Default login

Admin:
- Username: `admin`
- Password: `admin123`

User:
- Username: `user`
- Password: `user123`

## GitHub upload

Upload these to your GitHub repository root:

- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `assets/logo.png`

After uploading, open the site and press **Ctrl + Shift + R**.

## Apps Script upload

Open Google Apps Script and replace your backend code with `Code.gs` from this package.
Then redeploy:

Deploy → Manage deployments → Edit → Version: New version → Deploy

## Important

If the top badge says `LOCAL`, the app is using local fallback login. You can still use the app, create local users, and change local passwords.

For true cloud-secured users, paste `Code.gs` into Apps Script and redeploy a new version.
