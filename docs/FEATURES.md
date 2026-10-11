# Implemented vs not implemented
**Implemented and tested here:** pairing codes, signaling, real WebRTC chunked transfer with backpressure + end-to-end flow control, SHA-256 verification, multi-file, accept/reject, cancel, stall/connection timeouts, safe filenames, OPFS streaming or memory fallback, all 19 pages + menu, local history/settings, server-side 401 gates, TURN config plumbing.
**Not tested here:** Socket.IO transport and Express routes (no npm network in the build sandbox; handler logic is unit-tested), TURN relay, Safari/Firefox, real phones, large (GB) files, benchmarks.
**Planned (clearly labelled in the UI):** accounts, login/registration, admin dashboard and RBAC, PostgreSQL (`db/schema.sql` draft), transfer reports to the server, rewarded ads, reward ledger, wallet, withdrawals and webhooks, FX estimates, support tickets, native Android (Kotlin) app.

## Offline mode (added)
- App shell is cached by a service worker on the first visit (HTTPS needed once), so it opens with no internet.
- Offline pairing: QR codes carry the connection details (about 100 characters, no server, no STUN). Same Wi-Fi or one phone's hotspot. Uses IPv4 local addresses only.
- Verified here: QR encoder (80 version/ECC combos decoded with OpenCV), full pairing + transfer between two browser pages with no signaling server, app loading with the network off.
- NOT verified: the live camera scan on a real phone (BarcodeDetector in Chrome for Android), hotspot client isolation on some phones/routers, iPhone/Safari (no BarcodeDetector).
- Gallery: browsers cannot write into the Gallery. Received photos/videos get a "Save to gallery" button that opens the Android share sheet (choose Gallery/Photos). Normal Save puts files in Downloads, which Gallery apps usually show.
