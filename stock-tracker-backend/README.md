# Stock Tracker Backend API

Node.js/Express backend for the Stock Tracker application with SQL Server database connectivity.

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Database

Edit `.env.local` with your SQL Server connection details:

```env
DB_SERVER=your-server.com
DB_USER=your-user
DB_PASSWORD=your-password
DB_NAME=your-db
```

### 3. Start Development Server

```bash
npm run dev
```

The API will start on `http://localhost:5000` and automatically create the required database tables.



## Authentication

Currently runs in development mode with `x-user-id` header or `Authorization: Bearer` token support.

For production, configure Auth0 domain and audience in `.env.local`:

```env
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_AUDIENCE=your-api-identifier
```

## Scripts

- `npm run dev` - Start development server with watch mode
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled server
- `npm run seed` - (Future) Seed database with sample data
# GitHub write access verified 2026-07-05T20:43:01Z
