const express = require("express");
const router = express.Router();

const { registerUser,loginUser } = require("../controllers/authController");

// Signup route
router.post("/register", registerUser);
router.post("/login", loginUser);
module.exports = router;