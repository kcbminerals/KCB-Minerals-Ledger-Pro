# KCB Minerals Ledger Pro

This package contains a cleaned and enhanced version of the KCB Minerals Ledger.

## Files

- `index.html` - Main page
- `style.css` - Styling and responsive layout
- `app.js` - Application logic, Google Apps Script sync, reports, charts, exports

## How to use on GitHub Pages

1. Upload all files to your repository root.
2. Make sure the filenames stay exactly:
   - index.html
   - style.css
   - app.js
3. Commit changes.
4. Open your GitHub Pages link.

Your existing Google Apps Script URL has been preserved inside `app.js`.


## Admin and User Login

Default accounts:
- Admin: `admin` / `admin123`
- User: `user` / `user123`

Admin can access Dashboard, Statement, Registration, Log Entry, Exports, and User Management.
User can access only Log Entry and Registration. Dashboard, Customer Statement, exports, transaction edit/delete, and user management are hidden.

Important: Because GitHub Pages is static hosting, this role system is client-side access control. For real secure authentication, implement login validation in Google Apps Script/backend.

## Sync Fix

Background Drive sync no longer opens the full white loading overlay. The overlay is now only used while saving records; automatic sync updates the sidebar status silently.
