/* eslint-disable */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fabric } from "fabric";
import { io } from "socket.io-client";
import AgoraRTC from "agora-rtc-sdk-ng";

const SERVER_URL = "https://collabboard-production-8eec.up.railway.app";

const detectMobile = () => window.innerWidth < 900 || navigator.maxTouchPoints > 0;

function Board() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));

  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const socketRef = useRef(null);
  const isReceiving = useRef(false);
  const roomIdRef = useRef(roomId);
  const agoraClient = useRef(null);
  const localAudioTrack = useRef(null);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef(null);

  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tool, setTool] = useState("select");
  const toolRef = useRef("select");
  const [color, setColor] = useState("#000000");
  const colorRef = useRef("#000000");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const strokeRef = useRef(5);
  const [fontSize, setFontSize] = useState(18);
  const fontSizeRef = useRef(18);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [chatOpen, setChatOpen] = useState(!detectMobile());
  const [messages, setMessages] = useState([
    { username: "System", color: "#6af7c8", message: "Welcome to room!", time: "" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [users, setUsers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const stickyCount = useRef(0);
  const [isMobile, setIsMobile] = useState(detectMobile());

  // Keep refs in sync with state (fixes stale closure bugs in canvas events)
  const setToolSafe = (t) => { toolRef.current = t; setTool(t); };
  const setColorSafe = (c) => { colorRef.current = c; setColor(c); };
  const setStrokeSafe = (s) => { strokeRef.current = s; setStrokeWidth(s); };
  const setFontSizeSafe = (s) => { fontSizeRef.current = s; setFontSize(s); };

  useEffect(() => {
    const handleResize = () => {
      const m = detectMobile();
      setIsMobile(m);
      if (!m) setChatOpen(true);
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  const stickyColors = [
    { bg: "#fef08a", text: "#1a1a00" },
    { bg: "#fbcfe8", text: "#3a002a" },
    { bg: "#a5f3fc", text: "#002a2a" },
    { bg: "#bbf7d0", text: "#002a0a" },
    { bg: "#fde68a", text: "#2a1500" },
  ];

  const showToast = useCallback((msg) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  window.deleteSticky = (id) => {
    const note = document.getElementById("sticky-" + id);
    if (note) note.remove();
    socketRef.current?.emit("deleteSticky", { roomId, id });
  };

  const createStickyDOM = (id, left, top, col, text) => {
    const layer = document.getElementById("stickyLayer");
    if (!layer) return;
    if (document.getElementById("sticky-" + id)) return;
    const note = document.createElement("div");
    note.id = "sticky-" + id;
    note.style.cssText = `position:absolute;width:180px;min-height:140px;background:${col.bg};border-radius:12px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,0.4);pointer-events:all;left:${left}px;top:${top}px;display:flex;flex-direction:column;gap:6px;z-index:20;`;
    note.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;color:${col.text};cursor:move" class="sh"><span>📌 Note</span><button onclick="window.deleteSticky('${id}')" style="background:none;border:none;cursor:pointer;font-size:14px;color:${col.text};opacity:0.6">✕</button></div><textarea id="ta-${id}" placeholder="Write your note..." style="flex:1;border:none;outline:none;background:transparent;font-family:inherit;font-size:13px;line-height:1.5;resize:none;min-height:100px;color:${col.text}">${text}</textarea>`;
    const ta = note.querySelector("textarea");
    ta.addEventListener("input", () => {
      socketRef.current?.emit("updateSticky", { roomId, id, text: ta.value });
    });
    let dragging = false, sx, sy, il, it;
    const handle = note.querySelector(".sh");
    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      il = parseInt(note.style.left); it = parseInt(note.style.top); e.preventDefault();
    });
    handle.addEventListener("touchstart", (e) => {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      il = parseInt(note.style.left); it = parseInt(note.style.top); e.preventDefault();
    }, { passive: false });
    document.addEventListener("mousemove", (e) => { if (!dragging) return; note.style.left = (il + e.clientX - sx) + "px"; note.style.top = (it + e.clientY - sy) + "px"; });
    document.addEventListener("touchmove", (e) => { if (!dragging) return; note.style.left = (il + e.touches[0].clientX - sx) + "px"; note.style.top = (it + e.touches[0].clientY - sy) + "px"; }, { passive: false });
    document.addEventListener("mouseup", () => { dragging = false; });
    document.addEventListener("touchend", () => { dragging = false; });
    note.addEventListener("mousedown", e => e.stopPropagation());
    note.addEventListener("touchstart", e => e.stopPropagation(), { passive: false });
    layer.appendChild(note);
    ta.focus();
  };

  // ── SOCKET INIT ──
  useEffect(() => {
    socketRef.current = io(SERVER_URL, { transports: ["websocket"], reconnection: true });
    const socket = socketRef.current;
    socket.emit("joinRoom", { roomId, username: user?.username });

    socket.on("roomJoined", ({ users }) => { setUsers(users); showToast("✅ Joined room " + roomId); });
    socket.on("userJoined", ({ username, users }) => { setUsers(users); showToast("👋 " + username + " joined"); });
    socket.on("userLeft", ({ username, users }) => { setUsers(users); showToast("👋 " + username + " left"); });

    socket.on("draw", (drawData) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      isReceiving.current = true;
      if (drawData.type === "syncCanvas") {
        canvas.loadFromJSON(drawData.canvasJSON, () => {
          canvas.renderAll();
          isReceiving.current = false;
        });
      } else if (drawData.type === "add") {
        fabric.util.enlivenObjects([drawData.obj], (objects) => {
          objects.forEach(obj => canvas.add(obj));
          canvas.renderAll();
          isReceiving.current = false;
        });
      }
    });

    socket.on("chatMessage", (msg) => {
      setMessages(prev => [...prev, { ...msg, me: msg.username === user?.username }]);
    });

    socket.on("clearBoard", () => {
      fabricRef.current?.clear();
      fabricRef.current?.renderAll();
      const layer = document.getElementById("stickyLayer");
      if (layer) layer.innerHTML = "";
      showToast("🗑 Board was cleared");
    });

    socket.on("addSticky", ({ id, left, top, colIndex }) => {
      const col = stickyColors[colIndex];
      createStickyDOM(id, left, top, col, "");
    });
    socket.on("updateSticky", (data) => {
      if (!data) return;
      const ta = document.getElementById("ta-" + data.id);
      if (ta) ta.value = data.text;
    });
    socket.on("deleteSticky", ({ id }) => {
      const note = document.getElementById("sticky-" + id);
      if (note) note.remove();
    });

    return () => {
      socket.emit("leaveRoom");
      socket.disconnect();
    };
  }, []);

  // ── CANVAS INIT ──
  useEffect(() => {
    const mobile = detectMobile();
    const canvasWidth = window.innerWidth - (mobile ? 0 : 60) - (mobile ? 0 : 280);
    const canvasHeight = window.innerHeight - (mobile ? 110 : 52);

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: false,
      selection: true,
      backgroundColor: "#ffffff",
      width: canvasWidth,
      height: canvasHeight,
      // Prevent default touch behavior so canvas handles touch
      allowTouchScrolling: false,
    });
    fabricRef.current = canvas;

    const welcome = new fabric.IText("✦ Welcome to CollabBoard\nStart drawing and collaborating!", {
      fill: "#333333", fontSize: mobile ? 16 : 22,
      fontFamily: "sans-serif", fontWeight: "300",
      textAlign: "center", selectable: true,
      originX: "center", originY: "center",
      left: canvasWidth / 2, top: canvasHeight / 2,
    });
    canvas.add(welcome);
    canvas.renderAll();

    const handleResize = () => {
      const m = detectMobile();
      const w = window.innerWidth - (m ? 0 : 60) - (m ? 0 : 280);
      const h = window.innerHeight - (m ? 110 : 52);
      canvas.setWidth(w);
      canvas.setHeight(h);
      canvas.renderAll();
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    canvas.on("mouse:wheel", (opt) => {
      opt.e.preventDefault();
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** opt.e.deltaY;
      zoom = Math.min(Math.max(zoom, 0.1), 5);
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      setZoomLevel(zoom);
    });

    // Sync drawings
    canvas.on("object:added", (e) => {
      if (isReceiving.current) return;
      const obj = e.target;
      if (obj && obj.type === "path") {
        socketRef.current?.emit("draw", {
          roomId: roomIdRef.current,
          drawData: { type: "add", obj: obj.toJSON() }
        });
      }
    });

    canvas.on("text:changed", () => {
      if (isReceiving.current) return;
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON: canvas.toJSON() }
      });
    });

    canvas.on("text:editing:exited", () => {
      if (isReceiving.current) return;
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON: canvas.toJSON() }
      });
    });

    canvas.on("object:modified", () => {
      if (isReceiving.current) return;
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON: canvas.toJSON() }
      });
    });

    // ── MOUSE/TOUCH EVENTS using refs (fixes stale closure) ──
    const handleMouseDown = (opt) => {
      const currentTool = toolRef.current;
      if (currentTool === "text") {
        if (opt.target && opt.target.type === "i-text") {
          canvas.setActiveObject(opt.target);
          opt.target.enterEditing();
          return;
        }
        const p = canvas.getPointer(opt.e);
        const text = new fabric.IText("Text", {
          left: p.x, top: p.y,
          fill: colorRef.current,
          fontSize: fontSizeRef.current,
          fontFamily: "sans-serif", editable: true,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
      }
      if (currentTool === "pan") {
        isPanningRef.current = true;
        const clientX = opt.e.touches ? opt.e.touches[0].clientX : opt.e.clientX;
        const clientY = opt.e.touches ? opt.e.touches[0].clientY : opt.e.clientY;
        lastPanRef.current = { x: clientX, y: clientY };
        canvas.selection = false;
      }
      if (currentTool === "eraser" && opt.target) {
        canvas.remove(opt.target);
        canvas.renderAll();
        socketRef.current?.emit("draw", {
          roomId: roomIdRef.current,
          drawData: { type: "syncCanvas", canvasJSON: canvas.toJSON() }
        });
      }
    };

    const handleMouseMove = (opt) => {
      if (toolRef.current === "pan" && isPanningRef.current && lastPanRef.current) {
        const clientX = opt.e.touches ? opt.e.touches[0].clientX : opt.e.clientX;
        const clientY = opt.e.touches ? opt.e.touches[0].clientY : opt.e.clientY;
        const dx = clientX - lastPanRef.current.x;
        const dy = clientY - lastPanRef.current.y;
        // Limit pan speed to prevent jumping
        const maxDelta = 30;
        const safeDx = Math.max(-maxDelta, Math.min(maxDelta, dx));
        const safeDy = Math.max(-maxDelta, Math.min(maxDelta, dy));
        const vpt = canvas.viewportTransform;
        vpt[4] += safeDx;
        vpt[5] += safeDy;
        canvas.requestRenderAll();
        lastPanRef.current = { x: clientX, y: clientY };
      }
    };

    const handleMouseUp = () => {
      isPanningRef.current = false;
      lastPanRef.current = null;
    };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      canvas.dispose();
    };
  }, [roomId]);

  // ── TOOL SWITCHING ──
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (tool === "pen") {
      canvas.isDrawingMode = true;
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = strokeWidth;
      canvas.selection = false;
    } else {
      canvas.isDrawingMode = false;
      canvas.selection = tool === "select" || tool === "text";
    }
  }, [tool, color, strokeWidth]);

  const addStickyNote = () => {
    const colIndex = stickyCount.current % stickyColors.length;
    const col = stickyColors[colIndex];
    stickyCount.current++;
    const id = Date.now();
    const left = 60 + (stickyCount.current * 15) % 200;
    const top = 60 + (stickyCount.current * 15) % 150;
    createStickyDOM(id, left, top, col, "");
    socketRef.current?.emit("addSticky", { roomId, id, left, top, colIndex });
    showToast("📌 Sticky note added!");
  };

  const clearAll = () => {
    if (window.confirm("Clear the entire board?")) {
      fabricRef.current?.clear();
      fabricRef.current?.renderAll();
      const layer = document.getElementById("stickyLayer");
      if (layer) layer.innerHTML = "";
      socketRef.current?.emit("clearBoard", { roomId });
      showToast("🗑 Board cleared");
    }
  };

  const exportImage = () => {
    const dataURL = fabricRef.current?.toDataURL({ format: "png", multiplier: 2 });
    if (!dataURL) return;
    if (isMobile) {
      const win = window.open("", "_blank");
      win.document.write(`<html><body style="margin:0;background:#111;display:flex;flex-direction:column;align-items:center;padding:20px;font-family:sans-serif;"><p style="color:#aaa">Long-press the image to save</p><img src="${dataURL}" style="max-width:100%;border-radius:8px;"/></body></html>`);
      win.document.close();
    } else {
      const a = document.createElement("a");
      a.href = dataURL; a.download = "collabboard.png"; a.click();
      showToast("✅ PNG exported!");
    }
  };

  const exportPDF = () => {
    const dataURL = fabricRef.current?.toDataURL({ format: "png", multiplier: 2 });
    if (!dataURL) return;
    const win = window.open("", "_blank");
    win.document.write(`<html><body style="margin:0;background:#111;display:flex;flex-direction:column;align-items:center;padding:20px;font-family:sans-serif;gap:16px;"><button onclick="window.print()" style="background:#7c6af7;color:white;border:none;padding:12px 24px;border-radius:10px;font-size:15px;cursor:pointer;">Print / Save as PDF</button><img src="${dataURL}" style="max-width:100%;" onload="${isMobile ? '' : 'window.print()'}"/></body></html>`);
    win.document.close();
  };

  const zoomIn = () => { const z = Math.min(zoomLevel + 0.1, 5); fabricRef.current?.setZoom(z); setZoomLevel(z); };
  const zoomOut = () => { const z = Math.max(zoomLevel - 0.1, 0.1); fabricRef.current?.setZoom(z); setZoomLevel(z); };
  const resetZoom = () => { fabricRef.current?.setZoom(1); const vpt = fabricRef.current?.viewportTransform; if (vpt) { vpt[4] = 0; vpt[5] = 0; } fabricRef.current?.requestRenderAll(); setZoomLevel(1); };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    socketRef.current?.emit("chatMessage", { roomId, message: chatInput });
    setChatInput("");
  };

  const joinAudio = async () => {
    const APP_ID = "4ae90a86fb164aad8b93ecad9e62dfc8";
    const TOKEN = null;
    const CHANNEL = "CollabBoard2";
    try {
      if (agoraClient.current) {
        await leaveAudio();
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (permErr) {
        showToast("🎙️ Mic permission denied.");
        return;
      }
      agoraClient.current = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      await agoraClient.current.join(APP_ID, CHANNEL, TOKEN, null);
      localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack({
        AEC: true,
        ANS: true,
        AGC: true,
      });
      await agoraClient.current.publish(localAudioTrack.current);
      agoraClient.current.on("user-published", async (remoteUser, mediaType) => {
        await agoraClient.current.subscribe(remoteUser, mediaType);
        if (mediaType === "audio") remoteUser.audioTrack.play();
      });
      agoraClient.current.on("user-unpublished", async (remoteUser) => {
        await agoraClient.current.unsubscribe(remoteUser);
      });
      setInCall(true);
      showToast("🎙️ Voice joined!");
    } catch (err) {
      showToast("❌ Audio error: " + err.message);
    }
  };

  const leaveAudio = async () => {
    try {
      localAudioTrack.current?.stop();
      localAudioTrack.current?.close();
      localAudioTrack.current = null;
      await agoraClient.current?.leave();
      agoraClient.current = null;
    } catch (e) {}
    setInCall(false);
    setMuted(false);
    showToast("🔇 Left voice call");
  };

  const toggleMute = () => {
    if (localAudioTrack.current) {
      localAudioTrack.current.setEnabled(muted);
      setMuted(!muted);
    }
  };

  const handleLogout = async () => {
    if (inCall) await leaveAudio();
    socketRef.current?.emit("leaveRoom");
    socketRef.current?.disconnect();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const getCursor = () => {
    if (tool === "pen") return "crosshair";
    if (tool === "pan") return "grab";
    if (tool === "text") return "text";
    if (tool === "eraser") return "cell";
    return "default";
  };

  const toolList = [
    { id: "select", icon: "↖", tip: "Select" },
    { id: "pen", icon: "✏️", tip: "Draw" },
    { id: "text", icon: "T", tip: "Text" },
    { id: "pan", icon: "✋", tip: "Pan" },
    { id: "eraser", icon: "⌫", tip: "Eraser" },
  ];
  const colorList = ["#000000", "#ffffff", "#f76a8a", "#7c6af7", "#6af7c8", "#f7c86a", "#ff6600", "#0066ff"];
  const strokeList = [2, 5, 12];
  const fontSizeList = [12, 14, 16, 18, 24, 32, 48, 64];

  const ToolBtn = ({ children, active, onClick, tip, danger, small }) => (
    <button title={tip} onClick={onClick} style={{ width: 44, height: 44, flexShrink: 0, border: "none", borderRadius: 10, cursor: "pointer", background: active ? "#7c6af7" : "transparent", color: danger ? "#f76a8a" : active ? "white" : "#8888aa", fontSize: small ? 14 : 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", boxShadow: active ? "0 0 12px rgba(124,106,247,0.4)" : "none" }}>
      {children}
    </button>
  );

  const Divider = () => <div style={{ width: 1, height: 36, background: "#2a2a3a", flexShrink: 0, margin: "0 6px" }} />;

  const MobileToolbar = () => (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 72, background: "#16161e", borderTop: "1px solid #2a2a3a", zIndex: 1000, display: "flex", alignItems: "center" }}>
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", alignItems: "center", gap: 2, padding: "0 8px", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }} className="hide-scrollbar">
        {toolList.map(t => (
          <ToolBtn key={t.id} active={tool === t.id} onClick={() => setToolSafe(t.id)} tip={t.tip}>{t.icon}</ToolBtn>
        ))}
        <Divider />
        <ToolBtn onClick={addStickyNote} tip="Sticky">📌</ToolBtn>
        <ToolBtn onClick={clearAll} tip="Clear" danger>🗑</ToolBtn>
        <Divider />
        {colorList.map(c => (
          <div key={c} onClick={() => setColorSafe(c)} style={{ width: 26, height: 26, borderRadius: "50%", background: c, cursor: "pointer", flexShrink: 0, border: color === c ? "3px solid #7c6af7" : "2px solid #3a3a4a", transform: color === c ? "scale(1.15)" : "scale(1)", transition: "all 0.15s" }} />
        ))}
        <Divider />
        {strokeList.map(s => (
          <ToolBtn key={s} active={strokeWidth === s} onClick={() => setStrokeSafe(s)}>
            <div style={{ width: s === 2 ? 4 : s === 5 ? 8 : 14, height: s === 2 ? 4 : s === 5 ? 8 : 14, borderRadius: "50%", background: strokeWidth === s ? "white" : "#8888aa" }} />
          </ToolBtn>
        ))}
        <Divider />
        <select value={fontSize} onChange={e => setFontSizeSafe(Number(e.target.value))} style={{ background: "#1e1e2a", border: "1px solid #3a3a4a", color: "#e8e8f0", borderRadius: 8, padding: "4px 2px", fontSize: 11, cursor: "pointer", width: 48, height: 38, flexShrink: 0 }}>
          {fontSizeList.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <Divider />
        <ToolBtn onClick={zoomOut}>−</ToolBtn>
        <div style={{ flexShrink: 0, minWidth: 36, textAlign: "center", fontSize: 10, color: "#8888aa" }}>{Math.round(zoomLevel * 100)}%</div>
        <ToolBtn onClick={zoomIn}>+</ToolBtn>
        <ToolBtn onClick={resetZoom} small>↺</ToolBtn>
      </div>
      <style>{`.hide-scrollbar::-webkit-scrollbar{display:none}`}</style>
    </div>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0f0f13", overflow: "hidden", fontFamily: "sans-serif" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.3)}} .hide-scrollbar::-webkit-scrollbar{display:none}`}</style>

      {/* HEADER */}
      <header style={{ height: 52, background: "#16161e", borderBottom: "1px solid #2a2a3a", display: "flex", alignItems: "center", padding: "0 10px", gap: 8, flexShrink: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, color: "white", flexShrink: 0 }}>
          <div style={{ width: 24, height: 24, background: "linear-gradient(135deg,#7c6af7,#f76a8a)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✦</div>
          {!isMobile && "CollabBoard"}
        </div>
        <div style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#8888aa", fontFamily: "monospace", flexShrink: 0 }}>#{roomId}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", fontSize: 11, color: "#8888aa", flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, background: "#6af7c8", borderRadius: "50%", animation: "pulse 2s infinite" }} />
          <div style={{ display: "flex" }}>
            {users.slice(0, isMobile ? 2 : 4).map((u, i) => (
              <div key={i} title={u.username} style={{ width: 24, height: 24, borderRadius: "50%", background: u.color || "#7c6af7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, border: "2px solid #0f0f13", marginLeft: i === 0 ? 0 : -6, color: "white" }}>
                {u.username?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
          <span>{users.length}</span>
        </div>
        {!isMobile && <>
          <button onClick={exportImage} style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>⬇ PNG</button>
          <button onClick={exportPDF} style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>⬇ PDF</button>
          {!inCall ? (
            <button onClick={joinAudio} style={{ background: "#6af7c8", border: "none", color: "#000", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>🎙️ Join Voice</button>
          ) : (
            <>
              <button onClick={toggleMute} style={{ background: muted ? "#f76a8a" : "#6af7c8", border: "none", color: "#000", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</button>
              <button onClick={leaveAudio} style={{ background: "#f76a8a", border: "none", color: "white", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>📵 Leave</button>
            </>
          )}
          <button onClick={() => setChatOpen(p => !p)} style={{ background: "#7c6af7", border: "none", color: "white", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>💬 Chat</button>
        </>}
        <button onClick={handleLogout} style={{ background: "rgba(247,106,138,0.1)", border: "1px solid #f76a8a", color: "#f76a8a", borderRadius: 7, padding: "5px 10px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Logout</button>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* DESKTOP TOOLBAR */}
        {!isMobile && (
          <div style={{ width: 60, background: "#16161e", borderRight: "1px solid #2a2a3a", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 4, zIndex: 10 }}>
            {toolList.map(t => (
              <button key={t.id} title={t.tip} onClick={() => setToolSafe(t.id)} style={{ width: 44, height: 44, border: "none", borderRadius: 10, cursor: "pointer", background: tool === t.id ? "#7c6af7" : "transparent", color: tool === t.id ? "white" : "#8888aa", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", boxShadow: tool === t.id ? "0 0 16px rgba(124,106,247,0.4)" : "none" }}>{t.icon}</button>
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }} />
            <select value={fontSize} onChange={e => setFontSizeSafe(Number(e.target.value))} style={{ width: 44, background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 8, padding: "4px 2px", fontSize: 11, cursor: "pointer" }}>
              {fontSizeList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }} />
            <button onClick={addStickyNote} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: "transparent", color: "#8888aa", fontSize: 18, cursor: "pointer" }}>📌</button>
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }} />
            {colorList.map(c => (
              <div key={c} onClick={() => setColorSafe(c)} style={{ width: 20, height: 20, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "2px solid white" : "2px solid #2a2a3a", transform: color === c ? "scale(1.2)" : "scale(1)", transition: "all 0.15s" }} />
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }} />
            {strokeList.map(s => (
              <button key={s} onClick={() => setStrokeSafe(s)} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: strokeWidth === s ? "#1e1e2a" : "transparent", color: strokeWidth === s ? "white" : "#8888aa", fontSize: s === 2 ? 8 : s === 5 ? 13 : 20, cursor: "pointer" }}>●</button>
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }} />
            <button onClick={clearAll} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: "transparent", color: "#f76a8a", fontSize: 18, cursor: "pointer" }}>🗑</button>
          </div>
        )}

        {/* CANVAS */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#ffffff", backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)", backgroundSize: "32px 32px", cursor: getCursor() }}>
          <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0 }} />
          <div id="stickyLayer" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />

          {!isMobile && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#16161e", border: "1px solid #2a2a3a", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: "#8888aa", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 10, zIndex: 10 }}>
              <button onClick={zoomOut} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 16 }}>−</button>
              <span>{Math.round(zoomLevel * 100)}%</span>
              <button onClick={zoomIn} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 16 }}>+</button>
              <button onClick={resetZoom} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 11 }}>Reset</button>
            </div>
          )}

          {/* Mobile floating buttons */}
          {isMobile && (
            <div style={{ position: "absolute", bottom: 82, right: 10, display: "flex", flexDirection: "column", gap: 8, zIndex: 50 }}>
              <button onClick={() => setChatOpen(p => !p)} style={{ width: 40, height: 40, background: "#7c6af7", border: "none", borderRadius: 10, color: "white", fontSize: 16, cursor: "pointer" }}>💬</button>
              {!inCall ? (
                <button onClick={joinAudio} style={{ width: 40, height: 40, background: "#6af7c8", border: "none", borderRadius: 10, color: "#000", fontSize: 16, cursor: "pointer" }}>🎙️</button>
              ) : (
                <>
                  <button onClick={toggleMute} style={{ width: 40, height: 40, background: muted ? "#f76a8a" : "#6af7c8", border: "none", borderRadius: 10, color: "#000", fontSize: 16, cursor: "pointer" }}>{muted ? "🔇" : "🎙️"}</button>
                  <button onClick={leaveAudio} style={{ width: 40, height: 40, background: "#f76a8a", border: "none", borderRadius: 10, color: "white", fontSize: 16, cursor: "pointer" }}>📵</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* CHAT PANEL */}
        {chatOpen && (
          <div style={{ width: isMobile ? "100%" : 280, background: "#16161e", borderLeft: "1px solid #2a2a3a", display: "flex", flexDirection: "column", zIndex: 100, ...(isMobile ? { position: "fixed", bottom: 72, left: 0, right: 0, height: "55%", borderTop: "1px solid #2a2a3a", borderLeft: "none" } : {}) }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a3a", fontSize: 13, fontWeight: 600, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>💬 Room Chat</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#6af7c8", fontSize: 11 }}>● {users.length} online</span>
                {isMobile && <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 18 }}>✕</button>}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }} ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
              {messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: msg.color || "#7c6af7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "white" }}>{msg.username?.[0]?.toUpperCase()}</div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: msg.color || "#7c6af7" }}>{msg.username}</span>
                    <span style={{ fontSize: 10, color: "#8888aa", marginLeft: "auto" }}>{msg.time}</span>
                  </div>
                  <div style={{ background: msg.me ? "rgba(124,106,247,0.15)" : "#1e1e2a", border: `1px solid ${msg.me ? "rgba(124,106,247,0.3)" : "#2a2a3a"}`, borderRadius: msg.me ? "8px 0 8px 8px" : "0 8px 8px 8px", padding: "8px 10px", fontSize: 12, lineHeight: 1.5, marginLeft: 26, color: "#e8e8f0", wordBreak: "break-word" }}>{msg.message}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: 12, borderTop: "1px solid #2a2a3a", display: "flex", gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Message..." style={{ flex: 1, background: "#1e1e2a", border: "1px solid #2a2a3a", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#e8e8f0", outline: "none" }} />
              <button onClick={sendMessage} style={{ width: 34, height: 34, background: "#7c6af7", border: "none", borderRadius: 8, color: "white", cursor: "pointer", fontSize: 14 }}>➤</button>
            </div>
          </div>
        )}
      </div>

      {isMobile && <MobileToolbar />}

      <div style={{ position: "fixed", top: 64, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: "#16161e", border: "1px solid #2a2a3a", borderLeft: "3px solid #6af7c8", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e8e8f0", minWidth: 200, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

export default Board;
