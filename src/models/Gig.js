import mongoose from 'mongoose';

const CATEGORY_ENUM = [
  'Household Services',
  'Personal Assistant',
  'Pet Care',
  'Technology and Digital Assistance',
  'Event Support',
  'Moving and Organization',
  'Creative and Costume Tasks',
  'General Errands',
  'Other'
];

const SUBCATEGORIES_MAP = {
  'Household Services': [
    'Furniture assembly and disassembly',
    'Home office cable management',
    'Setting up home entertainment systems',
    'Deep cleaning and organizing',
    'Yard work and gardening',
    'BBQ grill cleaning',
    'Laundry folding and ironing',
    'Closet or storage decluttering',
    'Light maintenance tasks (e.g., hanging shelves, tightening doorknobs)'
  ],
  'Personal Assistant': [
    'Scheduling appointments and calendar management',
    'Grocery list prep and meal planning',
    'Virtual reminders and follow-ups',
    'Bill payment tracking',
    'Gift sourcing and wrapping',
    'Companionship errands (e.g., joining for appointments or walks)',
    'Travel planning support'
  ],
  'Pet Care': [
    'Dog walking and potty breaks',
    'Pet sitting (day or overnight)',
    'Feeding and medication administration',
    'Grooming assistance (brushing, basic baths)',
    'Litter box or cage cleaning',
    'Vet appointment companionship'
  ],
  'Technology and Digital Assistance': [
    'Setting up smartphones, tablets, or smart TVs',
    'Email and app installations',
    'Wi-Fi troubleshooting and router setup',
    'Social media help (creating accounts, learning how to use them)',
    'Transferring files or photos to the cloud',
    'Setting up online payments or e-commerce accounts'
  ],
  'Event Support': [
    'Party setup and teardown',
    'Serving assistance (food/drinks)',
    'Greeting and guest coordination',
    'Coat check or gift table staffing',
    'Decoration setup (balloons, lights, banners)',
    'On-site tech help (music, mic, slideshow setup)'
  ],
  'Moving and Organization': [
    'Packing and unpacking',
    'Labeling boxes',
    'Donating/selling unused items',
    'Room-by-room organization',
    'Helping seniors downsize',
    'Rearranging furniture'
  ],
  'Creative and Costume Tasks': [
    'Personal costume design or fitting help',
    'Home decor styling (e.g., for holidays or photoshoots)',
    'Scrapbooking or photo album organization',
    'DIY project assistance',
    'Art/craft material setup for events',
    'Storytelling or skit prep for community events'
  ],
  'General Errands': [
    'Grocery shopping and delivery',
    'Prescription pickup',
    'Mailing or shipping packages',
    'Dry cleaning drop-off/pickup',
    'Waiting for service appointments (e.g., cable guy)',
    'Buying last-minute gifts or supplies'
  ],
  'Other': ['Other']
};

const gigSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'A gig must have a title'],
    trim: true,
    maxlength: [100, 'A gig title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'A gig must have a description'],
    trim: true
  },
  category: {
    type: String,
    required: [true, 'A gig must have a category'],
    enum: CATEGORY_ENUM
  },
  subcategory: {
    type: String,
    trim: true
  },
  cost: {
    type: Number,
    required: [true, 'A gig must have a cost']
  },
  location: {
    address: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  isRemote: {
    type: Boolean,
    default: false
  },
  deadline: {
    type: Date
  },
  duration: {
    type: Number // in hours
  },
  skills: [{
    type: String,
    trim: true
  }],
  postedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A gig must belong to a user']
  },
  assignedTo: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['open', 'assigned', 'in-progress', 'completed', 'cancelled'],
    default: 'open'
  },
  attachments: [{
    fileName: String,
    filePath: String,
    fileType: String,
    fileSize: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  completionProof: [{
    fileName: String,
    filePath: String,
    fileType: String,
    fileSize: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

gigSchema.index({ status: 1, category: 1 });
gigSchema.index({ postedBy: 1 });

gigSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'postedBy',
    select: 'firstName lastName profileImage rating'
  });

  if (this._conditions.status !== 'open') {
    this.populate({
      path: 'assignedTo',
      select: 'firstName lastName profileImage rating'
    });
  }

  next();
});

gigSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

const Gig = mongoose.model('Gig', gigSchema);

export { Gig, SUBCATEGORIES_MAP, CATEGORY_ENUM };
