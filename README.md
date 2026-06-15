# WebShareP2P — Direct Browser-to-Browser File Transfer

> MARS Open Projects 2026 | Web Development Problem Statement 2

A lightweight, decentralized peer-to-peer file sharing web application built with WebRTC. Drop a file, get a Room ID, and share it instantly. The receiver downloads the file **directly from your browser** without the file ever touching the server.

---

## Live Demo

**Frontend:** https://web-share-p2-p-beta.vercel.app/

**Signaling Server:** https://websharep2p-backend.onrender.com

---

## Features

| Feature                             | Status |
| ----------------------------------- | ------ |
| Drag-and-drop file picker (≤ 50 MB) | ✅      |
| Unique Room ID generation           | ✅      |
| Shareable room links                | ✅      |
| Direct browser-to-browser transfer  | ✅      |
| WebRTC Data Channel                 | ✅      |
| Real-time progress bar              | ✅      |
| Transfer speed indicator            | ✅      |
| SHA-256 file integrity verification | ✅      |
| Automatic file download             | ✅      |
| Graceful disconnect handling        | ✅      |
| Mobile responsive UI                | ✅      |

---

## Architecture

```text
Sender Browser                 Signaling Server (Node.js)            Receiver Browser
     |                               |                                     |
     |── create-room ──────────────>|                                     |
     |<─ room-created (roomId) ──── |                                     |
     |                              |<──── join-room (roomId) ────────────|
     |<─ receiver-joined ────────── |──── room-joined ──────────────────>|
     |                              |                                     |
     |── WebRTC Offer ─────────────>|───────────────────────────────────>|
     |<─ WebRTC Answer ──────────── |<───────────────────────────────────|
     |<> ICE Candidates ───────────>|<──────────────────────────────────>|
     |                              |                                     |
     |═══════════════ WebRTC Data Channel (P2P) ════════════════════════>|
     |     Metadata + Binary Chunks (64 KB each)                         |
     |                              |                                     |
     (Signaling server is no longer involved after connection setup)
```

**Important:** The signaling server only exchanges WebRTC offers, answers, and ICE candidates. The file itself is transferred directly between browsers and never passes through the server.

---

## Tech Stack

| Layer               | Technology                    |
| ------------------- | ----------------------------- |
| Frontend            | React 18 + Vite               |
| Styling             | Plain CSS                     |
| P2P Communication   | WebRTC DataChannel            |
| Backend / Signaling | Node.js + Express + Socket.io |
| File Integrity      | Web Crypto API (SHA-256)      |
| Hosting (Frontend)  | Vercel                        |
| Hosting (Backend)   | Render                        |

---

## How the Transfer Works

### 1. Room Creation

The sender selects a file.

The frontend emits:

```javascript
create-room
```

to the signaling server along with:

* File name
* File size
* File type

The server generates a unique 8-character Room ID and stores the sender's socket ID.

---

### 2. Receiver Joins

The receiver:

* Enters the Room ID, or
* Opens the shared link.

The signaling server:

* Adds the receiver to the room
* Sends `receiver-joined` to the sender.

---

### 3. WebRTC Handshake

The sender:

* Creates an `RTCPeerConnection`
* Creates a `RTCDataChannel`
* Generates an SDP Offer
* Sends it through Socket.io

The receiver:

* Sets the remote description
* Generates an SDP Answer
* Sends it back

Both peers exchange ICE candidates to establish the connection.

---

### 4. File Transfer

The sender:

* Computes SHA-256 hash of the file
* Sends metadata:

```javascript
{
  type: "meta",
  hash,
  size,
  name
}
```

* Splits the file into 64 KB chunks
* Sends chunks through the WebRTC Data Channel.

The receiver:

* Reassembles chunks into a Blob
* Computes SHA-256 of the received file
* Compares hashes

If hashes match:

✅ File integrity verified

✅ Download automatically starts

---

### 5. Disconnect Handling

If either peer disconnects:

* The signaling server emits:

```javascript
peer-disconnected
```

* The remaining peer receives a graceful error message.
* The room is removed from server memory.

---

## Project Structure

```text
WebShareP2P/
├── backend/
│   ├── server.js
│   ├── package.json
│   └── render.yaml
│
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       └── index.css
│
├── .gitignore
└── README.md
```

---

## Local Setup

### Prerequisites

* Node.js ≥ 18
* npm ≥ 9

---

### Clone the Repository

```bash
git clone https://github.com/sonam093/WebShareP2P

cd WebShareP2P
```

---

### Start the Backend

```bash
cd backend

npm install

npm start
```

Backend runs on:

```text
http://localhost:4000
```

---

### Start the Frontend

```bash
cd frontend

npm install

npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

---

### Test a Transfer

Open:

* Two browser windows, or
* Two different devices.

**Sender**

1. Select a file.
2. Share the Room ID.

**Receiver**

1. Enter the Room ID.
2. Click Join.
3. Download begins automatically after verification.

---

## Deployment

### Backend — Render

1. Create a new Web Service on Render.
2. Connect this repository.
3. Set Root Directory:

```text
backend
```

4. Build Command:

```text
npm install
```

5. Start Command:

```text
npm start
```

---

### Frontend — Vercel

1. Import the repository.
2. Set Root Directory:

```text
frontend
```

3. Add environment variable:

```env
VITE_SIGNALING_URL=https://p2p-webshare-backend.onrender.com
```

4. Deploy.

---

## Security & Privacy

* File data never reaches the server.
* Only SDP offers, answers, and ICE candidates are exchanged through Socket.io.
* WebRTC uses encrypted DTLS transport.
* SHA-256 verification guarantees file integrity.
* Rooms are automatically deleted after disconnect or after transfer completion.

---

## Originality Notice

This project was built from scratch for **MARS Open Projects 2026**.

React, Socket.io, and Vite are used as development tools only. All application logic, UI design, WebRTC integration, room management, and file transfer logic are custom implementations.

---

**MARS · Models and Robotics Section · Open Projects 2026**
