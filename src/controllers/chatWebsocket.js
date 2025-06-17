import { Server } from "socket.io";
import { ChatMessage } from "../models/ChatMessage.js";
import User from "../models/User.js"; // Import the User model

/**
 * Initialize WebSocket server for chat functionality.
 * @param {Object} server - The HTTP server instance.
 */
export const initializeChatWebsocket = (server) => {
  const io = new Server(server, {
    path: "/socketio", // Define a custom path for WebSocket connections
    cors: {
      origin: "*", // Allow all origins (adjust for production security)
    },
  });

  // Store user socket mappings
  const userSockets = new Map();

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Handle user subscription to notifications
    socket.on("subscribeToNotifications", ({ userId }) => {
      console.log(`User ${userId} subscribed to notifications`);
      userSockets.set(userId, socket.id);
    });

    // Handle user unsubscription from notifications
    socket.on("unsubscribeFromNotifications", ({ userId }) => {
      console.log(`User ${userId} unsubscribed from notifications`);
      userSockets.delete(userId);
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
    const receiverSocketId = userSockets.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("chat:newMessage", message);
    }
  };

  // Function to emit unread count update
  const emitUnreadCountUpdate = (userId, count) => {
    const socketId = userSockets.get(userId);
    if (socketId) {
      io.to(socketId).emit("chat:unreadCountUpdated", { count });
    }
  };

  // Listen for changes in the ChatMessage collection
  const chatMessageChangeStream = ChatMessage.watch();

  chatMessageChangeStream.on("change", async (change) => {
    console.info("Change detected in ChatMessage collection:", change);

    if (change.operationType === "insert") {
      const newMessage = change.fullDocument;

      // Fetch the sender's full details to include in the notification payload
      const senderUser = await User.findById(newMessage.sender);

      // Emit to the specific chat channel (for open chat windows)
      const chatChannel = `chat:${newMessage.sender}:${newMessage.receiver}`;
      console.log(`Emitting to chat channel: ${chatChannel}`);
      io.to(chatChannel).emit("newChatMessage", {
        sender: newMessage.sender.toString(),
        receiver: newMessage.receiver.toString(),
        content: newMessage.content,
        timestamp: newMessage.timestamp,
      });

      // Emit a personal notification to the receiver
      const receiverNotificationChannel = `user:${newMessage.receiver}`;
      console.log(`Emitting notification to: ${receiverNotificationChannel}`);
      io.to(receiverNotificationChannel).emit("notification:newMessage", {
        messageId: newMessage._id,
        senderId: newMessage.sender.toString(),
        senderName: senderUser ? senderUser.firstName : "", // Use populated firstName
        contractId: newMessage.contract.toString(),
        timestamp: newMessage.timestamp,
      });
    } else if (change.operationType === 'update' && change.updateDescription.updatedFields.readStatus) {
        // A message was updated, and its readStatus changed
        const updatedMessage = await ChatMessage.findById(change.documentKey._id);
        if (updatedMessage && updatedMessage.readStatus === true) {
            // If the message is now read, notify the receiver to refresh their unread count
            const receiverId = updatedMessage.receiver.toString();
            const notificationChannel = `user:${receiverId}`;
            console.log(`Emitting unread count update notification to: ${notificationChannel}`);
            io.to(notificationChannel).emit("notification:unreadCountUpdated");
        }
    }
  });

  console.info("Chat WebSocket server initialized.");

  return {
    emitNewMessage,
    emitUnreadCountUpdate,
  };
};
