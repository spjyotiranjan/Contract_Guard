import "server-only";

import { MongoClient } from "mongodb";

// Reuse the client during development hot reloads and across server requests.
const globalForMongo = globalThis as typeof globalThis & {
  mongoClient?: MongoClient;
};

export function getMongoDb() {
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DB;

  if (!uri || !database) {
    throw new Error("Set MONGODB_URI and MONGODB_DB to use MongoDB.");
  }

  const client = globalForMongo.mongoClient ?? new MongoClient(uri);
  globalForMongo.mongoClient = client;

  return client.db(database);
}
