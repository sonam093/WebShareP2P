# WebShareP2P — Direct Browser-to-Browser File Transfer

> MARS Open Projects 2026 | Web Development Problem Statement 2

A lightweight, decentralized P2P file sharing web app. Drop a file → get a Room ID → the receiver opens the link and downloads **directly from your browser**. The signaling server coordinates the connection handshake but **never reads, processes, or stores any part of the file data.**

---

## Live Demo

- **Frontend:** `https://p2p-webshare.vercel.app` *(deploy and update)*
- **Backend (Signaling):** `https://p2p-webshare-backend.onrender.com`

---

## Features (Core MVP)

| Feature | Status |
|---|---|
| Drag-and-drop file picker (≤ 50 MB) | ✅ |
| Unique Room ID generation | ✅ |
| Shareable room link (auto-fill on receiver side) | ✅ |
| WebRTC data channel — direct P2P transfer | ✅ |
| Real-time progress bar + transfer speed (MB/s) | ✅ |
| SHA-256 file integrity verification | ✅ |
| Auto-download on receiver side | ✅ |
| Graceful disconnect handling (peer-disconnected event) | ✅ |
| Mobile responsive UI | ✅ |

---

## Architecture

```
Sender Browser                 Signaling Server (Node.js)            Receiver Browser
     |                               |                                     |
     |── create-room ──────────────>|                                     |
     |<─ room-created (roomId) ──── |                                     |
     |                              |<──── join-room (roomId) ────────────|
     |<─ receiver-joined ─────────── |──── room-joined ──────────────────>|
     |                              |                                     |
     |── WebRTC Offer ─────────────>|──────────────────────────────────> |
     |<─ WebRTC Answer ──────────── |<─────────────────────────────────── |
     |<> ICE candidates ───────────>|<──────────────────────────────────> |
     |                              |                                     |
     |════════════ WebRTC Data Channel (P2P) ════════════════════════════>|
     |    [meta JSON: hash + size]  ·  [binary chunks 64KB each]         |
     |                              |                                     |
     (Signaling server is now out of the picture — file flows directly)
```

**The file never touches the server.** The signaling server only relays WebRTC SDP offers/answers and ICE candidates to bootstrap the peer connection.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Plain CSS (custom dark theme, no framework) |
| P2P Communication | WebRTC DataChannel (native browser API) |
| Backend / Signaling | Node.js + Express + Socket.io |
| File Integrity | Web Crypto API — SHA-256 |
| Hosting (Frontend) | Vercel |
| Hosting (Backend) | Render |

---

## How the Transfer Works

1. **Room Creation:** The sender drops a file. The frontend emits `create-room` to the signaling server with file metadata. The server returns a unique 8-character Room ID and stores sender's socket ID.

2. **Receiver Joins:** The receiver enters the Room ID (or clicks the share link). The server notifies the sender that a receiver is ready.

3. **WebRTC Handshake:** The sender creates a `RTCPeerConnection` and a data channel, generates an SDP offer, and sends it through the signaling server. The receiver sets the remote description, creates an answer, and returns it. ICE candidates are exchanged to traverse NATs.

4. **File Transfer:**
   - Sender computes the file's **SHA-256 hash** using the Web Crypto API.
   - Sends a JSON metadata frame: `{ type: "meta", hash, size, name }`.
   - Slices the file into **64 KB chunks** and sends them over the data channel using backpressure control (`bufferedAmount` check).
   - Receiver reassembles chunks into a `Blob`.
   - Receiver computes SHA-256 of the received blob and **compares with the sender's hash**.
   - If hashes match → verified ✅ → auto-download triggered.

5. **Disconnect Handling:** If either peer disconnects at any point, the signaling server detects it via `socket.on('disconnect')` and emits `peer-disconnected` to the remaining peer, which displays a graceful error message.

---

## Project Structure

```
p2p-webshare/
├── backend/
│   ├── server.js          # Signaling server (Express + Socket.io)
│   ├── package.json
│   └── render.yaml        # Render deployment config
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── main.jsx       # React entry point
│       ├── App.jsx        # All P2P logic + UI
│       └── index.css      # Styles
├── .gitignore
└── README.md
```

---

## Local Setup

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/p2p-webshare.git
cd p2p-webshare
```

### 2. Start the signaling backend

```bash
cd backend
npm install
npm start
# Server runs on http://localhost:4000
```

### 3. Start the frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # VITE_SIGNALING_URL=http://localhost:4000
npm run dev
# App runs on http://localhost:5173
```

### 4. Test a transfer

Open **two browser windows** (or two different browsers/devices on the same network):
- Window 1: Drop a file → copy the Room ID or share link.
- Window 2: Paste the Room ID → click Join → wait for the download.

---

## Deployment

### Backend → Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect this repo, set root to `backend/`.
3. Build: `npm install` | Start: `npm start`.
4. Note the deployed URL (e.g., `https://p2p-webshare-backend.onrender.com`).

### Frontend → Vercel

1. Import this repo on [Vercel](https://vercel.com).
2. Set root to `frontend/`.
3. Add environment variable: `VITE_SIGNALING_URL=https://YOUR_BACKEND.onrender.com`
4. Deploy.

---

## Security & Privacy

- The signaling server **never receives file data** — only WebRTC handshake messages (SDP + ICE candidates).
- File transfer happens over an **encrypted DTLS channel** (standard WebRTC).
- **SHA-256 hash verification** guarantees zero data corruption.
- Rooms are deleted from server memory immediately when either peer disconnects or 30 seconds after a completed transfer.

---

## Originality Notice

All code in this repository is original and written from scratch for MARS Open Projects 2026. Open-source libraries used (React, Socket.io, Vite) are used as tools only; all application logic, UI design, and WebRTC integration are custom implementations.

---

*MARS · Models and Robotics Section · Open Projects 2026*
