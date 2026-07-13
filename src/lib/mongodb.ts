import mongoose from "mongoose";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  interface Global {
    mongooseCache?: MongooseCache;
  }
}

const globalForMongoose = globalThis as typeof globalThis & Global;

const cached: MongooseCache = globalForMongoose.mongooseCache ?? {
  conn: null,
  promise: null,
};

globalForMongoose.mongooseCache = cached;

export async function connectToDatabase(): Promise<typeof mongoose> {
  const mongodbUri = process.env.MONGODB_URI;

  if (!mongodbUri) {
    throw new Error("MONGODB_URI environment variable is not configured");
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongodbUri, {
      bufferCommands: false,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch {
    cached.promise = null;
    throw new Error("Failed to connect to MongoDB");
  }

  return cached.conn;
}
