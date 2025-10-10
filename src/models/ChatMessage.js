import mongoose from "mongoose";
import { sanitizeMessageContent } from "../utils/sanitizer.js";

// Define schema for chat messages
const chatMessageSchema = new mongoose.Schema(
  {
    // The contract to which the message belongs (optional for direct messages)
    contract: {
      type: mongoose.Schema.ObjectId, // Refers to a Contract document
      ref: "Contract", // Linked model
      required: false, // Make contract optional
      index: true, // Indexing for faster query retrieval based on contract
    },

    // The user who sent the message
    sender: {
      type: mongoose.Schema.ObjectId, // Refers to a User document
      ref: "User", // Linked model
      required: [true, "A message must have a sender."], // Ensure sender exists
    },

    // The user who receives the message
    receiver: {
      type: mongoose.Schema.ObjectId, // Refers to a User document
      ref: "User", // Linked model
      required: [true, "A message must have a receiver."], // Ensure receiver exists
      index: true, // Indexing for faster query retrieval based on receiver
    },

    // The content of the message
    content: {
      type: String, // Store the message content
      required: [true, "Message content cannot be empty."], // Ensure message is not empty
      trim: true, // Remove leading/trailing spaces
    },

    // Support for rich text content (optional)
    htmlContent: {
      type: String, // Store the message content
      trim: true, // Remove leading/trailing spaces
    },

    // Message type (text, image, file, etc.)
    type: {
      type: String,
      enum: ['text', 'image', 'file', 'system'],
      default: 'text'
    },

    // For file/image messages
    attachment: {
      url: String,
      fileName: String,
      fileType: String,
      fileSize: Number
    },

    // Indicates whether the message has been read
    readStatus: {
      type: Boolean, // Boolean indicating if the message has been read
      default: false, // Default value is false (unread)
      index: true, // Indexing for faster querying of read/unread status
    },

    // Timestamp when the message was sent
    timestamp: {
      type: Date,
      default: Date.now, // Default to current time when the message is created
      index: true, // Indexing for fast sorting and querying by timestamp
    }
  },
  {
    timestamps: { createdAt: "timestamp", updatedAt: false }, // Set createdAt as 'timestamp' and no updatedAt
  }
);

// Pre-save middleware to sanitize content before storing
chatMessageSchema.pre('save', function(next) {
  if (this.content && typeof this.content === 'string') {
    this.content = sanitizeMessageContent(this.content, this.type || 'text');
  }
  
  if (this.htmlContent && typeof this.htmlContent === 'string') {
    this.htmlContent = sanitizeMessageContent(this.htmlContent, 'html');
  }
  
  next();
});

// Pre-find middleware to populate sender details (firstName, lastName, and profileImage)
chatMessageSchema.pre(/^find/, function (next) {
  this.populate({
    path: "sender", // Populate sender field
    select: "firstName lastName profileImage", // Include only these fields for sender
  });
  next(); // Proceed with the query
});

// Create the ChatMessage model from the schema
export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

// Export the model for use in other parts of the application
export default ChatMessage;
