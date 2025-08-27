// Script to update the User text search index
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const updateTextIndex = async () => {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    if (!mongoUri) {
      throw new Error('MONGO_URI or DATABASE_URL is not defined in the .env file.');
    }
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // Drop the existing text index
    try {
      await collection.dropIndex('TextSearchIndex');
      console.log('Dropped existing TextSearchIndex');
    } catch (error) {
      console.log('No existing TextSearchIndex to drop or error dropping:', error.message);
    }

    // Create the new text index
    await collection.createIndex(
      { 
        firstName: "text", 
        lastName: "text", 
        fullName: "text", 
        peoplePreference: "text", 
        bio: "text",
        skills: "text"
      },
      {
        weights: { 
          firstName: 15,
          lastName: 15,
          fullName: 20,
          peoplePreference: 10, 
          bio: 5,
          skills: 8
        },
        name: "TextSearchIndex",
      }
    );

    console.log('Created new TextSearchIndex with name fields');
    console.log('Text index update completed successfully!');

  } catch (error) {
    console.error('Error updating text index:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
};

updateTextIndex();