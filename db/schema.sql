-- CP Share production schema (PostgreSQL 14+). DRAFT for Phase 3-5: NOT applied or tested by Phase 1.
-- Money is stored as integer kobo (NGN minor units). The server computes every amount from reward_rules.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email citext UNIQUE NOT NULL, email_verified_at timestamptz,
  password_hash text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
); -- password_hash from a proven library (argon2id) or an identity provider; never plaintext
CREATE TABLE user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE devices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users ON DELETE SET NULL, label text, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz);
CREATE TABLE transfer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_user_id uuid REFERENCES users, receiver_user_id uuid REFERENCES users,
  sender_device_id uuid REFERENCES devices, receiver_device_id uuid REFERENCES devices,
  status text NOT NULL CHECK (status IN ('paired','transferring','completed','failed','cancelled','rejected')),
  receiver_confirmed_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE TABLE transfer_files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_id uuid NOT NULL REFERENCES transfer_sessions ON DELETE CASCADE, category text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes >= 0), sha256 char(64), verified boolean NOT NULL DEFAULT false);
CREATE TABLE transfer_events (id bigserial PRIMARY KEY, transfer_id uuid NOT NULL REFERENCES transfer_sessions ON DELETE CASCADE, kind text NOT NULL, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reward_rules (id serial PRIMARY KEY, category text NOT NULL, required_quantity int NOT NULL CHECK (required_quantity > 0), reward_kobo bigint NOT NULL CHECK (reward_kobo >= 0), max_file_bytes bigint, daily_limit int, monthly_limit int, repeat_allowed boolean NOT NULL DEFAULT false, expires_after interval, active boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users, transfer_id uuid NOT NULL REFERENCES transfer_sessions, rule_id int NOT NULL REFERENCES reward_rules,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','expired')), amount_kobo bigint NOT NULL, idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (transfer_id, rule_id)
);
CREATE TABLE ad_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES reward_claims, provider text NOT NULL, provider_ref text, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ad_verification_events (id bigserial PRIMARY KEY, ad_session_id uuid REFERENCES ad_sessions, provider_event_id text NOT NULL, payload jsonb NOT NULL, signature_valid boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE (provider_event_id)); -- replay protection
CREATE TABLE wallet_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES users, currency char(3) NOT NULL DEFAULT 'NGN');
CREATE TABLE wallet_ledger_entries (
  id bigserial PRIMARY KEY, wallet_id uuid NOT NULL REFERENCES wallet_accounts, kind text NOT NULL CHECK (kind IN ('reward_credit','withdrawal_reserve','withdrawal_release','withdrawal_paid','adjustment')),
  amount_kobo bigint NOT NULL, ref_type text, ref_id text, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
); -- append-only; balance = SUM(amount_kobo); never UPDATE/DELETE
CREATE TABLE withdrawal_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text UNIQUE NOT NULL, user_id uuid NOT NULL REFERENCES users, amount_kobo bigint NOT NULL CHECK (amount_kobo > 0), status text NOT NULL CHECK (status IN ('pending','processing','paid','failed','reversed')), method jsonb NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE payment_events (id bigserial PRIMARY KEY, withdrawal_id uuid REFERENCES withdrawal_requests, provider text NOT NULL, provider_event_id text NOT NULL, payload jsonb NOT NULL, signature_valid boolean NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), UNIQUE (provider, provider_event_id)); -- duplicate webhooks are no-ops
CREATE TABLE admin_users (user_id uuid PRIMARY KEY REFERENCES users, role text NOT NULL CHECK (role IN ('support','finance','admin')), mfa_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE audit_logs (id bigserial PRIMARY KEY, actor_user_id uuid, action text NOT NULL, target_type text, target_id text, reason text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users, subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX ON user_sessions (user_id); CREATE INDEX ON transfer_sessions (sender_user_id, started_at DESC); CREATE INDEX ON transfer_files (transfer_id);
CREATE INDEX ON reward_claims (user_id, created_at DESC); CREATE INDEX ON wallet_ledger_entries (wallet_id, created_at); CREATE INDEX ON withdrawal_requests (user_id, status);
CREATE INDEX ON audit_logs (actor_user_id, created_at DESC);
