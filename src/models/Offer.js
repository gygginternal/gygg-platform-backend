import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.ObjectId,
      ref: "Applicance",
      required: true,
    },
    gig: {
      type: mongoose.Schema.ObjectId,
      ref: "Gig", // Reference the Gig model
      required: true,
    },
    provider: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
    tasker: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const Offer = mongoose.model("Offer", offerSchema);
