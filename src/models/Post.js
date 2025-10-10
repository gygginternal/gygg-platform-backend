import mongoose from 'mongoose';
import { sanitizeMessageContent } from "../utils/sanitizer.js";

// Define the schema for a comment
const commentSchema = new mongoose.Schema({
    // Reference to the author of the comment
    author: {
        type: mongoose.Schema.ObjectId,
        ref: 'User', // Refers to the 'User' model
        required: true, // Author is a required field
    },
    // Text content of the comment
    text: {
        type: String,
        required: true, // Comment text is mandatory
        trim: true, // Removes extra spaces around the comment text
    },
    // Timestamp for when the comment was created
    createdAt: {
        type: Date,
        default: Date.now, // Defaults to the current date and time
    }
}, { _id: true }); // Explicitly defining _id for comments to maintain uniqueness

// Define the schema for a social post
const socialPostSchema = new mongoose.Schema({
    // Reference to the author of the post
    author: {
        type: mongoose.Schema.ObjectId,
        ref: 'User', // Refers to the 'User' model
        required: [true, 'A post must have an author.'], // Error message if author is missing
        index: true, // Index for better search performance
    },
    // Content of the post (text-based)
    content: {
        type: String,
        required: [true, 'Post content cannot be empty.'], // Ensures post content is not empty
        trim: true, // Trims any whitespace around the content
        maxlength: [2000, 'Post content cannot exceed 2000 characters.'], // Limits content to 2000 characters
    },
    // Media files associated with the post (URLs, image links, etc.)
    media: [{
        type: String,
        trim: true, // Trims any extra spaces around media URLs
    }],
    // Tags associated with the post
    tags: [{
        type: String,
        trim: true, // Trims spaces from tags
        lowercase: true, // Converts tags to lowercase for uniformity
        index: true, // Index for better search performance
    }],
    // List of users who liked the post
    likes: [{
        type: mongoose.Schema.ObjectId,
        ref: 'User', // Refers to the 'User' model for liked users
    }],
    // Count of likes on the post
    likeCount: {
        type: Number,
        default: 0, // Default to 0 likes
        min: 0, // Like count can't go below 0
    },
    // List of comments on the post
    comments: [commentSchema], // Embed the comment schema for each post
    // Count of comments on the post
    commentCount: {
        type: Number,
        default: 0, // Default to 0 comments
        min: 0, // Comment count can't go below 0
    },
    // Geolocation data for the post (optional)
    location: {
        // Geospatial data with the 'Point' type
        type: { type: String, enum: ['Point'] },
        coordinates: {
            type: [Number], // [longitude, latitude]
            index: '2dsphere', // Index for geospatial queries
        },
        // Address associated with the location (optional)
        address: {
            type: String,
            trim: true, // Trims extra spaces in the address
        },
    },
    // Score indicating how "trending" the post is (used for sorting)
    trendingScore: {
        type: Number,
        default: 0, // Default to 0, can be updated based on other factors
        index: true, // Index for faster querying and sorting by trendingScore
    },
}, { timestamps: true }); // Automatically adds createdAt and updatedAt fields

// Pre-save middleware to sanitize content and update likeCount and commentCount before saving the post
socialPostSchema.pre('save', function(next) {
    // Sanitize post content
    if (this.content && typeof this.content === 'string') {
        this.content = sanitizeMessageContent(this.content);
    }
    
    // Sanitize tags
    if (this.tags && Array.isArray(this.tags)) {
        this.tags = this.tags.map(tag => 
            typeof tag === 'string' ? sanitizeMessageContent(tag) : tag
        );
    }
    
    // Sanitize location address
    if (this.location && this.location.address && typeof this.location.address === 'string') {
        this.location.address = sanitizeMessageContent(this.location.address);
    }
    
    // Sanitize comments
    if (this.comments && Array.isArray(this.comments)) {
        this.comments = this.comments.map(comment => {
            if (comment.text && typeof comment.text === 'string') {
                comment.text = sanitizeMessageContent(comment.text);
            }
            return comment;
        });
    }
    
    // If likes array is modified, update likeCount to match the number of likes
    if (this.isModified('likes')) {
        this.likeCount = this.likes.length;
    }
    // If comments array is modified, update commentCount to match the number of comments
    if (this.isModified('comments')) {
        this.commentCount = this.comments.length;
    }
    next(); // Proceed to save the document
});

// Pre-find middleware to auto-populate the author and comment author fields when querying posts
socialPostSchema.pre(/^find/, function(next) {
    this.populate({
        path: 'author', // Auto-populate the 'author' field
        select: 'firstName lastName profileImage role', // Select relevant fields of the author
    })
    .populate({
        path: 'comments.author', // Auto-populate the 'author' field for each comment
        select: 'firstName lastName profileImage', // Select relevant fields of the comment author
    });
    next(); // Proceed with the query
});

// Create the Post model based on the socialPostSchema
const Post = mongoose.model('Post', socialPostSchema);

// Export the Post model for use in other parts of the application
export default Post;
