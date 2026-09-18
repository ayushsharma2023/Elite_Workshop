const path = require('path');
const fs = require('fs');
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || true, credentials: true } });
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/signal_editor';
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
const clientDist = path.join(__dirname, 'client', 'dist');
const presence = new Map();

const schema = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username VARCHAR(24) UNIQUE NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL, password_hash TEXT NOT NULL, color TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title VARCHAR(120) NOT NULL,
    content TEXT NOT NULL DEFAULT '', owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS revisions (
    id BIGSERIAL PRIMARY KEY, document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL, edited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS revisions_document_idx ON revisions(document_id, created_at DESC);
`;

app.use(express.json({ limit: '200kb' }));
if (fs.existsSync(clientDist)) app.use(express.static(clientDist));

function cleanText(value, maxLength = 500) { return String(value || '').trim().slice(0, maxLength); }
function validId(value) { return /^[0-9a-f-]{36}$/i.test(value || ''); }
function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, stored) { const [salt, hash] = stored.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function cookies(header = '') { return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key, value]) => key && value)); }
function tokenFromRequest(req) { return cookies(req.headers.cookie).signal_session; }
function publicUser(user) { return { id: user.id, username: user.username, email: user.email, color: user.color }; }
function setSessionCookie(res, token) { res.setHeader('Set-Cookie', `signal_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`); }
async function userFromToken(token) { if (!token) return null; const { rows } = await pool.query('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > NOW()', [token]); return rows[0] || null; }
async function authRequired(req, res, next) { const user = await userFromToken(tokenFromRequest(req)); if (!user) return res.status(401).json({ error: 'Authentication required.' }); req.user = user; next(); }
async function createSession(userId) { const token = randomBytes(32).toString('hex'); await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [token, userId]); return token; }

app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'postgresql', connected: io.engine.clientsCount }); } catch { res.status(503).json({ status: 'error', database: 'postgresql' }); } });
app.post('/api/auth/register', async (req, res) => {
  const username = cleanText(req.body?.username, 24); const email = cleanText(req.body?.email, 120).toLowerCase(); const password = String(req.body?.password || '');
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-24 letters, numbers, underscores, or hyphens.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const color = `hsl(${Math.abs([...username].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360} 55% 58%)`;
  try { const { rows } = await pool.query('INSERT INTO users (username, email, password_hash, color) VALUES ($1, $2, $3, $4) RETURNING *', [username, email, hashPassword(password), color]); const user = rows[0]; setSessionCookie(res, await createSession(user.id)); res.status(201).json({ user: publicUser(user) }); }
  catch (error) { res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That username or email is already registered.' : 'Could not create account.' }); }
});
app.post('/api/auth/login', async (req, res) => { const email = cleanText(req.body?.email, 120).toLowerCase(); const password = String(req.body?.password || ''); const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]); const user = rows[0]; if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect.' }); setSessionCookie(res, await createSession(user.id)); res.json({ user: publicUser(user) }); });
app.get('/api/auth/me', async (req, res) => { const user = await userFromToken(tokenFromRequest(req)); if (!user) return res.status(401).json({ error: 'Not signed in.' }); res.json({ user: publicUser(user) }); });
app.post('/api/auth/logout', async (req, res) => { const token = tokenFromRequest(req); if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]); res.setHeader('Set-Cookie', 'signal_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ ok: true }); });

app.get('/api/documents', authRequired, async (req, res) => { const { rows } = await pool.query('SELECT id, title, updated_at AS "updatedAt" FROM documents WHERE owner_id = $1 ORDER BY updated_at DESC', [req.user.id]); res.json({ documents: rows }); });
app.post('/api/documents', authRequired, async (req, res) => { const title = cleanText(req.body?.title, 120) || 'Untitled document'; const { rows } = await pool.query('INSERT INTO documents (title, owner_id) VALUES ($1, $2) RETURNING id, title, content, updated_at AS "updatedAt"', [title, req.user.id]); res.status(201).json({ document: rows[0] }); });
app.get('/api/documents/:id', authRequired, async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid document id.' }); const { rows } = await pool.query('SELECT id, title, content, updated_at AS "updatedAt" FROM documents WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]); if (!rows[0]) return res.status(404).json({ error: 'Document not found.' }); res.json({ document: rows[0] }); });
app.patch('/api/documents/:id', authRequired, async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid document id.' }); const title = cleanText(req.body?.title, 120); if (!title) return res.status(400).json({ error: 'Title is required.' }); const { rows } = await pool.query('UPDATE documents SET title = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3 RETURNING id, title, content, updated_at AS "updatedAt"', [title, req.params.id, req.user.id]); if (!rows[0]) return res.status(404).json({ error: 'Document not found.' }); res.json({ document: rows[0] }); });

io.use(async (socket, next) => { try { const user = await userFromToken(socket.handshake.auth?.session || cookies(socket.handshake.headers.cookie).signal_session); if (!user) return next(new Error('Authentication required')); socket.data.user = user; next(); } catch (error) { next(error); } });
io.on('connection', (socket) => {
  socket.on('open-document', async (documentId) => {
    if (!validId(documentId)) return;
    const { rows } = await pool.query('SELECT id, title, content, updated_at AS "updatedAt" FROM documents WHERE id = $1 AND owner_id = $2', [documentId, socket.data.user.id]);
    if (!rows[0]) return socket.emit('editor-error', 'Document not found.');
    if (socket.data.documentRoom) socket.leave(socket.data.documentRoom);
    const room = `document:${documentId}`; socket.data.documentRoom = room; socket.join(room);
    if (!presence.has(room)) presence.set(room, new Map()); presence.get(room).set(socket.id, { id: socket.data.user.id, username: socket.data.user.username, color: socket.data.user.color, cursor: null });
    socket.emit('document-loaded', rows[0]); io.to(room).emit('presence-updated', [...presence.get(room).values()]);
  });
  socket.on('edit-document', async ({ documentId, title, content } = {}) => { if (!validId(documentId) || socket.data.documentRoom !== `document:${documentId}`) return; const safeContent = String(content || '').slice(0, 200000); const safeTitle = cleanText(title, 120) || 'Untitled document'; await pool.query('UPDATE documents SET title = $1, content = $2, updated_at = NOW() WHERE id = $3 AND owner_id = $4', [safeTitle, safeContent, documentId, socket.data.user.id]); await pool.query('INSERT INTO revisions (document_id, content, edited_by) VALUES ($1, $2, $3)', [documentId, safeContent, socket.data.user.id]); socket.to(socket.data.documentRoom).emit('document-updated', { title: safeTitle, content: safeContent, updatedAt: new Date().toISOString(), userId: socket.data.user.id }); socket.emit('document-saved', { updatedAt: new Date().toISOString() }); });
  socket.on('cursor-update', (cursor) => { const room = socket.data.documentRoom; if (!room || !presence.has(room)) return; const member = presence.get(room).get(socket.id); if (member) member.cursor = cursor; socket.to(room).emit('cursor-updated', { userId: socket.data.user.id, username: socket.data.user.username, color: socket.data.user.color, cursor }); });
  socket.on('disconnect', () => { const room = socket.data.documentRoom; if (!room || !presence.has(room)) return; presence.get(room).delete(socket.id); io.to(room).emit('presence-updated', [...presence.get(room).values()]); });
});

app.get('*', (_req, res) => { const index = path.join(clientDist, 'index.html'); if (fs.existsSync(index)) return res.sendFile(index); res.status(404).send('Build the React client with npm run client:build.'); });

async function start() { await pool.query(schema); server.listen(PORT, () => console.log(`Signal Editor running at http://localhost:${PORT}`)); }
start().catch((error) => { console.error('Could not connect to PostgreSQL:', error.message); process.exit(1); });
