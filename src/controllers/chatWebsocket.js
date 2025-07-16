import { Server } from "socket.io";
import { ChatMessage } from "../models/ChatMessage.js";
import User from "../models/User.js"; // Import the User model
import Notification from "../models/Notification.js";

/**
 * Initialize WebSocket server for chat functionality.
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
  });

  // Store user socket mappings
  const userSockets = new Map();

  // Log any engine-level connection errors
  io.engine.on("connection_error", (err) => {
    console.error("[WS DEBUG] Socket.IO engine connection error:", err);
  });

  io.on("connection", (socket) => {
    console.log("[WS DEBUG] Client connected (top of handler):", socket.id);

    // Handle user subscription to notifications
    socket.on("subscribeToNotifications", ({ userId }) => {
      console.log(`User ${userId} subscribed to notifications`);
      const userIdStr = userId.toString();
      userSockets.set(userIdStr, socket.id);
      socket.join(userIdStr);
      console.log(
        "[WS DEBUG] User joined room:",
        userIdStr,
        "typeof:",
        typeof userIdStr
      );
      console.log(
        "[WS DEBUG] All rooms:",
        Array.from(io.sockets.adapter.rooms.keys())
      );
    });

    // Handle user unsubscription from notifications
    socket.on("unsubscribeFromNotifications", ({ userId }) => {
      console.log(`User ${userId} unsubscribed from notifications`);
      const userIdStr = userId.toString();
      userSockets.delete(userIdStr);
      socket.leave(userIdStr);
    });

    // Handle joining a chat room
    socket.on("join", (room) => {
      console.log(`Socket ${socket.id} joining room: ${room}`);
      socket.join(room);
    });

    // Handle leaving a chat room
    socket.on("leave", (room) => {
      console.log(`Socket ${socket.id} leaving room: ${room}`);
      socket.leave(room);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      // Remove user from mapping
      for (const [userId, socketId] of userSockets.entries()) {
        if (socketId === socket.id) {
          userSockets.delete(userId);
          break;
        }
      }
    });
  });

  // Function to emit new message notification
  const emitNewMessage = (receiverId, message) => {
    const receiverIdStr = receiverId.toString();
    const receiverSocketId = userSockets.get(receiverIdStr);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("chat:newMessage", message);
    }
  };

  // Function to emit unread count update
  const emitUnreadCountUpdate = (userId, count) => {
    const userIdStr = userId.toString();
    const socketId = userSockets.get(userIdStr);
    if (socketId) {
      io.to(socketId).emit("chat:unreadCountUpdated", { count });
    }
  };

  // Listen for changes in the ChatMessage collection
  const chatMessageChangeStream = ChatMessage.watch();

  chatMessageChangeStream.on("change", async (change) => {
    try {
      console.info("Change detected in ChatMessage collection:", change);

      if (change.operationType === "insert") {
        const newMessage = change.fullDocument;

        // Fetch the sender's full details to include in the notification payload
        const senderUser = await User.findById(newMessage.sender);

        // Emit to the specific chat channel (for open chat windows)
        const chatChannel = `chat:${newMessage.sender}:${newMessage.receiver}`;
        console.log(`Emitting to chat channel: ${chatChannel}`);
        io.to(chatChannel).emit("newChatMessage", {
          _id: newMessage._id,
          sender: {
            _id: newMessage.sender.toString(),
            firstName: senderUser?.firstName || "",
            lastName: senderUser?.lastName || "",
            profileImage: senderUser?.profileImage || null,
          },
          receiver: newMessage.receiver.toString(),
          content: newMessage.content,
          type: newMessage.type || "text",
          timestamp: newMessage.timestamp,
        });

        // Emit a personal notification to the receiver
        const receiverNotificationChannel = `user:${newMessage.receiver}`;
        console.log(`Emitting notification to: ${receiverNotificationChannel}`);
        io.to(receiverNotificationChannel).emit("notification:newMessage", {
          messageId: newMessage._id,
          senderId: newMessage.sender.toString(),
          senderName: senderUser ? senderUser.firstName : "",
          timestamp: newMessage.timestamp,
        });
      } else if (
        change.operationType === "update" &&
        change.updateDescription.updatedFields.readStatus
      ) {
        // A message was updated, and its readStatus changed
        const updatedMessage = await ChatMessage.findById(
          change.documentKey._id
        );
        if (updatedMessage && updatedMessage.readStatus === true) {
          // If the message is now read, notify the receiver to refresh their unread count
          const receiverId = updatedMessage.receiver.toString();
          const notificationChannel = `user:${receiverId}`;
          console.log(
            `Emitting unread count update notification to: ${notificationChannel}`
          );
          io.to(notificationChannel).emit("notification:unreadCountUpdated");
        }
      }
    } catch (error) {
      console.error("Error processing ChatMessage change stream:", error);
    }
  });

  // Watch for new notifications and emit to the user
  Notification.watch().on("change", async (change) => {
    try {
      console.log("[WS DEBUG] Notification change detected:", change);
      if (change.operationType === "insert") {
        const notification = change.fullDocument;
        if (notification && notification.user) {
          console.log(
            "[WS DEBUG] Emitting notification:new to",
            notification.user.toString(),
            "typeof:",
            typeof notification.user.toString(),
            notification
          );
          io.to(notification.user.toString()).emit(
            "notification:new",
            notification
          );
        }
      }
    } catch (error) {
      console.error("Error processing Notification change stream:", error);
    }
  });

  console.info("Chat WebSocket server initialized.");

  return {
    emitNewMessage,
    emitUnreadCountUpdate,
  };
};
