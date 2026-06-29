# KCB Minerals Ledger Pro v6.2 - GitHub JSONP Working Fix

This version keeps the app on GitHub Pages and connects to Google Apps Script using JSONP-only calls.
It removes the iframe/google.script.run bridge from the active path because that can remain stuck in Chrome/PWA mode.

Upload to GitHub: index.html, app.js, style.css, service-worker.js, manifest.json.
Update Apps Script: Code.gs, then deploy a new Web App version as Execute as Me / Anyone.

Apps Script URL already set in app.js:
https://script.google.com/macros/s/AKfycbwA5eKoBNAbaKix_-cpHoLrfBxwnZzYfnBreUkZRIRjZV6UjLXUq8HA44R_grfd6-qC/exec

Sheet ID already set in Code.gs:
1nh2x0t1fnL7cKJkGV-APORVzrJD2BBYzEAu4SrbXXzY
