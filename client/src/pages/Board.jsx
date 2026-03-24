/* eslint-disable */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fabric } from "fabric";
import { io } from "socket.io-client";
import AgoraRTC from "agora-rtc-sdk-ng";

// Defined outside component so it's available everywhere including useEffects
const detectMobile = () => {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
  const isTouchDevice = navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth < 768;
  return isMobileUA || isTouchDevice || isSmallScreen;
};

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
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tool, setTool] = useState("select");
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [fontSize, setFontSize] = useState(18);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [chatOpen, setChatOpen] = useState(window.innerWidth >= 768);
  const [messages, setMessages] = useState([
    { username: "System", color: "#6af7c8", message: "Welcome to room!", time: "" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [users, setUsers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [isPanning, setIsPanning] = useState(false);
  const lastPan = useRef(null);
  const stickyCount = useRef(0);
  const [isMobile, setIsMobile] = useState(detectMobile());

  // React to orientation changes and window resize
  // Touch devices (phones/tablets) always stay in mobile mode regardless of orientation
  const [isTouch] = useState(() => navigator.maxTouchPoints > 0);

  useEffect(() => {
    const handleResize = () => {
      if (isTouch) {
        setIsMobile(true);
      } else {
        setIsMobile(detectMobile());
        if (!detectMobile()) setChatOpen(true);
      }
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [isTouch]);

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

  const syncCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    const socket = socketRef.current;
    if (!canvas || !socket || isReceiving.current) return;
    const canvasJSON = canvas.toJSON();
    socket.emit("draw", {
      roomId: roomIdRef.current,
      drawData: { type: "syncCanvas", canvasJSON }
    });
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
    document.addEventListener("mousemove", (e) => { if (!dragging) return; note.style.left = (il + e.clientX - sx) + "px"; note.style.top = (it + e.clientY - sy) + "px"; });
    document.addEventListener("mouseup", () => { dragging = false; });
    note.addEventListener("mousedown", e => e.stopPropagation());
    layer.appendChild(note);
    ta.focus();
  };

  // ── SOCKET INIT ──
  useEffect(() => {
    socketRef.current = io("https://collabboard-production-8eec.up.railway.app");
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
      const col = stickyColors[colIndex % stickyColors.length];
      if (!col) return;
      createStickyDOM(id, left, top, col, "");
      showToast("📌 " + "A sticky note was added!");
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
    socket.on("pan", (vpt) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      canvas.viewportTransform = vpt;
      canvas.requestRenderAll();
    });

    return () => {
      socket.emit("leaveRoom");
      socket.disconnect();
    };
  }, []);

  // ── CANVAS INIT ──
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: false,
      selection: true,
      backgroundColor: "#ffffff",
      width: window.innerWidth - (detectMobile() ? 0 : 60) - (detectMobile() ? 0 : 280),
      height: window.innerHeight - (detectMobile() ? 110 : 52),
    });
    fabricRef.current = canvas;
    const actualWidth = window.innerWidth - (detectMobile() ? 0 : 60) - (detectMobile() ? 0 : 280);
    const actualHeight = window.innerHeight - (detectMobile() ? 110 : 52);
    const welcome = new fabric.IText("✦ Welcome to CollabBoard\nStart drawing and collaborating!", {
      fill: "#333333",
      fontSize: detectMobile() ? 18 : 22,
      fontFamily: "sans-serif",
      fontWeight: "300",
      textAlign: "center",
      selectable: true,
      originX: "center",
      originY: "center",
      left: actualWidth / 2,
      top: actualHeight / 2,
    });
    canvas.add(welcome);
    canvas.renderAll();

    const handleResize = () => {
      const isMobileDevice = detectMobile();
      canvas.setWidth(window.innerWidth - (isMobileDevice ? 0 : 60) - (isMobileDevice ? 0 : 280));
      canvas.setHeight(window.innerHeight - (isMobileDevice ? 110 : 52));
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
      const canvasJSON = canvas.toJSON();
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON }
      });
    });

    canvas.on("text:editing:exited", () => {
      if (isReceiving.current) return;
      const canvasJSON = canvas.toJSON();
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON }
      });
    });

    canvas.on("object:modified", () => {
      if (isReceiving.current) return;
      const canvasJSON = canvas.toJSON();
      socketRef.current?.emit("draw", {
        roomId: roomIdRef.current,
        drawData: { type: "syncCanvas", canvasJSON }
      });
    });

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

  // ── MOUSE EVENTS ──
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt) => {
      if (tool === "text") {
        if (opt.target && opt.target.type === "i-text") {
          canvas.setActiveObject(opt.target);
          opt.target.enterEditing();
          return;
        }
        const p = canvas.getPointer(opt.e);
        const text = new fabric.IText("Text", {
          left: p.x, top: p.y,
          fill: color, fontSize: fontSize,
          fontFamily: "sans-serif", editable: true,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
      }
      if (tool === "pan") {
        setIsPanning(true);
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY };
      }
      if (tool === "eraser" && opt.target) {
        canvas.remove(opt.target);
        canvas.renderAll();
        const canvasJSON = canvas.toJSON();
        socketRef.current?.emit("draw", {
          roomId: roomIdRef.current,
          drawData: { type: "syncCanvas", canvasJSON }
        });
      }
    };

    const handleMouseMove = (opt) => {
      if (tool === "pan" && isPanning && lastPan.current) {
        const dx = opt.e.clientX - lastPan.current.x;
        const dy = opt.e.clientY - lastPan.current.y;
        const vpt = canvas.viewportTransform;
        vpt[4] += dx; vpt[5] += dy;
        canvas.requestRenderAll();
        lastPan.current = { x: opt.e.clientX, y: opt.e.clientY };
        socketRef.current?.emit("pan", {
          roomId: roomIdRef.current,
          vpt: [...vpt]
        });
      }
    };

    const handleMouseUp = () => { setIsPanning(false); lastPan.current = null; };

    canvas.on("mouse:down", handleMouseDown);
    canvas.on("mouse:move", handleMouseMove);
    canvas.on("mouse:up", handleMouseUp);

    return () => {
      canvas.off("mouse:down", handleMouseDown);
      canvas.off("mouse:move", handleMouseMove);
      canvas.off("mouse:up", handleMouseUp);
    };
  }, [tool, color, isPanning, fontSize]);

  const addStickyNote = () => {
    const colIndex = stickyCount.current % stickyColors.length;
    const col = stickyColors[colIndex];
    stickyCount.current++;
    const id = Date.now();
    const left = 100 + (stickyCount.current * 20);
    const top = 80 + (stickyCount.current * 20);
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
    const isMobileDevice = navigator.maxTouchPoints > 0;
    if (isMobileDevice) {
      const win = window.open("", "_blank");
      const html = "<html><head><title>CollabBoard - Save Image</title><meta name='viewport' content='width=device-width, initial-scale=1'><style>body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;gap:16px;}img{max-width:100%;border-radius:8px;}p{color:#aaa;font-size:14px;text-align:center;padding:0 20px;}</style></head><body><p>Long-press the image and tap Save Image to download</p><img src='" + dataURL + "' /></body></html>";
      win.document.write(html);
      win.document.close();
      showToast("📥 Long-press the image to save!");
    } else {
      const a = document.createElement("a");
      a.href = dataURL;
      a.download = "collabboard.png";
      a.click();
      showToast("✅ PNG exported!");
    }
  };

  const exportPDF = () => {
    const dataURL = fabricRef.current?.toDataURL({ format: "png", multiplier: 2 });
    if (!dataURL) return;
    const win = window.open("", "_blank");
    const isMobileDevice = navigator.maxTouchPoints > 0;
    const hint = isMobileDevice ? "Tap the button above, then choose Save as PDF from the print dialog" : "";
    const autoprint = isMobileDevice ? "" : "onload=\"window.print()\"";
    const html = "<html><head><title>CollabBoard</title><meta name='viewport' content='width=device-width, initial-scale=1'><style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#111;font-family:sans-serif;gap:16px;}img{max-width:100%;}p{color:#aaa;font-size:14px;text-align:center;padding:0 20px;}button{background:#7c6af7;color:white;border:none;padding:12px 24px;border-radius:10px;font-size:15px;cursor:pointer;}</style></head><body><button onclick='window.print()'>Print / Save as PDF</button><p>" + hint + "</p><img src='" + dataURL + "' " + autoprint + " /></body></html>";
    win.document.write(html);
    win.document.close();
    showToast("🖨 Opening export page...");
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
    // Use roomId as channel so each room has its own voice channel
    // and users from different rooms don't hear each other
    const CHANNEL = "room_" + roomId;
    try {
      // Step 1: explicitly request mic permission first
      const permissionResult = await navigator.permissions.query({ name: "microphone" });
      if (permissionResult.state === "denied") {
        showToast("🎙️ Mic blocked! Please allow microphone in your browser settings and try again.");
        return;
      }

      // Step 2: trigger the browser mic permission prompt via getUserMedia
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (permErr) {
        if (permErr.name === "NotAllowedError" || permErr.name === "PermissionDeniedError") {
          showToast("🎙️ Mic permission denied. Tap Allow when the browser asks for microphone access.");
        } else if (permErr.name === "NotFoundError") {
          showToast("🎙️ No microphone found on this device.");
        } else {
          showToast("🎙️ Mic error: " + permErr.message);
        }
        return;
      }

      // Step 3: leave any existing session first to prevent echo on rejoin
      if (agoraClient.current) {
        try {
          localAudioTrack.current?.stop();
          localAudioTrack.current?.close();
          await agoraClient.current.leave();
        } catch (e) {}
        agoraClient.current = null;
        localAudioTrack.current = null;
      }

      // Step 4: now join Agora with permission already granted
      agoraClient.current = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      await agoraClient.current.join(APP_ID, CHANNEL, TOKEN, null);
      localAudioTrack.current = await AgoraRTC.createMicrophoneAudioTrack();
      await agoraClient.current.publish(localAudioTrack.current);
      agoraClient.current.on("user-published", async (remoteUser, mediaType) => {
        await agoraClient.current.subscribe(remoteUser, mediaType);
        if (mediaType === "audio") remoteUser.audioTrack.play();
      });
      // Handle user leaving — stop their audio track
      agoraClient.current.on("user-unpublished", async (remoteUser, mediaType) => {
        if (mediaType === "audio") remoteUser.audioTrack?.stop();
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

  const handleLogout = () => {
    socketRef.current?.emit("leaveRoom");
    socketRef.current?.disconnect();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const getCursor = () => {
    if (tool === "pen") return "crosshair";
    if (tool === "pan") return isPanning ? "grabbing" : "grab";
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

  // ── SMALL REUSABLE COMPONENTS ── (defined first, used in MobileToolbar below)
  const ToolBtn = ({ children, active, onClick, tip, danger, small }) => (
    <button
      title={tip}
      onClick={onClick}
      style={{
        width: 44, height: 44,
        flexShrink: 0,
        border: "none",
        borderRadius: 10,
        cursor: "pointer",
        background: active ? "#7c6af7" : "transparent",
        color: danger ? "#f76a8a" : active ? "white" : "#8888aa",
        fontSize: small ? 14 : 18,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
        boxShadow: active ? "0 0 12px rgba(124,106,247,0.4)" : "none",
      }}
    >
      {children}
    </button>
  );

  const Divider = () => (
    <div style={{
      width: 1, height: 36, background: "#2a2a3a",
      flexShrink: 0, margin: "0 6px",
    }} />
  );

  const GroupLabel = ({ label }) => (
    <div style={{
      flexShrink: 0,
      fontSize: 9,
      fontWeight: 700,
      color: "#444466",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      writingMode: "vertical-lr",
      transform: "rotate(180deg)",
      height: 40,
      display: "flex",
      alignItems: "center",
      marginRight: 2,
      userSelect: "none",
    }}>
      {label}
    </div>
  );

  // ── MOBILE TOOLBAR SECTIONS ──
  // Each "section" is a labeled group rendered inline in the scroll strip
  const MobileToolbar = () => (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      height: 72,
      background: "#16161e",
      borderTop: "1px solid #2a2a3a",
      zIndex: 1000,
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Scroll hint fade edges */}
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 24,
        background: "linear-gradient(to right, #16161e, transparent)",
        zIndex: 2, pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 24,
        background: "linear-gradient(to left, #16161e, transparent)",
        zIndex: 2, pointerEvents: "none",
      }} />

      {/* Scrollable strip */}
      <div style={{
        flex: 1,
        overflowX: "auto",
        overflowY: "hidden",
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 28px",
        scrollbarWidth: "none", // Firefox
        msOverflowStyle: "none", // IE
        WebkitOverflowScrolling: "touch",
      }}
        className="hide-scrollbar"
      >

        {/* ── TOOLS GROUP ── */}
        <GroupLabel label="Tools" />
        {toolList.map(t => (
          <ToolBtn
            key={t.id}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
            tip={t.tip}
          >
            {t.icon}
          </ToolBtn>
        ))}

        <Divider />

        {/* ── STICKY + CLEAR ── */}
        <GroupLabel label="Actions" />
        <ToolBtn onClick={addStickyNote} tip="Sticky Note">📌</ToolBtn>
        <ToolBtn onClick={clearAll} tip="Clear Board" danger>🗑</ToolBtn>

        <Divider />

        {/* ── COLORS GROUP ── */}
        <GroupLabel label="Colors" />
        {colorList.map(c => (
          <div
            key={c}
            onClick={() => setColor(c)}
            title={c}
            style={{
              width: 28, height: 28,
              borderRadius: "50%",
              background: c,
              cursor: "pointer",
              flexShrink: 0,
              border: color === c ? "3px solid #7c6af7" : "2px solid #3a3a4a",
              boxShadow: color === c ? "0 0 8px rgba(124,106,247,0.6)" : "none",
              transform: color === c ? "scale(1.15)" : "scale(1)",
              transition: "all 0.15s",
            }}
          />
        ))}

        <Divider />

        {/* ── STROKE WIDTH ── */}
        <GroupLabel label="Size" />
        {strokeList.map(s => (
          <ToolBtn
            key={s}
            active={strokeWidth === s}
            onClick={() => setStrokeWidth(s)}
            tip={`Stroke ${s}px`}
          >
            <div style={{
              width: s === 2 ? 4 : s === 5 ? 8 : 14,
              height: s === 2 ? 4 : s === 5 ? 8 : 14,
              borderRadius: "50%",
              background: strokeWidth === s ? "white" : "#8888aa",
            }} />
          </ToolBtn>
        ))}

        <Divider />

        {/* ── FONT SIZE ── */}
        <GroupLabel label="Font" />
        <div style={{ flexShrink: 0 }}>
          <select
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            style={{
              background: "#1e1e2a",
              border: "1px solid #3a3a4a",
              color: "#e8e8f0",
              borderRadius: 8,
              padding: "6px 4px",
              fontSize: 12,
              cursor: "pointer",
              width: 52,
              height: 40,
            }}
          >
            {fontSizeList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <Divider />

        {/* ── ZOOM ── */}
        <GroupLabel label="Zoom" />
        <ToolBtn onClick={zoomOut} tip="Zoom Out">−</ToolBtn>
        <div style={{
          flexShrink: 0, minWidth: 40, textAlign: "center",
          fontSize: 11, color: "#8888aa", fontFamily: "monospace",
        }}>
          {Math.round(zoomLevel * 100)}%
        </div>
        <ToolBtn onClick={zoomIn} tip="Zoom In">+</ToolBtn>
        <ToolBtn onClick={resetZoom} tip="Reset Zoom" small>↺</ToolBtn>

        {/* Spacer at end */}
        <div style={{ width: 12, flexShrink: 0 }} />
      </div>

      {/* Hide scrollbar style */}
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0f0f13", overflow: "hidden", fontFamily: "sans-serif" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.3)}}
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ height: 52, background: "#16161e", borderBottom: "1px solid #2a2a3a", display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0, zIndex: 100, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "white", flexShrink: 0 }}>
          <div style={{ width: 26, height: 26, background: "linear-gradient(135deg,#7c6af7,#f76a8a)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>✦</div>
          CollabBoard
        </div>
        <div style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", borderRadius: 6, padding: "4px 10px", fontSize: 12, color: "#8888aa", fontFamily: "monospace", flexShrink: 0 }}>room: #{roomId}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 12, color: "#8888aa", flexShrink: 0 }}>
          <div style={{ width: 7, height: 7, background: "#6af7c8", borderRadius: "50%", animation: "pulse 2s infinite" }}></div>
          <div style={{ display: "flex" }}>
            {users.slice(0, 4).map((u, i) => (
              <div key={i} title={u.username} style={{ width: 28, height: 28, borderRadius: "50%", background: u.color || "#7c6af7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, border: "2px solid #0f0f13", marginLeft: i === 0 ? 0 : -6, color: "white" }}>
                {u.username?.[0]?.toUpperCase()}
              </div>
            ))}
          </div>
          <span>{users.length} online</span>
        </div>
        {!isMobile && <>
          <button onClick={exportImage} style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>⬇ PNG</button>
          <button onClick={exportPDF} style={{ background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>⬇ PDF</button>
          {!inCall ? (
            <button onClick={joinAudio} style={{ background: "#6af7c8", border: "none", color: "#000", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>🎙️ Join Voice</button>
          ) : (
            <>
              <button onClick={toggleMute} style={{ background: muted ? "#f76a8a" : "#6af7c8", border: "none", color: "#000", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>
                {muted ? "🔇 Unmute" : "🎙️ Mute"}
              </button>
              <button onClick={leaveAudio} style={{ background: "#f76a8a", border: "none", color: "white", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600, flexShrink: 0 }}>📵 Leave</button>
            </>
          )}
          <button onClick={() => setChatOpen(p => !p)} style={{ background: "#7c6af7", border: "none", color: "white", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>💬 Chat</button>
        </>}
        <button onClick={handleLogout} style={{ background: "rgba(247,106,138,0.1)", border: "1px solid #f76a8a", color: "#f76a8a", borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>Logout</button>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── DESKTOP SIDEBAR TOOLBAR ── */}
        {!isMobile && (
          <div style={{ width: 60, background: "#16161e", borderRight: "1px solid #2a2a3a", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 4, zIndex: 10 }}>
            {toolList.map(t => (
              <button key={t.id} title={t.tip} onClick={() => setTool(t.id)} style={{ width: 44, height: 44, border: "none", borderRadius: 10, cursor: "pointer", background: tool === t.id ? "#7c6af7" : "transparent", color: tool === t.id ? "white" : "#8888aa", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", boxShadow: tool === t.id ? "0 0 16px rgba(124,106,247,0.4)" : "none" }}>{t.icon}</button>
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }}></div>
            <select value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width: 44, background: "#1e1e2a", border: "1px solid #2a2a3a", color: "#e8e8f0", borderRadius: 8, padding: "4px 2px", fontSize: 11, cursor: "pointer" }}>
              {fontSizeList.map(s => (<option key={s} value={s}>{s}</option>))}
            </select>
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }}></div>
            <button title="Sticky Note" onClick={addStickyNote} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: "transparent", color: "#8888aa", fontSize: 18, cursor: "pointer" }}>📌</button>
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }}></div>
            {colorList.map(c => (
              <div key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "2px solid white" : "2px solid #2a2a3a", transform: color === c ? "scale(1.2)" : "scale(1)", transition: "all 0.15s" }}></div>
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }}></div>
            {strokeList.map(s => (
              <button key={s} onClick={() => setStrokeWidth(s)} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: strokeWidth === s ? "#1e1e2a" : "transparent", color: strokeWidth === s ? "white" : "#8888aa", fontSize: s === 2 ? 8 : s === 5 ? 13 : 20, cursor: "pointer" }}>●</button>
            ))}
            <div style={{ width: 32, height: 1, background: "#2a2a3a", margin: "4px 0" }}></div>
            <button title="Clear Board" onClick={clearAll} style={{ width: 44, height: 44, border: "none", borderRadius: 10, background: "transparent", color: "#f76a8a", fontSize: 18, cursor: "pointer" }}>🗑</button>
          </div>
        )}

        {/* ── CANVAS AREA ── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#ffffff", backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)", backgroundSize: "32px 32px", cursor: getCursor() }}>
          <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0 }} />
          <div id="stickyLayer" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}></div>

          {/* Zoom control — only on desktop */}
          {!isMobile && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: "#16161e", border: "1px solid #2a2a3a", borderRadius: 20, padding: "6px 14px", fontSize: 12, color: "#8888aa", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 10, zIndex: 10 }}>
              <button onClick={zoomOut} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 16 }}>−</button>
              <span>{Math.round(zoomLevel * 100)}%</span>
              <button onClick={zoomIn} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 16 }}>+</button>
              <button onClick={resetZoom} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 11 }}>Reset</button>
            </div>
          )}

          {/* Mobile: Chat + Voice buttons floating above toolbar */}
          {isMobile && (
            <div style={{ position: "absolute", bottom: 80, right: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 50 }}>
              <button onClick={() => setChatOpen(p => !p)} style={{ width: 44, height: 44, background: "#7c6af7", border: "none", borderRadius: 12, color: "white", fontSize: 18, cursor: "pointer", boxShadow: "0 4px 16px rgba(124,106,247,0.4)" }}>💬</button>
              {!inCall ? (
                <button onClick={joinAudio} style={{ width: 44, height: 44, background: "#6af7c8", border: "none", borderRadius: 12, color: "#000", fontSize: 18, cursor: "pointer", boxShadow: "0 4px 16px rgba(106,247,200,0.3)" }}>🎙️</button>
              ) : (
                <>
                  <button onClick={toggleMute} style={{ width: 44, height: 44, background: muted ? "#f76a8a" : "#6af7c8", border: "none", borderRadius: 12, color: "#000", fontSize: 18, cursor: "pointer" }}>
                    {muted ? "🔇" : "🎙️"}
                  </button>
                  <button onClick={leaveAudio} style={{ width: 44, height: 44, background: "#f76a8a", border: "none", borderRadius: 12, color: "white", fontSize: 18, cursor: "pointer" }}>📵</button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── CHAT PANEL ── */}
        {chatOpen && (
          <div style={{
            width: isMobile ? "100%" : 280,
            background: "#16161e",
            borderLeft: "1px solid #2a2a3a",
            display: "flex",
            flexDirection: "column",
            zIndex: 10,
            ...(isMobile ? {
              position: "fixed",
              bottom: 72,
              left: 0,
              right: 0,
              height: "55%",
              borderTop: "1px solid #2a2a3a",
              borderLeft: "none",
            } : {})
          }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #2a2a3a", fontSize: 13, fontWeight: 600, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>💬 Room Chat</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#6af7c8", fontSize: 11 }}>● {users.length} online</span>
                {isMobile && <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", color: "#8888aa", cursor: "pointer", fontSize: 16 }}>✕</button>}
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

      {/* ── MOBILE BOTTOM TOOLBAR ── */}
      {isMobile && <MobileToolbar />}

      {/* ── TOASTS ── */}
      <div style={{ position: "fixed", top: 64, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 1000 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: "#16161e", border: "1px solid #2a2a3a", borderLeft: "3px solid #6af7c8", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#e8e8f0", minWidth: 220, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

export default Board;
