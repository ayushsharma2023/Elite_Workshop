const socket = io({ autoConnect: false });
const roomDescriptions = { general: 'The main room for the whole team.', random: 'Loose thoughts, links, and side quests.', design: 'A room for visual thinking and critique.', music: 'What is playing in your headphones?', single: 'A quieter space for a focused conversation.' };
let currentRoom = 'general';
let displayName = '';
let authMode = 'login';
let typingTimer;

const $ = (id) => document.getElementById(id);
const authModal = $('authModal');
const messageInput = $('messageInput');

function initials(name) { return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function timeOf(timestamp) { return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function setConnection(connected) { $('connectionDot').parentElement.classList.toggle('connected', connected); $('connectionText').textContent = connected ? 'Connected' : 'Reconnecting...'; }
function addMessage(message) {
  const group = document.createElement('article');
  group.className = 'message-group';
  group.innerHTML = `<div class="avatar" style="background:${message.color}">${initials(message.username)}</div><div class="message-body"><div class="message-meta"><span class="message-author">${escapeHtml(message.username)}</span><time class="message-time">${timeOf(message.timestamp)}</time></div><p class="message-text">${escapeHtml(message.text)}</p></div>`;
  $('messages').appendChild(group);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function addSystemMessage(message) { const item = document.createElement('div'); item.className = 'system-message'; item.textContent = message.text; $('messages').appendChild(item); $('messages').scrollTop = $('messages').scrollHeight; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function updateRoom(room) { currentRoom = room; $('roomTitle').textContent = room; $('roomDescription').textContent = roomDescriptions[room] || roomDescriptions.general; messageInput.placeholder = `Message #${room}`; document.querySelectorAll('.room-button').forEach((button) => button.classList.toggle('active', button.dataset.room === room)); $('messages').innerHTML = ''; }
function joinRoom(room) { updateRoom(room); socket.emit('join-room', { room }); }
function showAuthModal(mode = 'login') { authMode = mode; authModal.classList.remove('hidden'); $('authUsername').classList.toggle('register-field-visible', mode === 'register'); $('authUsername').required = mode === 'register'; $('authTitle').textContent = mode === 'register' ? 'Create your account' : 'Sign in to chat'; $('authSubtitle').textContent = mode === 'register' ? 'Create an account to connect with people.' : 'Use your account to join the conversation.'; $('authSubmit').innerHTML = `${mode === 'register' ? 'Create account' : 'Sign in'} <span>↗</span>`; $('authToggle').textContent = mode === 'register' ? 'Already have an account? Sign in' : 'Need an account? Create one'; $('authPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password'; $('authError').textContent = ''; setTimeout(() => $(mode === 'register' ? 'authUsername' : 'authEmail').focus(), 0); }

$('authToggle').addEventListener('click', () => showAuthModal(authMode === 'login' ? 'register' : 'login'));
$('authForm').addEventListener('submit', async (event) => { event.preventDefault(); $('authError').textContent = ''; const payload = { email: $('authEmail').value.trim(), password: $('authPassword').value }; if (authMode === 'register') payload.username = $('authUsername').value.trim(); try { const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Authentication failed.'); displayName = data.user.username; authModal.classList.add('hidden'); socket.connect(); } catch (error) { $('authError').textContent = error.message; } });
$('clearNameButton').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); socket.disconnect(); displayName = ''; showAuthModal('login'); });
document.querySelectorAll('.room-button').forEach((button) => button.addEventListener('click', () => joinRoom(button.dataset.room)));
$('messageForm').addEventListener('submit', (event) => { event.preventDefault(); const text = messageInput.value.trim(); if (!text || !socket.connected) return; socket.emit('send-message', { text }); messageInput.value = ''; $('charCount').textContent = '0/500'; socket.emit('typing', false); });
messageInput.addEventListener('input', () => { $('charCount').textContent = `${messageInput.value.length}/500`; socket.emit('typing', true); clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit('typing', false), 900); });

socket.on('connect', () => { setConnection(true); if (displayName) joinRoom(currentRoom); else showAuthModal('login'); });
socket.on('connect_error', (error) => { setConnection(false); if (error.message === 'Authentication required') showAuthModal('login'); });
socket.on('disconnect', () => setConnection(false));
socket.on('room-joined', ({ room }) => { updateRoom(room); addSystemMessage({ text: `You joined #${room}` }); });
socket.on('message-history', (messages) => { messages.forEach(addMessage); });
socket.on('new-message', addMessage);
socket.on('system-message', addSystemMessage);
socket.on('user-typing', ({ username, isTyping }) => { $('typingLine').textContent = isTyping ? `${username} is typing...` : ''; });
socket.on('room-members', (members) => { $('memberCount').textContent = members.length; $('memberList').innerHTML = ''; members.forEach((member) => { const item = document.createElement('div'); item.className = 'member'; item.innerHTML = `<div class="avatar" style="background:${member.color}">${initials(member.username)}</div><div><span class="member-name">${escapeHtml(member.username)}${member.username === displayName ? ' (you)' : ''}</span><span class="member-state">Active now</span></div>`; $('memberList').appendChild(item); }); });

fetch('/api/auth/me').then((response) => response.ok ? response.json() : Promise.reject()).then(({ user }) => { displayName = user.username; authModal.classList.add('hidden'); socket.connect(); }).catch(() => showAuthModal('login'));
