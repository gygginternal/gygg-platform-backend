import { Server } from "socket.io";
import { ChatMessage } from "../models/ChatMessage.js";
import User from "../models/User.js"; // Import the User model
import Notification from "../models/Notification.js";
import logger from "../utils/logger.js";
import jwt from "jsonwebtoken";
import AppError from "../utils/AppError.js";

/**
 * Initialize WebSocket server for chat functionality with enhanced security.
 * @param {Object} server - The HTTP server instance.
 */
export const initializeChatWebsocket = (server) => {
  const io = new Server(server, {
    path: "/socket.io",
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    // Enhanced security settings
    maxHttpBufferSize: 1e6, // 1MB max message size
    connectTimeout: 45000, // 45 second timeout
  });

  // Store user socket mappings with expiration
  const userSockets = new Map();

  // Rate limiting for connections
  const connectionAttempts = new Map();
  const MAX_CONNECTIONS_PER_IP = 50;
  const CONNECTION_WINDOW_MS = 60000; // 1 minute

  // Log any engine-level connection errors
  io.engine.on("connection_error", (err) => {
    logger.error("[WS DEBUG] Socket.IO engine connection error:", err);
  });

  // Implement authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      // Get token from handshake auth or headers
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

      if (!token) {
        logger.warn(
          `[WS Security] Connection attempt without token: ${socket.id}`
        );
        return next(new Error("Authentication required"));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.id) {
        logger.warn(`[WS Security] Invalid token provided: ${socket.id}`);
        return next(new Error("Invalid authentication token"));
      }

      // Rate limiting by IP
      const clientIp = socket.handshake.address;
      const now = Date.now();

      // Clean up expired entries
      for (const [ip, data] of connectionAttempts.entries()) {
        if (now - data.timestamp > CONNECTION_WINDOW_MS) {
          connectionAttempts.delete(ip);
        }
      }

      // Check rate limit
      const ipData = connectionAttempts.get(clientIp) || {
        count: 0,
        timestamp: now,
      };
      if (ipData.count >= MAX_CONNECTIONS_PER_IP) {
        logger.warn(`[WS Security] Rate limit exceeded for IP: ${clientIp}`);
        return next(new Error("Connection rate limit exceeded"));
      }

      // Update rate limit counter
      connectionAttempts.set(clientIp, {
        count: ipData.count + 1,
        timestamp: now,
      });

      // Store user data in socket for later use
      socket.user = {
        id: decoded.id,
        role: decoded.role,
      };

      logger.debug(
        `[WS Security] Authenticated connection: ${socket.id} for user ${decoded.id}`
      );
      next();
    } catch (error) {
      logger.error(`[WS Security] Authentication error: ${error.message}`);
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    logger.debug(
      `[WS] Client connected: ${socket.id} (User: ${socket.user.id})`
    );

    // Sanitize input helper function
    const sanitizeInput = (input) => {
      if (typeof input === "string") {
        // Remove potential XSS and injection patterns
        return input.replace(/[<>'"();]/g, "");
      }
      return input;
    };

    // Validate room name format
    const isValidRoomName = (room) => {
      // Room should be in specific formats like chat:userId:userId or user:userId
      return /^(chat|user):[a-f\d]{24}(:[a-f\d]{24})?$/.test(room);
    };

    // Handle user subscription to notifications with validation
    socket.on("subscribeToNotifications", ({ userId }) => {
      // Validate userId matches authenticated user
      if (!userId || userId !== socket.user.id) {
        logger.warn(
          `[WS Security] Unauthorized subscription attempt: ${socket.id} for user ${userId}`
        );
        socket.emit("error", { message: "Unauthorized subscription attempt" });
        return;
      }

      const userIdStr = userId.toString();

      // Set socket mapping with 24-hour expiration
      userSockets.set(userIdStr, {
        socketId: socket.id,
        expires: Date.now() + 86400000, // 24 hours
      });

      // Join user's personal notification room
      socket.join(userIdStr);
      logger.debug(
        `User ${userId} subscribed to notifications (socket: ${socket.id})`
      );
    });

    // Handle user unsubscription from notifications
    socket.on("unsubscribeFromNotifications", ({ userId }) => {
      // Validate userId matches authenticated user
      if (!userId || userId !== socket.user.id) {
        logger.warn(
          `[WS Security] Unauthorized unsubscription attempt: ${socket.id} for user ${userId}`
        );
        socket.emit("error", {
          message: "Unauthorized unsubscription attempt",
        });
        return;
      }

      const userIdStr = userId.toString();
      userSockets.delete(userIdStr);
      socket.leave(userIdStr);
      logger.debug(`User ${userId} unsubscribed from notifications`);
    });

    // Handle joining a chat room with validation
    socket.on("join", (room) => {
      // Sanitize and validate room name
      const sanitizedRoom = sanitizeInput(room);

      if (!sanitizedRoom || !isValidRoomName(sanitizedRoom)) {
        logger.warn(
          `[WS Security] Invalid room join attempt: ${socket.id} for room ${room}`
        );
        socket.emit("error", { message: "Invalid room format" });
        return;
      }

      // For chat rooms, verify user is part of the conversation
      if (sanitizedRoom.startsWith("chat:")) {
        const participants = sanitizedRoom.split(":").slice(1);
        if (!participants.includes(socket.user.id)) {
          logger.warn(
            `[WS Security] Unauthorized room join: ${socket.id} for room ${sanitizedRoom}`
          );
          socket.emit("error", { message: "Unauthorized room access" });
          return;
        }
      }

      socket.join(sanitizedRoom);
      logger.debug(`Socket ${socket.id} joined room: ${sanitizedRoom}`);
    });

    // Handle leaving a chat room with validation
    socket.on("leave", (room) => {
      // Sanitize and validate room name
      const sanitizedRoom = sanitizeInput(room);

      if (!sanitizedRoom || !isValidRoomName(sanitizedRoom)) {
        logger.warn(
          `[WS Security] Invalid room leave attempt: ${socket.id} for room ${room}`
        );
        socket.emit("error", { message: "Invalid room format" });
        return;
      }

      socket.leave(sanitizedRoom);
      logger.debug(`Socket ${socket.id} left room: ${sanitizedRoom}`);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      logger.debug(`Client disconnected: ${socket.id}`);

      // Remove user from mapping
      for (const [userId, socketData] of userSockets.entries()) {
        if (socketData.socketId === socket.id) {
          userSockets.delete(userId);
          break;
        }
      }

      // Clean up expired socket mappings periodically
      const now = Date.now();
      for (const [userId, socketData] of userSockets.entries()) {
        if (socketData.expires < now) {
          userSockets.delete(userId);
        }
      }
    });

    // Handle errors
    socket.on("error", (error) => {
      logger.error(`[WS] Socket error for ${socket.id}: ${error.message}`);
    });
  });

  // Function to emit new message notification with security checks
  const emitNewMessage = (receiverId, message) => {
    try {
      // Validate inputs
      if (!receiverId || !message) {
        logger.warn("[WS Security] Invalid parameters for emitNewMessage");
        return;
      }

      const receiverIdStr = receiverId.toString();
      const socketData = userSockets.get(receiverIdStr);

      // Check if socket is still valid and not expired
      if (
        socketData &&
        socketData.socketId &&
        socketData.expires > Date.now()
      ) {
        // Sanitize message content if it's a text message
        if (message.content && message.type === "text") {
          // Basic sanitization for text content
          message.content = message.content.replace(/[<>'"();]/g, "");
        }

        io.to(socketData.socketId).emit("chat:newMessage", message);
        logger.debug(
          `Emitted new message notification to user ${receiverIdStr}`
        );
      } else {
        logger.debug(
          `No active socket found for user ${receiverIdStr} or socket expired`
        );
      }
    } catch (error) {
      logger.error(`Error in emitNewMessage: ${error.message}`);
    }
  };

  // Function to emit unread count update with security checks
  const emitUnreadCountUpdate = (userId, count) => {
    try {
      // Validate inputs
      if (!userId || typeof count !== "number") {
        logger.warn(
          "[WS Security] Invalid parameters for emitUnreadCountUpdate"
        );
        return;
      }

      const userIdStr = userId.toString();
      const socketData = userSockets.get(userIdStr);

      // Check if socket is still valid and not expired
      if (
        socketData &&
        socketData.socketId &&
        socketData.expires > Date.now()
      ) {
        io.to(socketData.socketId).emit("chat:unreadCountUpdated", { count });
        logger.debug(
          `Emitted unread count update (${count}) to user ${userIdStr}`
        );
      } else {
        logger.debug(
          `No active socket found for user ${userIdStr} or socket expired`
        );
      }
    } catch (error) {
      logger.error(`Error in emitUnreadCountUpdate: ${error.message}`);
    }
  };

  // Skip MongoDB change streams in test environment
  if (process.env.NODE_ENV !== "test") {
    // Listen for changes in the ChatMessage collection with enhanced security
    const chatMessageChangeStream = ChatMessage.watch();

    chatMessageChangeStream.on("change", async (change) => {
      try {
        // Use debug level for change stream events to avoid logging sensitive data in production
        logger.debug("[WS] Change detected in ChatMessage collection");

        if (change.operationType === "insert") {
          const newMessage = change.fullDocument;

          // Validate message structure
          if (!newMessage || !newMessage.sender || !newMessage.receiver) {
            logger.warn(
              "[WS Security] Invalid message structure detected in change stream"
            );
            return;
          }

          try {
            // Fetch the sender's full details to include in the notification payload
            const senderUser = await User.findById(newMessage.sender);
            if (!senderUser) {
              logger.warn(
                `[WS Security] Message from unknown sender: ${newMessage.sender}`
              );
              return;
            }

            // Sanitize message content if it's a text message
            let sanitizedContent = newMessage.content;
            if (
              newMessage.type === "text" &&
              typeof sanitizedContent === "string"
            ) {
              // Remove potential XSS and injection patterns
              sanitizedContent = sanitizedContent.replace(/[<>'"();]/g, "");
            }

            // Emit to the specific chat channel (for open chat windows)
            const chatChannel = `chat:${newMessage.sender}:${newMessage.receiver}`;
            logger.debug(`Emitting to chat channel: ${chatChannel}`);

            // Create a sanitized message payload
            const messagePayload = {
              _id: newMessage._id.toString(),
              sender: {
                _id: newMessage.sender.toString(),
                firstName: senderUser?.firstName || "",
                lastName: senderUser?.lastName || "",
                // Only include profile image URL, not the full object
                profileImage: senderUser?.profileImage?.url || null,
              },
              receiver: newMessage.receiver.toString(),
              content: sanitizedContent,
              type: newMessage.type || "text",
              timestamp: newMessage.timestamp,
            };

            // Send to the specific chat channel
            io.to(chatChannel).emit("newChatMessage", messagePayload);

            // Emit a personal notification to the receiver with minimal data
            const receiverNotificationChannel = `user:${newMessage.receiver}`;
            logger.debug(
              `Emitting notification to: ${receiverNotificationChannel}`
            );

            // Create a minimal notification payload with only necessary data
            const notificationPayload = {
              messageId: newMessage._id.toString(),
              senderId: newMessage.sender.toString(),
              senderName: senderUser ? senderUser.firstName : "",
              timestamp: newMessage.timestamp,
              // Don't include message content in notification
            };

            io.to(receiverNotificationChannel).emit(
              "notification:newMessage",
              notificationPayload
            );
          } catch (error) {
            logger.error(`[WS] Error processing new message: ${error.message}`);
          }
        } else if (
          change.operationType === "update" &&
          change.updateDescription?.updatedFields?.readStatus === true
        ) {
          try {
            // A message was updated, and its readStatus changed to true
            const updatedMessage = await ChatMessage.findById(
              change.documentKey._id
            );

            if (updatedMessage && updatedMessage.readStatus === true) {
              // If the message is now read, notify the receiver to refresh their unread count
              const receiverId = updatedMessage.receiver.toString();
              const notificationChannel = `user:${receiverId}`;
              logger.debug(
                `Emitting unread count update notification to: ${notificationChannel}`
              );
              io.to(notificationChannel).emit(
                "notification:unreadCountUpdated"
              );
            }
          } catch (error) {
            logger.error(
              `[WS] Error processing message update: ${error.message}`
            );
          }
        }
      } catch (error) {
        logger.error(
          `[WS] Error processing ChatMessage change stream: ${error.message}`
        );
      }
    });

    // Watch for new notifications and emit to the user with enhanced security
    Notification.watch().on("change", async (change) => {
      try {
        logger.debug("[WS] Notification change detected");

        if (change.operationType === "insert") {
          const notification = change.fullDocument;

          // Validate notification structure
          if (!notification || !notification.user) {
            logger.warn(
              "[WS Security] Invalid notification structure detected"
            );
            return;
          }

          const userIdStr = notification.user.toString();

          // Create a sanitized notification payload
          const sanitizedNotification = {
            _id: notification._id.toString(),
            type: notification.type,
            title: notification.title
              ? notification.title.replace(/[<>'"();]/g, "")
              : "",
            message: notification.message
              ? notification.message.replace(/[<>'"();]/g, "")
              : "",
            read: notification.read || false,
            createdAt: notification.createdAt,
            // Include only necessary reference IDs, not full objects
            user: userIdStr,
            // Only include reference IDs for related entities if they exist
            ...(notification.gig && { gig: notification.gig.toString() }),
            ...(notification.application && {
              application: notification.application.toString(),
            }),
            ...(notification.sender && {
              sender: notification.sender.toString(),
            }),
          };

          logger.debug(`[WS] Emitting notification:new to user ${userIdStr}`);

          // Send notification to user's room
          io.to(userIdStr).emit("notification:new", sanitizedNotification);
        }
      } catch (error) {
        logger.error(
          `[WS] Error processing Notification change stream: ${error.message}`
        );
      }
    });
  } else {
    logger.info("Skipping MongoDB change streams in test environment");
  }

  logger.info("Chat WebSocket server initialized.");

  return {
    emitNewMessage,
    emitUnreadCountUpdate,
  };
};
