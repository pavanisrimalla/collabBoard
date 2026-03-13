const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes.js");

const app = express();
app.use(cors());
app.use(express.json());
connectDB();
app.use("/api", authRoutes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};
const userColors = ["#7c6af7","#f76a8a","#6af7c8","#f7c86a","#f76af7","#6af7f7","#a8f76a","#f7a86a"];
function getRandomColor() {
  return userColors[Math.floor(Math.random() * userColors.length)];
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinRoom", ({ roomId, username }) => {
    if (!roomId || !username) return;
    if (socket.currentRoom) leaveCurrentRoom(socket);
    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.username = username;
    if (!rooms[roomId]) rooms[roomId] = { users: {} };
    rooms[roomId].users[socket.id] = { username, color: getRandomColor(), socketId: socket.id };
    console.log(`${username} joined room: ${roomId}`);
    socket.emit("roomJoined", { roomId, users: Object.values(rooms[roomId].users) });
    socket.to(roomId).emit("userJoined", { username, color: rooms[roomId].users[socket.id].color, users: Object.values(rooms[roomId].users) });
  });

  socket.on("leaveRoom", () => leaveCurrentRoom(socket));

  // Drawing sync
  socket.on("draw", ({ roomId, drawData }) => {
    socket.to(roomId).emit("draw", drawData);
  });

  // Full canvas sync (used for eraser)
  socket.on("syncCanvas", ({ roomId, canvasJSON }) => {
    if (!roomId) return;
    socket.to(roomId).emit("syncCanvas", canvasJSON);
  });

  // Clear board
  socket.on("clearBoard", ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit("clearBoard");
  });

  // Sticky notes
  socket.on("addSticky", ({ roomId, id, left, top, colIndex }) => {
    if (!roomId || id === undefined) return;
    socket.to(roomId).emit("addSticky", { id, left, top, colIndex });
  });

  socket.on("updateSticky", ({ roomId, id, text }) => {
    if (!roomId || id === undefined) return;
    socket.to(roomId).emit("updateSticky", { id, text });
  });

  socket.on("deleteSticky", ({ roomId, id }) => {
    if (!roomId || id === undefined) return;
    socket.to(roomId).emit("deleteSticky", { id });
  });
socket.on("pan", ({ roomId, vpt }) => {
  socket.to(roomId).emit("pan", vpt);
});
  // Chat
  socket.on("chatMessage", ({ roomId, message }) => {
    const user = rooms[roomId]?.users[socket.id];
    io.to(roomId).emit("chatMessage", {
      username: user?.username || "Unknown",
      color: user?.color || "#7c6af7",
      message,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    leaveCurrentRoom(socket);
  });
});

function leaveCurrentRoom(socket) {
  const roomId = socket.currentRoom;
  if (!roomId) return;
  socket.leave(roomId);
  if (rooms[roomId]) {
    const username = rooms[roomId].users[socket.id]?.username;
    delete rooms[roomId].users[socket.id];
    socket.to(roomId).emit("userLeft", { username, users: Object.values(rooms[roomId].users) });
    if (Object.keys(rooms[roomId].users).length === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted (empty)`);
    }
  }
  socket.currentRoom = null;
}

server.listen(5000, () => console.log("Server running on port 5000"));
