import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

function Room() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user"));
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  };

  const handleJoin = () => {
    if (!roomId.trim()) {
      setError("Please enter or generate a room ID");
      return;
    }
    navigate(`/board/${roomId.trim().toUpperCase()}`);
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: "460px" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"28px" }}>
          <div className="auth-logo" style={{ margin:0 }}>
            <div className="auth-logo-icon">✦</div>
            <span className="auth-logo-text">CollabBoard</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <span style={{ fontSize:"13px", color:"var(--text2)" }}>👋 {user?.username}</span>
            <button onClick={handleLogout} style={{
              background:"rgba(247,106,138,0.1)", border:"1px solid var(--accent2)",
              color:"var(--accent2)", borderRadius:"7px", padding:"5px 10px",
              fontSize:"12px", cursor:"pointer", fontFamily:"inherit"
            }}>Logout</button>
          </div>
        </div>

        <h1 className="auth-title">Join a Room</h1>
        <p className="auth-subtitle">Create a new room or join an existing one</p>

        {error && <div className="error-msg">⚠️ {error}</div>}

        {/* Room ID input */}
        <div className="form-group">
          <label className="form-label">Room ID</label>
          <div style={{ display:"flex", gap:"8px" }}>
            <input
              className="form-input"
              type="text"
              placeholder="Enter room ID e.g. ABC123"
              value={roomId}
              onChange={(e) => { setRoomId(e.target.value.toUpperCase()); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              style={{ flex:1 }}
            />
            <button onClick={generateRoomId} style={{
              background:"var(--surface2)", border:"1px solid var(--border)",
              color:"var(--text)", borderRadius:"10px", padding:"0 14px",
              fontSize:"13px", cursor:"pointer", fontFamily:"inherit",
              whiteSpace:"nowrap", fontWeight:600
            }}>🎲 Generate</button>
          </div>
        </div>

        <button className="auth-btn" onClick={handleJoin}>
          Join Room →
        </button>

        {/* Divider */}
        <div style={{ display:"flex", alignItems:"center", gap:"12px", margin:"20px 0" }}>
          <div style={{ flex:1, height:"1px", background:"var(--border)" }}></div>
          <span style={{ fontSize:"12px", color:"var(--text2)" }}>or</span>
          <div style={{ flex:1, height:"1px", background:"var(--border)" }}></div>
        </div>

        {/* Create new room */}
        <button
          onClick={() => { generateRoomId(); }}
          style={{
            width:"100%", padding:"13px", background:"transparent",
            border:"1px dashed var(--accent)", color:"var(--accent)",
            borderRadius:"10px", fontSize:"14px", fontWeight:600,
            fontFamily:"inherit", cursor:"pointer", transition:"all 0.15s"
          }}
          onMouseOver={e => e.target.style.background="rgba(124,106,247,0.1)"}
          onMouseOut={e => e.target.style.background="transparent"}
        >
          ✦ Create New Room
        </button>

        {/* Info */}
        <p style={{ fontSize:"12px", color:"var(--text2)", textAlign:"center", marginTop:"20px" }}>
          Share the Room ID with others so they can join your board
        </p>

      </div>
    </div>
  );
}

export default Room;