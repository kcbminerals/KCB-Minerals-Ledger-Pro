# KCB Minerals Ledger Pro v4.1 - Built-in Connection Fix

This version removes the repeated Connection Setup requirement.

## What changed

- The Apps Script `/exec` connection is built into `app.js`.
- Old wrong mobile/desktop saved backend URLs are ignored automatically.
- Sync no longer asks for connection URL.
- Sync error message now points to Apps Script deployment/access if the backend is unreachable.
- Logo remains at `assets/logo.png`.

## Upload to GitHub

Upload these files to the repository root:

- `index.html`
- `style.css`
- `app.js`
- `README.md`
- `assets/logo.png`

## Apps Script setup

Open your old Google Sheet, then:

`Extensions → Apps Script`

Paste `Code.gs`, save, then redeploy:

`Deploy → Manage deployments → Edit → Version: New version → Deploy`

The Web App deployment must be:

- Execute as: Me
- Who has access: Anyone

## Important

The built-in URL inside `app.js` is:

`https://script.google.com/macros/s/AKfycbyAJRWI2XiKLViz30C-VzaEPs2AX7cUJfOv1eiQcEphwiBB2GCX-y4j_4MiZbU2a0fC/exec`

If you create a completely new deployment with a different `/exec` URL, replace only this one line in `app.js`:

`const DEFAULT_CLOUD_API_URL = ".../exec";`

Then upload `app.js` again.
