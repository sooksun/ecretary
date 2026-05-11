# Secret rotation runbook

Every secret in `.env.production` should be rotated:
- **proactively** on a schedule (quarterly is a reasonable default), and
- **reactively** the moment any of these is true: laptop stolen, key found in a screen-share recording, suspected leak in logs/Slack/PR, employee departure, or `npm audit` reports a compromise of a dependency that handled the secret.

Each section below lists the **blast radius**, **expected downtime**, and the **exact steps**. Steps assume you `cd` to `m-secretary/` on the host running `docker compose --profile app up -d`.

---

## ANTHROPIC_API_KEY

**Blast radius:** all summarize jobs.
**Downtime:** none (workers retry the in-flight job after restart; new jobs queue).

1. Generate a new key in the Anthropic console.
2. Edit `.env.production` → set `ANTHROPIC_API_KEY=<new>`.
3. `docker compose --profile app restart worker`. Worker preflight runs the 1-token live ping at boot; if the key is bad it exits non-zero and you know immediately.
4. Confirm in the Anthropic console: a fresh `messages.create` ping should appear within seconds.
5. **Revoke the old key** in the Anthropic console (do this AFTER step 4 confirms the new one works — you can't roll back to a key you've already revoked).

---

## JWT_SECRET (graceful, no forced re-login)

**Blast radius:** every issued bearer token.
**Downtime:** none. Without the graceful pattern below, every active mobile session would be logged out at the next request.

1. Generate the new secret: `openssl rand -hex 64`. Copy it.
2. Edit `.env.production`:
   ```
   JWT_PREVIOUS_SECRETS=<the OLD JWT_SECRET value, before this rotation>
   JWT_SECRET=<new value from step 1>
   ```
3. `docker compose --profile app restart api`. New tokens are now signed with the new secret; tokens signed with the old secret continue to verify (`JwtAuthGuard.verifyWithRotation`) and emit a `WARN` log per use.
4. Wait at least `JWT_EXPIRES_IN` (default `7d`) so all old tokens have expired. Watch for the `auth: token verified by a PREVIOUS secret` warn lines to taper to zero.
5. Edit `.env.production` again: remove `JWT_PREVIOUS_SECRETS`. `docker compose --profile app restart api`.

For an **emergency** rotation (suspected token theft) skip the graceful path: rotate `JWT_SECRET` only, restart, accept that all users must log in again.

---

## SEED_PASSWORD / admin user password

**Blast radius:** the `admin@msecretary.local` user.
**Downtime:** none.

1. `openssl rand -base64 24`  → copy the output.
2. From the host:
   ```bash
   DATABASE_URL='postgresql://msec_app:.../msecretary_prod?schema=public' \
     SEED_PASSWORD='<new>' \
     npm --workspace @msec/api run prisma:seed
   ```
   The seed script `upsert`s the admin row, replacing the bcrypt hash.
3. Tell whoever has the admin login the new password (out-of-band — Signal/1Password, never the same channel where the old one lived).
4. Existing JWT tokens for the admin user remain valid until `JWT_EXPIRES_IN`. To force immediate logout, rotate `JWT_SECRET` per the above (without the graceful previous-secret window).

---

## DATABASE password (msec_app role)

**Blast radius:** API + worker DB connections.
**Downtime:** ~10 seconds while the api/worker containers restart.

1. As Postgres superuser:
   ```sql
   ALTER USER msec_app WITH PASSWORD '<new>';
   ```
2. Edit `.env.production` → update the password segment of `DATABASE_URL`.
3. `docker compose --profile app restart api worker`. Both connect on the new password; preflight on the worker confirms reachability.

---

## MinIO credentials (S3_ACCESS_KEY / S3_SECRET_KEY / MINIO_ROOT_PASSWORD)

**Blast radius:** every chunk upload, every export download, every backup script.
**Downtime:** ~30 seconds (MinIO restart + reconnect).

1. Pick new strong credentials. The two-pair distinction matters:
   - `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` — used to bootstrap MinIO and (in this stack) also as the app's S3 access — keep the same values for both pairs unless you split them out into a non-root MinIO user.
2. Edit `.env.production`:
   ```
   MINIO_ROOT_USER=...
   MINIO_ROOT_PASSWORD=<new>
   S3_ACCESS_KEY=...
   S3_SECRET_KEY=<new>
   ```
3. `docker compose --profile app down minio api worker && docker compose --profile app up -d minio api worker` (taking minio down briefly is required — restarting it alone won't re-read the root password env var if the volume already initialized).
4. Re-issue any pre-signed download URLs older than the moment of step 3 — they were signed against the old key and will now 403. The mobile app re-creates them on demand via `POST /meetings/:id/exports` so this is usually invisible to users.
5. Also rotate the `mc alias set` credentials used by `scripts/backup-minio.sh` on the backup host.

---

## ALERT_WEBHOOK_URL

**Blast radius:** alert delivery only — never affects pipeline correctness.
**Downtime:** zero.

1. Revoke the old webhook in Slack/Discord (channel admin → integrations → delete).
2. Create a new webhook, copy the URL.
3. Edit `.env.production` → `ALERT_WEBHOOK_URL=<new>`.
4. `docker compose --profile app restart worker`.
5. Trigger a test alert: temporarily make whisper unreachable, kick a meeting through, watch the Slack/Discord channel.

---

## ACME_EMAIL / Let's Encrypt cert renewal

**Blast radius:** TLS for the public hostnames.
**Downtime:** zero (Caddy renews 30 days before expiry, in the background).

The certs auto-renew. Only rotate ACME_EMAIL if the address is no longer monitored — Let's Encrypt sends "expiring soon" mail to it if renewal fails. If you change the email, just edit `.env.production` and `docker compose --profile prod restart caddy`.

---

## Generic checklist (use this for any secret not listed above)

- [ ] Generate the new value (entropy ≥ 32 bytes for keys, ≥ 16 chars for passwords)
- [ ] Determine if the system supports a "verify both during transition" pattern (JWT yes, most others no)
- [ ] Update `.env.production` on the host
- [ ] `docker compose --profile app restart <only-the-services-that-use-it>`
- [ ] Verify the new value works (login, signed URL fetch, alert ping, etc.)
- [ ] **Then** revoke / drop the old value
- [ ] Note the rotation in your team's audit log so the next rotation knows the previous timestamp

If you find any secret in this repo's git history (use `git log -p -S 'sk-ant-' -- .` style searches), assume it's compromised and rotate immediately — git history is forever.
