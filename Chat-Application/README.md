# Signal Editor

A real-time collaborative document editor with a React/Vite frontend, Node.js + Socket.IO backend, and PostgreSQL persistence.

## Run locally

```powershell
cd Chat-Application
docker compose up -d postgres
npm install
npm run client:build
npm start
```

Open `http://localhost:3000` to register, create documents, and collaborate. For frontend development, run `npm run client:dev` in a second terminal and open `http://localhost:5173`.

## Included

- React + Vite responsive workspace
- Express and Socket.IO document rooms
- PostgreSQL accounts, sessions, documents, and revisions
- Live collaborator presence and cursor updates
- Autosaved rich-text document content
- Password hashing and HttpOnly session cookies
- `/api/health` endpoint for a quick server check
