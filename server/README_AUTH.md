# Tambayan Talks - Auth upgrades (Teacher/Student roles, Email verification, Forgot/Reset password)

## What changed

### 1) Role choice (Teacher vs Student)
- Signup page now lets you pick **Student** or **Teacher**.
- **Teacher accounts are admin-only**:
  - Either create teachers through the **admin endpoint** (recommended):
    - `POST /api/admin/create-teacher` with `Authorization: Bearer <ADMIN_JWT>`
  - Or, enable one-time teacher creation on public signup by setting:
    - `ADMIN_CREATE_TEACHER_KEY=...` in `server/.env` and entering it on the signup form.

### 2) Email verification
- On signup, the server sends a verification link.
- Login is blocked until the email is verified (default).
- Client supports:
  - `#verify-email?token=...` link handling
  - Resend verification from login screen

### 3) Forgot / Reset password
- Client supports:
  - `#forgot-password`
  - `#reset-password?token=...`
- Server sends password reset link (valid for 1 hour).

> Note: For reliability, email verification + reset tokens are stored in two small SQLite tables (`UserAuth`, `AuthToken`) created automatically at runtime.

---

## Setup

### Server
```bash
cd server
npm install
npm run dev
```

Edit `server/.env`:
- `APP_BASE_URL=http://localhost:5173`
- `REQUIRE_EMAIL_VERIFICATION=true`
- Optional SMTP:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

If SMTP is not configured, the server will **print the verification/reset links to the console**.

### Client
```bash
cd client
npm install
npm run dev
```

---

## Demo admin user
Run this once to create demo accounts (Admin/Teacher/Student) and mark them as verified:

```bash
cd server
npx ts-node create-user.ts
```

Then login with:
- `demo.admin@example.com / demo-password`

