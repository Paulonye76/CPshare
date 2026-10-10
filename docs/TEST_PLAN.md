# Test plan and status
Legend: ✅ automated and passing in this sandbox · 🟡 manual, needs real devices · ⬜ not built yet
| # | Case | Status |
|---|---|---|
| 1 | Same Wi-Fi, two devices | 🟡 (two browser pages on localhost ✅) |
| 2 | Different networks (needs TURN) | 🟡 |
| 3-5 | Small, large (40 MB tested; multi-GB 🟡), multiple files | ✅ / 🟡 |
| 6 | Interrupted transfer | ✅ connection-lost reported, no false success |
| 7 | Receiver rejection | ✅ |
| 8-9 | Invalid / expired codes | ✅ unit + UI |
| 10 | Duplicate filenames | ✅ |
| 11 | Connection loss | ✅ |
| 12 | Integrity (tampered chunk detected, file discarded) | ✅ |
| 13 | Memory usage on low-end phones | 🟡 |
| 14 | Unsupported types (any file accepted) | ✅ |
| 15 | Unauthorized admin access | ✅ 401 (UI test uses a stub; run against real server 🟡) |
| 16-18 | Duplicate reward claims / payment events / failed withdrawals | ⬜ Phase 4-5 |
Run: `npm test`, `npm run test:e2e`, `node tests/e2e/ui.e2e.mjs`.
Benchmark vs Xender (🟡 not done): same devices, files, network; record connection time, avg/peak speed, completion and failure rate, CPU/memory, battery. No speed claim is made.
