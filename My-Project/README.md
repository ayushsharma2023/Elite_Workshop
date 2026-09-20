# Signal Editor

A real-time collaborative document editor built with React, Vite, Node.js, Express, Socket.IO, and PostgreSQL.

## Run locally

```powershell
cd My-Project
npm install
docker compose up -d postgres
npm run client:build
npm start
```

Open http://localhost:3000. For frontend development, run `npm run client:dev` in a second terminal and open http://localhost:5173.

## Features

- React responsive editor workspace
- Registration and login with hashed passwords and HTTP-only sessions
- PostgreSQL users, documents, revisions, and sessions
- Socket.IO document rooms with live updates and collaborator presence
- Shareable document links for signed-in collaborators
- Autosaved rich-text editing with basic formatting controls
- `/api/health` database health endpoint

Set `DATABASE_URL` or `PORT` in the environment to override local defaults.
