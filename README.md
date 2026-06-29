KCB Minerals Ledger Pro v6.1 - GitHub Bridge Working

This version keeps the app on GitHub Pages, but uses a hidden Apps Script iframe bridge for Google Sheet sync.
It avoids browser CORS, Apps Script redirect and service-worker cache problems.

Files for GitHub:
- index.html
- app.js
- style.css
- service-worker.js
- manifest.json
- keep your existing assets/logo.png on GitHub

File for Google Apps Script:
- Code.gs

Apps Script deployment:
1. Open your Google Sheet.
2. Extensions -> Apps Script.
3. Replace Code.gs with the provided Code.gs.
4. Save.
5. Deploy -> Manage deployments -> Edit -> New version -> Deploy.
6. Execute as: Me.
7. Who has access: Anyone.
8. Use the same /exec URL already inside app.js.

GitHub deployment:
1. Upload/replace index.html, app.js, style.css, service-worker.js, manifest.json.
2. Commit changes.
3. Open https://kcbminerals.github.io/KCB-Minerals-Ledger/?v=6.1
4. Hard refresh with Ctrl+Shift+R.
5. Login admin and press Sync.

Debug:
Open browser console and run: kcbTestCloudBridge()
