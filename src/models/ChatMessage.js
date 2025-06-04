import mongoose from "mongoose";

// Define schema for chat messages
const chatMessageSchema = new mongoose.Schema(
  {
    // The contract to which the message belongs
    contract: {
      type: mongoose.Schema.ObjectId, // Refers to a Contract document
      ref: "Contract", // Linked model
      required: [true, "A message must belong to a contract."], // Ensure contract exists for every message
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
    htmlContent: {
      type: String, // Store the message content
      required: [true, "Message content cannot be empty."], // Ensure message is not empty
      trim: true, // Remove leading/trailing spaces
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
    },
  },
  {
    timestamps: { createdAt: "timestamp", updatedAt: false }, // Set createdAt as 'timestamp' and no updatedAt
  }
);

// Pre-find middleware to populate sender details (firstName, lastName, and profileImage)
chatMessageSchema.pre(/^find/, function (next) {
  this.populate({
    path: "sender", // Populate sender field
    select: "firstName lastName profileImage", // Include only these fields for sender
  });
  next(); // Proceed with the query
});

// Create the ChatMessage model from the schema
const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

// Export the model for use in other parts of the application
export default ChatMessage;
