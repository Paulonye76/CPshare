# CP Share — Share Without Limits.

Phase 1 prototype: a responsive web app with **real** device-to-device file transfer (WebRTC data channels), a Node/Express/Socket.IO pairing + signaling server, and the full page structure for later phases. File bytes never go through the server.

## Run it
```bash
npm install
npm start            # http://localhost:3000
npm test             # unit tests (no browser needed)
npm run test:e2e     # needs: npx playwright install chromium
```
**Two real devices:** both must reach the server. Same Wi-Fi: open `http://<your-computer-LAN-IP>:3000` on both. Over plain HTTP on a LAN IP the browser is not a "secure context", so received files are held in **memory** (1 GB/file limit). For streaming-to-disk on phones use HTTPS: run behind Caddy/Nginx, a tunnel (e.g. Cloudflare Tunnel, ngrok), or set `TLS_KEY_FILE`/`TLS_CERT_FILE` (e.g. an mkcert certificate trusted on the phone).
Use: sender → Send → pick files → *Create pairing code* → receiver → Receive → enter code (or open the shared link) → Accept.

## TURN (cross-network transfers)
STUN alone does not guarantee a connection. Set `TURN_URLS` plus either `TURN_SECRET` (coturn `use-auth-secret`, short-lived credentials) or `TURN_USERNAME`/`TURN_CREDENTIAL`. Credentials are handed to browsers through signaling, never hard-coded. Without TURN, different-network transfers can fail. Not tested here (no TURN server available).

## Structure
- `server/` pairing store, signaling validation, rate limits, ICE/TURN config, Express + Socket.IO entry.
- `public/js/transfer.js` the protocol engine; `rtc.js` connection; `storage.js` OPFS/memory sinks; `lib/sha256.js` streaming SHA-256; `session.js` orchestration; `pages/*` views.
- `db/schema.sql` draft PostgreSQL schema (not applied). `tests/` unit + end-to-end. `docs/` API, security, test plan, feature status.

Config: copy `.env.example`; see it for every variable. Deploy: HTTPS/WSS reverse proxy, `TRUST_PROXY=true` behind it, TURN server, `NODE_ENV=production`.
