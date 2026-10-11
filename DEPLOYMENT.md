# Box: API and account setup

## 1. Rotate the exposed MongoDB password

The database password previously shared in a prompt must be considered compromised. In MongoDB Atlas, create a new database password, remove the old one, and restrict Network Access to the deployment server where possible.

Never place `MONGODB_URI` in a `VITE_*` variable: Vite variables are bundled into the public browser code.

## 2. Server environment

Copy `.env.example` to a private `.env` file on the server and provide:

- `MONGODB_URI`: private Atlas connection string with the rotated password.
- `MONGODB_DB`: database name, normally `box`.
- `JWT_SECRET`: at least 32 random characters.
- `APP_ORIGINS`: comma-separated HTTPS origins allowed to call the API.
- `PORT`: API port, default `8787`.

After filling `.env`, start the complete site (React and API on the same port) with:

```sh
node server/index.mjs
```

Open `http://localhost:8787`. The server reads `.env` automatically using `dotenv` and in development embeds Vite, so a separate `npm run dev` process is not needed. Check `http://localhost:8787/api/health` for `{ "ok": true }`. If `MONGODB_URI` is missing or Atlas blocks the server IP, the process prints an actionable error and stops instead of silently serving a broken account screen.

For production, build the app, set `NODE_ENV=production`, and start the same server. It serves the built app from `dist/` and the API under the same origin. A static-only Vite preview or static hosting cannot serve MongoDB endpoints. If the frontend and API are deployed separately, configure `VITE_API_URL` to the deployed API base URL and allow the frontend origin in `APP_ORIGINS`.

## 3. Accounts and passwords

Registration and sign-in use email and password only. Account records, usernames, preferences, friends, match results, and avatar images live in MongoDB. Passwords are never stored in plaintext: the API hashes them with bcrypt (cost 12) before saving them in `users.passwordHash`. Sessions use a signed HTTP-only cookie.

There is no Google sign-in endpoint. Users who signed up through the previous Google integration and still have an active Box session can set their first password under Dashboard > Paramètres > Sécurité du compte. Users who have lost that session need an administrator-assisted identity-verification and migration process; never create a password from an unverified email alone. New email accounts can change their password there by supplying the existing one.

## 4. MongoDB data

Dynamic account data is stored in MongoDB:

- `users`: email, username, bcrypt password hash, language, game settings, privacy preferences, and aggregate stats.
- `friendships`: pending and accepted friend relationships.
- `matches`: authenticated match history.
- `avatars.files` and `avatars.chunks`: uploaded profile images through GridFS.

Room moves remain transient WebRTC data by design. Writing every move to MongoDB would add server round trips and increase gameplay latency. Completed matches are persisted.

## 5. Security expectations

- Deploy behind HTTPS; secure session cookies are enabled in production.
- Keep Atlas credentials and `JWT_SECRET` only in server environment variables.
- Restrict Atlas IP/network access and use a database user scoped only to the `box` database.
- Keep `APP_ORIGINS` limited to the actual site origins.
- Profile images are limited to JPG, PNG, or WebP and 3 MB.