import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { initializeRegistry } from "../src/lib/registry/schema";

async function main() {
  loadEnvConfig(process.cwd());
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DB;
  if (!uri || !database) {
    throw new Error("Set MONGODB_URI and MONGODB_DB to initialize the registry.");
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    await initializeRegistry(client.db(database));
    console.log(`Registry collections and indexes initialized in ${database}.`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
