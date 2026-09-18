import React from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App socket={io({ autoConnect: false })} />);
