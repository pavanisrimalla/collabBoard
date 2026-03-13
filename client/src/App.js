import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Room from "./pages/Room";
import Board from "./pages/Board";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/room" element={
          <ProtectedRoute><Room /></ProtectedRoute>
        } />
        <Route path="/board/:roomId" element={
          <ProtectedRoute><Board /></ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

export default App;