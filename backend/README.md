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
