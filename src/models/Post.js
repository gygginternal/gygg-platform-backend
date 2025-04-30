import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const postSchema = new mongoose.Schema({
  author: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A post must have an author.']
  },
  content: {
    type: String,
    required: [true, 'Post content cannot be empty.'],
    trim: true,
    maxlength: [2000, 'Post content cannot exceed 2000 characters.']
  },
  media: [{
    type: String,
    trim: true
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  likes: [{
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }],
  likeCount: {
    type: Number,
    default: 0,
    min: 0
  },
  comments: [commentSchema],
  commentCount: {
    type: Number,
    default: 0,
    min: 0
  },
  location: {
    type: {
      type: String,
      enum: ['Point']
    },
    coordinates: {
      type: [Number],
      index: '2dsphere'
    },
    address: {
      type: String,
      trim: true
    }
  },
  trendingScore: {
    type: Number,
    default: 0,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
postSchema.index({ author: 1 });
postSchema.index({ tags: 1 });

// Middleware to update likeCount and commentCount
postSchema.pre('save', function (next) {
  if (this.isModified('likes')) {
    this.likeCount = this.likes.length;
  }
  if (this.isModified('comments')) {
    this.commentCount = this.comments.length;
  }
  next();
});

// Auto-populate author and comment author details
postSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'author',
    select: 'firstName lastName profileImage role'
  }).populate({
    path: 'comments.author',
    select: 'firstName lastName profileImage'
  });
  next();
});

const Post = mongoose.model('Post', postSchema);

export default Post;
