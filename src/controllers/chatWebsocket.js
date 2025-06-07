import { Server } from "socket.io";
import { ChatMessage } from "../models/ChatMessage.js";

/**
 * Initialize WebSocket server for chat functionality.
 * @param {Object} server - The HTTP server instance.
 */
export const initializeChatWebSocket = (server) => {
  const io = new Server(server, {
    path: "/socketio", // Define a custom path for WebSocket connections
    cors: {
      origin: "*", // Allow all origins (adjust for production security)
    },
  });

  // WebSocket connection handler
  io.on("connection", (socket) => {
    // Subscribe to a specific chat channel between two users
    socket.on("subscribeToChat", ({ currentUserId, targetUserId }) => {
      const sortedIds = [currentUserId, targetUserId].sort();
      const chatChannel = `chat:${sortedIds[0]}:${sortedIds[1]}`;

      console.info(`User subscribed to chat channel: ${chatChannel}`);
      socket.join(chatChannel); // Join the specific chat channel
    });

    // Handle disconnection
  });

  // Listen for changes in the ChatMessage collection
  const chatMessageChangeStream = ChatMessage.watch();

  chatMessageChangeStream.on("change", (change) => {
    console.info("Change detected in ChatMessage collection:", change);

    if (change.operationType === "insert") {
      const newMessage = change.fullDocument;

      // Create a chat channel name based on sender and receiver IDs
      const chatChannel = `chat:${newMessage.sender}:${newMessage.receiver}`;
      console.log({ chatChannel });

      // Broadcast the new message to the specific chat channel
      io.to(chatChannel).emit("newChatMessage", {
        sender: newMessage.sender.toString(),
        receiver: newMessage.receiver.toString(),
        content: newMessage.content,
        timestamp: newMessage.timestamp,
      });
    }
  });

  console.info("Chat WebSocket server initialized.");
};
