# Replit Setup

This project has a backend and a frontend.

## 1. Configure Secrets/Env

Use Replit Secrets (or local env files) for backend values:

- DB_SERVER
- DB_USER
- DB_PASSWORD
- DB_NAME
- PORT (optional, default 5000)
- FRONTEND_URL (optional, default http://localhost:5173)

## 2. Install Dependencies

```bash
npm --prefix stock-tracker-backend install
npm --prefix stock-tracker-frontend install
```

## 3. Run Backend

```bash
npm --prefix stock-tracker-backend run dev
```

## 4. Run Frontend

```bash
npm --prefix stock-tracker-frontend run dev -- --host 0.0.0.0 --port 5173
```

## 5. Useful Replit Workflows

- Backend Dev
- Frontend Dev
- Install All

## Notes

- The frontend currently uses `VITE_API_BASE_URL` and defaults to `http://localhost:5000`.
- Backend tests load `.env.test` when running with Vitest setup.
