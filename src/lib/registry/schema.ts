import type { Db, Document } from "mongodb";

export const COLLECTIONS = {
  apis: "apis",
  services: "services",
  apiVersions: "api_versions",
  serviceVersions: "service_versions",
} as const;

const nonEmptyString = { bsonType: "string", pattern: "\\S" };
const stringArray = { bsonType: "array", items: nonEmptyString };
const identityProperties = {
  _id: { bsonType: "objectId" },
  name: nonEmptyString,
  owner: nonEmptyString,
  createdAt: { bsonType: "date" },
  updatedAt: { bsonType: "date" },
};
const versionProperties = {
  _id: { bsonType: "objectId" },
  sourceHash: { bsonType: "string", pattern: "^[a-f0-9]{64}$" },
  sourceFile: nonEmptyString,
  createdAt: { bsonType: "date" },
};

const registryValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "owner", "createdAt", "updatedAt"],
    properties: identityProperties,
  },
};

export const validators: Record<string, Document> = {
  [COLLECTIONS.apis]: registryValidator,
  [COLLECTIONS.services]: registryValidator,
  [COLLECTIONS.apiVersions]: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          required: ["apiId", "version", "sourceHash", "createdAt", "definition"],
          properties: {
            ...versionProperties,
            version: nonEmptyString,
            apiId: { bsonType: "objectId" },
            definition: {
              bsonType: "object",
              required: ["openapi", "info"],
              properties: {
                openapi: nonEmptyString,
                info: {
                  bsonType: "object",
                  required: ["title", "version"],
                  properties: { title: nonEmptyString, version: nonEmptyString },
                },
              },
            },
          },
        },
      },
      { $expr: { $eq: ["$version", "$definition.info.version"] } },
    ],
  },
  [COLLECTIONS.serviceVersions]: {
    $jsonSchema: {
      bsonType: "object",
      required: ["serviceId", "sourceHash", "createdAt", "definition", "bindings"],
      properties: {
        ...versionProperties,
        serviceId: { bsonType: "objectId" },
        definition: {
          bsonType: "object",
          required: ["consumer", "team", "uses"],
          properties: {
            consumer: nonEmptyString,
            team: nonEmptyString,
            uses: {
              bsonType: "array",
              items: {
                bsonType: "object",
                required: ["provider", "method", "path", "sends", "reads"],
                properties: {
                  provider: nonEmptyString,
                  method: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] },
                  path: { bsonType: "string", pattern: "^/" },
                  sends: stringArray,
                  reads: stringArray,
                },
              },
            },
          },
        },
        bindings: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["useIndex", "apiVersionId"],
            properties: {
              useIndex: { bsonType: "int", minimum: 0 },
              apiVersionId: { bsonType: "objectId" },
            },
          },
        },
      },
    },
  },
};

/** Explicitly apply validators and indexes. Existing collections are updated via collMod. */
export async function initializeRegistry(db: Db): Promise<void> {
  for (const [name, validator] of Object.entries(validators)) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (exists) {
      await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
    } else {
      await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
    }
  }

  await db.collection(COLLECTIONS.apis).createIndex({ name: 1 }, { unique: true });
  await db.collection(COLLECTIONS.services).createIndex({ name: 1 }, { unique: true });
  try {
    await db.collection(COLLECTIONS.apiVersions).createIndex({ apiId: 1, version: 1 }, { unique: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new Error("Cannot enforce unique API versions: existing records share an API and version. Review and resolve duplicates before running db:init again.", { cause: error });
    }
    throw error;
  }
  await db.collection(COLLECTIONS.serviceVersions).createIndex(
    { serviceId: 1, sourceHash: 1 },
    { unique: true },
  );
  // Replace the index from the earlier, versioned-service schema if present.
  const serviceVersions = db.collection(COLLECTIONS.serviceVersions);
  const indexes = await serviceVersions.indexes();
  if (indexes.some((index) => index.name === "serviceId_1_version_1_sourceHash_1")) {
    await serviceVersions.dropIndex("serviceId_1_version_1_sourceHash_1");
  }
  await db.collection(COLLECTIONS.serviceVersions).createIndex({ "bindings.apiVersionId": 1 });
}
