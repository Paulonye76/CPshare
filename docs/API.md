# API

## HTTP
| Route | Behaviour (Phase 1) |
|---|---|
| `GET /api/health` | `{ok, uptimeSeconds, activeSessions}` |
| `GET /api/config` | app version, `turnConfigured`, feature flags (all money features `false`) |
| `GET /api/rewards/rules` | **Proposed**, inactive reward rules (informational) |
| `GET /api/rewards/eligibility` | Always `{eligible:false,status:"not_enabled"}` |
| `/api/admin/*`, `/api/wallet/*`, `/api/withdrawals/*` | `401` for everyone until auth exists (server-side gate) |

## Socket.IO (signaling only, max 32 KB messages)
Client→server (ack returns `{ok, ...}` or `{ok:false,error}`): `session:create` → `{code, expiresAt, iceServers}`; `session:join {code}` → `{iceServers}` (errors: `invalid`, `expired`, `full`, `self`, `rate_limited`, `busy`); `signal {type:'offer'|'answer'|'candidate', ...}` (validated, rebuilt from whitelisted fields); `session:leave`.
Server→client: `peer:joined`, `peer:left`, `signal`, `session:expired`.

## Data-channel protocol (`public/js/transfer.js`)
JSON control + binary chunks on one ordered channel: `manifest`, `accept`/`reject`, `file-start`, chunks, `file-end{sha256,size}`, `wnd{n}` (flow control), `file-ack`, `done`, `complete`, `cancel`, `error`. Success is declared only when the receiver sends `complete{ok:true}` after verifying size + SHA-256 of every file.
