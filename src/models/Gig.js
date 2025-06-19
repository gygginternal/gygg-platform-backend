import mongoose from "mongoose";

// Category and subcategory definitions
const CATEGORY_ENUM = [
  "Household Services",
  "Personal Assistant",
  "Pet Care",
  "Technology and Digital Assistance",
  "Event Support",
  "Moving and Organization",
  "Creative and Costume Tasks",
  "General Errands",
  "Other",
];

const SUBCATEGORIES_MAP = {
  "Household Services": [
    "Furniture assembly and disassembly",
    "Laundry folding and ironing" /*...*/,
  ],
  "Personal Assistant": [
    "Scheduling appointments and calendar management" /*...*/,
  ],
  "Pet Care": ["Dog walking and potty breaks" /*...*/],
  "Technology and Digital Assistance": [
    "Setting up smartphones, tablets, or smart TVs" /*...*/,
  ],
  "Event Support": ["Party setup and teardown" /*...*/],
  "Moving and Organization": ["Packing and unpacking" /*...*/],
  "Creative and Costume Tasks": [
    "Personal costume design or fitting help" /*...*/,
  ],
  "General Errands": ["Grocery shopping and delivery" /*...*/],
  Other: ["Other"],
};

// Gig Schema Definition
const gigSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [5, "Title must be at least 5 characters long"],
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: [20, "Description must be at least 20 characters long"],
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: {
        values: CATEGORY_ENUM,
        message: "Invalid category. Please select from the provided options.",
      },
    },
    subcategory: {
      type: String,
      trim: true,
    },
    cost: {
      type: Number,
      required: [true, "A gig must have a cost"],
      min: [0, "Cost cannot be negative"],
    },
    location: {
      address: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    isRemote: {
      type: Boolean,
      default: false,
    },
    deadline: {
      type: Date,
    },
    duration: {
      type: Number, // in hours
    },
    skills: [
      {
        type: String,
        trim: true,
      },
    ],
    postedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "A gig must belong to a user"],
    },
    assignedTo: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      default: "open",
    },
    attachments: [
      {
        fileName: String,
        filePath: String,
        fileType: String,
        fileSize: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    completionProof: [
      {
        fileName: String,
        filePath: String,
        fileType: String,
        fileSize: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true, // auto manages createdAt and updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes to improve query performance
gigSchema.index(
  {
    title: "text",
    description: "text",
    skills: "text", // If you want to search within the skills array
    category: "text", // Optional: include category in text search
    subcategory: "text", // Optional: include subcategory
  },
  {
    weights: {
      // Assign weights to prioritize matches in certain fields
      title: 10,
      skills: 7,
      category: 5,
      description: 3,
    },
    name: "GigTextSearchIndex", // Optional: name for the index
  }
);

gigSchema.index({ status: 1, category: 1 });
gigSchema.index({ postedBy: 1 });
gigSchema.index({ assignedTo: 1 });

// Auto-populate user fields when querying gigs
gigSchema.pre(/^find/, function (next) {
  this.populate({
    path: "postedBy",
    select: "firstName lastName profileImage rating fullName",
  });

  if (
    !this.options?.skipPopulateAssignedTo &&
    this.getQuery().assignedTo !== undefined
  ) {
    this.populate({
      path: "assignedTo",
      select: "firstName lastName profileImage rating",
    });
  }

  next();
});

// Model Creation
const Gig = mongoose.model("Gig", gigSchema);

// Exporting for controller and validation usage
export { Gig, SUBCATEGORIES_MAP, CATEGORY_ENUM };
