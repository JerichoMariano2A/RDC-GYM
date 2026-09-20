# RDC GYM Backend

Minimal Express backend with JWT auth and role middleware.

Quick start:

1. Copy `.env.example` to `.env` and set DB credentials and `JWT_SECRET`.
2. Install dependencies:

```bash
cd backend
npm install
```

3. Seed admin user (will create `users` table if needed):

```bash
npm run seed:admin
```

4. Start server:

```bash
npm start
```

Endpoints:
- `POST /auth/login` - { username, password } -> returns `{ token, role }`
- protected routes: `/dashboard`, `/admin`, `/staff`

## ESP32 door integration

The door access controller (ESP32 + single R307 + buzzer + relay/solenoid lock) talks to the
backend over HTTP. See `esp32/RDC_Door/README.md` for firmware, wiring and flashing.

> **Demo scope:** a single R307 lives on the ESP32 at the door. There is **no** desk reader and
> **no** USB-serial desk enrollment. Enrollment is queued from the web app and performed on the
> door sensor. A valid scan **unlocks the door only** — no check-in/check-out or visit logging.

Env vars:
- `ESP_SECRET` — shared key the ESP32 uses (sent in the `x-esp-secret` header or `secret` body
  field). Must match the value in `esp32/RDC_Door/config.h`. Defaults to `BIOMETRIC_SECRET` then
  `rdc_esp_secret`.

ESP endpoints (LAN only, guarded by `ESP_SECRET`):
- `POST /esp/scan` — ESP32 reports a matched fingerprint id; backend answers
  `{ granted, action: 'unlock'|'denied'|'expired', message, member }` for the matching active,
  non-expired member. Unlock only — no records written.
- `POST /esp/enroll-request` — JWT-protected (admin/staff). Called by the web app to queue a
  member for door enrollment. Creates a `pending` job in `door_enroll_jobs`.
- `GET /esp/enroll-job` — ESP32 polls this; claims the next `pending` job (marks it `claimed`)
  and returns `{ job: { memberId, name } }`. Header: `x-esp-secret`.
- `POST /esp/enroll-result` — ESP32 reports enrollment success/failure; on success sets the
  member's `fingerprint_id = member_id` and marks the job `done`. Header: `x-esp-secret`.
- `GET /esp/status` — health check. Header: `x-esp-secret`.

Enrollment flow: staff click **Enroll FP** on the **Memberships** page → `POST /esp/enroll-request`
queues the member → the ESP32 picks it up, captures the finger on the door's R307 (stored at
**slot = member id**), and posts the result.

