import express from "express";
import { matchTaskers } from "../controllers/taskersController.js";
import { protect, restrictTo } from "../controllers/authController.js"; // Middleware to protect routes that require authentication

const router = express.Router();

// Protect all routes below this middleware
router.use(protect);

// Route to filter users for taskers
router.get("/matched", restrictTo("provider"), matchTaskers);

export default router;
