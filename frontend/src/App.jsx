import { useState, useRef, useCallback, useEffect } from "react";
import { io } from "socket.io-client";

// ── Config ────────────────────────────────────────────────────────────────────
const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";
const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

async function hashBuffer(buffer) {
  const hashBuf = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Icons (inline SVG) ────────────────────────────────────────────────────────
const Icon = {
  upload: (
    <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  download: (
    <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
  link: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  check: (
    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  x: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  shield: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  ),
};

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState(null); // "send" | "receive"
  const [status, setStatus] = useState("idle"); // idle|connecting|waiting|ready|transferring|done|error
  const [roomId, setRoomId] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [fileInfo, setFileInfo] = useState(null);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [drag, setDrag] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState(null); // null|"ok"|"fail"
  const [senderHash, setSenderHash] = useState("");

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const fileRef = useRef(null);
  const channelRef = useRef(null);
  const roomRef = useRef("");
  const chunksRef = useRef([]);
  const bytesRef = useRef(0);
  const startTimeRef = useRef(null);
  const speedIntervalRef = useRef(null);
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(null);
  const receivedHashRef = useRef("");

  // ── Teardown ───────────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    clearInterval(speedIntervalRef.current);
    if (channelRef.current) { try { channelRef.current.close(); } catch (_) {} }
    if (pcRef.current) { try { pcRef.current.close(); } catch (_) {} }
    if (socketRef.current) { socketRef.current.disconnect(); }
    channelRef.current = null;
    pcRef.current = null;
    socketRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── Socket setup ───────────────────────────────────────────────────────────
  const connectSocket = useCallback(() => {
    const socket = io(SIGNALING_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect_error", () => {
      setError("Cannot reach signaling server. Make sure the backend is running.");
      setStatus("error");
    });

    socket.on("error", ({ message }) => {
      setError(message);
      setStatus("error");
    });

    socket.on("peer-disconnected", () => {
      setError("The other peer disconnected.");
      setStatus("error");
      teardown();
    });

    return socket;
  }, [teardown]);

  // ── WebRTC helpers ─────────────────────────────────────────────────────────
  const createPeerConnection = useCallback((roomId, isSender) => {
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current) {
        socketRef.current.emit("ice-candidate", { roomId, candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setStatus("ready");
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        if (status !== "done") {
          setError("Connection lost.");
          setStatus("error");
        }
      }
    };

    return pc;
  }, [status]);

  // ── SEND side ──────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Max size is ${formatSize(MAX_FILE_SIZE)}.`);
      return;
    }
    setError("");
    fileRef.current = file;
    setFileInfo({ name: file.name, size: file.size, type: file.type });
    setMode("send");
    setStatus("connecting");

    const socket = connectSocket();

    socket.on("connect", () => {
      socket.emit("create-room", { fileName: file.name, fileSize: file.size, fileType: file.type });
    });

    socket.on("room-created", ({ roomId }) => {
      setRoomId(roomId);
      roomRef.current = roomId;
      setStatus("waiting");
    });

    socket.on("receiver-joined", async () => {
      const currentRoomId = roomRef.current;
      if (!currentRoomId) {
        setError("Failed to determine room ID.");
        setStatus("error");
        return;
      }

      setStatus("connecting");
      const pc = createPeerConnection(currentRoomId, true);

      // Set up data channel
      const channel = pc.createDataChannel("file-transfer", { ordered: true });
      channelRef.current = channel;

      channel.onopen = () => sendFile(channel, currentRoomId);
      channel.onerror = (e) => { setError("Data channel error."); setStatus("error"); };

      // Handle ICE from receiver
      socket.on("ice-candidate", ({ candidate }) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      });

      socket.on("answer", ({ answer }) => {
        pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(() => {});
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { roomId: currentRoomId, offer });
    });
  }, [connectSocket, createPeerConnection]);

  const sendFile = useCallback(async (channel, roomId) => {
    const file = fileRef.current;
    if (!file) return;

    setStatus("transferring");
    startTimeRef.current = Date.now();
    lastTimeRef.current = Date.now();
    lastBytesRef.current = 0;

    // Compute hash first
    const buffer = await file.arrayBuffer();
    const hash = await hashBuffer(buffer);
    setSenderHash(hash);

    // Send metadata first (hash + size)
    channel.send(JSON.stringify({ type: "meta", hash, size: file.size, name: file.name }));

    speedIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTimeRef.current) / 1000;
      const bytes = bytesRef.current - lastBytesRef.current;
      setSpeed(bytes / elapsed);
      lastBytesRef.current = bytesRef.current;
      lastTimeRef.current = now;
    }, 500);

    let offset = 0;
    const uint8 = new Uint8Array(buffer);

    const sendChunk = () => {
      while (offset < file.size) {
        if (channel.bufferedAmount > 8 * 1024 * 1024) {
          channel.onbufferedamountlow = sendChunk;
          channel.bufferedAmountLowThreshold = 4 * 1024 * 1024;
          return;
        }
        const slice = uint8.slice(offset, offset + CHUNK_SIZE);
        channel.send(slice.buffer);
        offset += slice.byteLength;
        bytesRef.current = offset;
        setProgress(Math.round((offset / file.size) * 100));
      }

      clearInterval(speedIntervalRef.current);
      setSpeed(0);
      setStatus("done");
      socketRef.current?.emit("transfer-complete", { roomId });
    };

    sendChunk();
  }, []);

  // ── RECEIVE side ──────────────────────────────────────────────────────────
  const handleJoinRoom = useCallback(async () => {
    const id = joinInput.trim().toUpperCase();
    if (!id) return;
    setError("");
    setMode("receive");
    setStatus("connecting");

    const socket = connectSocket();

    socket.on("connect", () => {
      socket.emit("join-room", { roomId: id });
    });

    socket.on("room-joined", ({ fileName, fileSize, fileType }) => {
      setRoomId(id);
      setFileInfo({ name: fileName, size: fileSize, type: fileType });
      setStatus("waiting");
    });

    socket.on("offer", async ({ offer }) => {
      const pc = createPeerConnection(id, false);

      socket.on("ice-candidate", ({ candidate }) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      });

      pc.ondatachannel = ({ channel }) => {
        channelRef.current = channel;
        let meta = null;
        chunksRef.current = [];
        bytesRef.current = 0;
        startTimeRef.current = Date.now();
        lastTimeRef.current = Date.now();
        lastBytesRef.current = 0;

        speedIntervalRef.current = setInterval(() => {
          const now = Date.now();
          const elapsed = (now - lastTimeRef.current) / 1000;
          const bytes = bytesRef.current - lastBytesRef.current;
          setSpeed(bytes / elapsed);
          lastBytesRef.current = bytesRef.current;
          lastTimeRef.current = now;
        }, 500);

        setStatus("transferring");

        channel.onmessage = async ({ data }) => {
          if (typeof data === "string") {
            meta = JSON.parse(data);
            receivedHashRef.current = meta.hash;
            return;
          }
          chunksRef.current.push(data);
          bytesRef.current += data.byteLength;
          if (meta) setProgress(Math.round((bytesRef.current / meta.size) * 100));

          if (meta && bytesRef.current >= meta.size) {
            clearInterval(speedIntervalRef.current);
            setSpeed(0);
            // Reassemble
            const blob = new Blob(chunksRef.current);
            const fullBuffer = await blob.arrayBuffer();
            const hash = await hashBuffer(fullBuffer);

            if (hash === receivedHashRef.current) {
              setVerifyStatus("ok");
            } else {
              setVerifyStatus("fail");
            }

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = meta.name;
            a.click();
            URL.revokeObjectURL(url);

            setStatus("done");
            chunksRef.current = [];
          }
        };
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { roomId: id, answer });
    });
  }, [joinInput, connectSocket, createPeerConnection]);

  // ── Share link ─────────────────────────────────────────────────────────────
  const shareLink = `${window.location.origin}?room=${roomId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Auto-fill room from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) setJoinInput(room);
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e) => { e.preventDefault(); setDrag(true); };
  const onDragLeave = () => setDrag(false);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = () => {
    teardown();
    setMode(null);
    setStatus("idle");
    setRoomId("");
    setJoinInput("");
    setFileInfo(null);
    setProgress(0);
    setSpeed(0);
    setError("");
    setCopied(false);
    setVerifyStatus(null);
    setSenderHash("");
    chunksRef.current = [];
    bytesRef.current = 0;
    fileRef.current = null;
    window.history.replaceState({}, "", window.location.pathname);
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-icon">⇄</span>
          <span className="logo-text">WebShare<span className="logo-accent">P2P</span></span>
        </div>
        <div className="header-badge">
          {Icon.shield}
          <span>No server stores your file</span>
        </div>
      </header>

      <main className="main">
        {status === "idle" && !mode && (
          <div className="landing">
            <div className="hero">
              <h1 className="hero-title">Drop it.<br />Share it.<br /><span className="accent">Instantly.</span></h1>
              <p className="hero-sub">Direct browser-to-browser file transfer. Your file never touches a server.</p>
            </div>

            <div className="cards">
              {/* Send card */}
              <div
                className={`card send-card ${drag ? "drag-over" : ""}`}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
              >
                <div className="card-icon">{Icon.upload}</div>
                <h2>Send a file</h2>
                <p>Drag & drop below or click to pick</p>
                <label className="file-label">
                  <input type="file" onChange={(e) => handleFile(e.target.files[0])} hidden />
                  Choose file
                </label>
                <span className="limit-note">Max 50 MB</span>
              </div>

              {/* Receive card */}
              <div className="card receive-card">
                <div className="card-icon">{Icon.download}</div>
                <h2>Receive a file</h2>
                <p>Enter the Room ID shared by the sender</p>
                <div className="join-row">
                  <input
                    className="room-input"
                    placeholder="Room ID e.g. A1B2C3D4"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                  />
                  <button className="btn btn-primary" onClick={handleJoinRoom}>Join</button>
                </div>
              </div>
            </div>

            <div className="how">
              <div className="how-step"><span className="how-num">1</span><span>Drop or pick your file</span></div>
              <div className="how-arrow">→</div>
              <div className="how-step"><span className="how-num">2</span><span>Share the Room ID</span></div>
              <div className="how-arrow">→</div>
              <div className="how-step"><span className="how-num">3</span><span>Receiver downloads directly from your browser</span></div>
            </div>
          </div>
        )}

        {mode && status !== "idle" && (
          <div className="transfer-view">
            <button className="back-btn" onClick={reset}>{Icon.x} New transfer</button>

            {/* File info */}
            {fileInfo && (
              <div className="file-pill">
                <span className="file-emoji">📄</span>
                <div>
                  <div className="file-name">{fileInfo.name}</div>
                  <div className="file-size">{formatSize(fileInfo.size)}</div>
                </div>
              </div>
            )}

            {/* Status display */}
            <div className="status-block">
              {status === "connecting" && (
                <div className="status-msg connecting">
                  <span className="spinner" />
                  Connecting to peer…
                </div>
              )}

              {status === "waiting" && mode === "send" && (
                <div className="waiting-block">
                  <div className="status-msg">Waiting for receiver to join…</div>
                  <div className="room-display">
                    <span className="room-label">Room ID</span>
                    <span className="room-id">{roomId}</span>
                  </div>
                  <div className="share-row">
                    <input className="share-link-input" readOnly value={shareLink} />
                    <button className="btn btn-copy" onClick={copyLink}>
                      {copied ? <>{Icon.check} Copied!</> : <>{Icon.link} Copy link</>}
                    </button>
                  </div>
                  <p className="share-hint">Share this link or Room ID with the person you want to send to</p>
                </div>
              )}

              {status === "waiting" && mode === "receive" && (
                <div className="status-msg connecting">
                  <span className="spinner" />
                  Waiting for sender to start…
                </div>
              )}

              {status === "ready" && (
                <div className="status-msg ready">
                  <span className="dot green" /> Peer connected! Ready to transfer.
                </div>
              )}

              {status === "transferring" && (
                <div className="transfer-progress">
                  <div className="progress-header">
                    <span>{mode === "send" ? "Sending" : "Receiving"}…</span>
                    <span className="progress-pct">{progress}%</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="progress-meta">
                    <span>{mode === "send" ? "Uploaded" : "Downloaded"}: {formatSize(bytesRef.current)}</span>
                    {speed > 0 && <span>⚡ {formatSpeed(speed)}</span>}
                    <span>of {fileInfo ? formatSize(fileInfo.size) : "—"}</span>
                  </div>
                </div>
              )}

              {status === "done" && (
                <div className="done-block">
                  <div className="done-icon">{Icon.check}</div>
                  <h2>{mode === "send" ? "File sent!" : "File received!"}</h2>
                  {mode === "receive" && verifyStatus && (
                    <div className={`verify-badge ${verifyStatus}`}>
                      {verifyStatus === "ok"
                        ? <>{Icon.shield} SHA-256 verified — file integrity confirmed</>
                        : "⚠️ Hash mismatch — file may be corrupted"}
                    </div>
                  )}
                  {mode === "receive" && (
                    <p className="done-sub">The file has been saved to your Downloads folder.</p>
                  )}
                  <button className="btn btn-primary" onClick={reset}>Start new transfer</button>
                </div>
              )}

              {status === "error" && (
                <div className="error-block">
                  <div className="error-icon">⚠️</div>
                  <p className="error-msg">{error}</p>
                  <button className="btn btn-primary" onClick={reset}>Try again</button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        P2P WebShare · MARS Open Projects 2026 · Files transfer directly between browsers
      </footer>
    </div>
  );
}
