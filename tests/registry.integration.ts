import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { MongoClient, ObjectId } from "mongodb";
import { parse } from "yaml";
import { COLLECTIONS, initializeRegistry } from "../src/lib/registry/schema";

async function main() {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) throw new Error("Set TEST_MONGODB_URI to run the registry integration test.");
  const client = new MongoClient(uri);
  // This database is created solely for this test and removed afterward.
  const db = client.db(`contract_guard_test_${randomUUID().replaceAll("-", "")}`);
  try {
    await client.connect();
    await initializeRegistry(db);
    await initializeRegistry(db);
    const now = new Date();
    const apiIds = new Map<string, ObjectId>();

    for (const name of await readdir("specs")) {
      const apiId = new ObjectId();
      apiIds.set(name, apiId);
      await db.collection(COLLECTIONS.apis).insertOne({ _id: apiId, name, owner: "test", createdAt: now, updatedAt: now });
      for (const file of await readdir(path.join("specs", name))) {
        if (name === "claims-api" && file === "3-channel-and-notes-fixed.yaml") continue;
        const source = await readFile(path.join("specs", name, file));
        const definition = parse(source.toString("utf8"));
        await db.collection(COLLECTIONS.apiVersions).insertOne({
          apiId, version: definition.info.version,
          sourceHash: createHash("sha256").update(source).digest("hex"),
          sourceFile: file, createdAt: now, definition,
        });
      }
    }

    assert.equal(await db.collection(COLLECTIONS.apiVersions).countDocuments(), 11);
    assert.equal(await db.collection(COLLECTIONS.apiVersions).countDocuments({ apiId: apiIds.get("claims-api"), version: "1.1.0" }), 1);

    for (const file of await readdir("consumers")) {
      const source = await readFile(path.join("consumers", file));
      const definition = parse(source.toString("utf8"));
      const serviceId = new ObjectId();
      await db.collection(COLLECTIONS.services).insertOne({ _id: serviceId, name: definition.consumer, owner: definition.team, createdAt: now, updatedAt: now });
      await db.collection(COLLECTIONS.serviceVersions).insertOne({
        serviceId, sourceHash: createHash("sha256").update(source).digest("hex"),
        sourceFile: file, createdAt: now, definition, bindings: [],
      });
    }
    assert.equal(await db.collection(COLLECTIONS.serviceVersions).countDocuments(), 4);
    const apiVersion = await db.collection(COLLECTIONS.apiVersions).findOne({});
    assert.ok(apiVersion);
    const { _id: ignored, ...sameVersion } = apiVersion;
    assert.ok(ignored);
    await assert.rejects(db.collection(COLLECTIONS.apiVersions).insertOne(sameVersion), { code: 11000 });
    await assert.rejects(db.collection(COLLECTIONS.apiVersions).insertOne({ ...sameVersion, sourceHash: "c".repeat(64) }), { code: 11000 });
    await db.collection(COLLECTIONS.apiVersions).insertOne({ ...sameVersion, apiId: new ObjectId() });
    const legacy = client.db(`contract_guard_legacy_${randomUUID().replaceAll("-", "")}`);
    try {
      await legacy.collection(COLLECTIONS.apiVersions).insertMany([sameVersion, { ...sameVersion, sourceHash: "d".repeat(64) }]);
      await assert.rejects(initializeRegistry(legacy), /existing records share an API and version/);
      assert.equal(await legacy.collection(COLLECTIONS.apiVersions).countDocuments(), 2);
    } finally { await legacy.dropDatabase(); }
    await assert.rejects(db.collection(COLLECTIONS.apiVersions).insertOne({ ...sameVersion, version: "mismatch", sourceHash: "a".repeat(64) }), { code: 121 });
    await assert.rejects(db.collection(COLLECTIONS.services).insertOne({ name: "invalid", owner: "", createdAt: now, updatedAt: now }), { code: 121 });
    await assert.rejects(db.collection(COLLECTIONS.serviceVersions).insertOne({
      serviceId: new ObjectId(), sourceHash: "b".repeat(64), createdAt: now,
      definition: { consumer: "invalid", team: "test", uses: [{ provider: "quote-api", method: "invalid", path: "/", sends: [], reads: [] }] }, bindings: [],
    }), { code: 121 });
    console.log("Registry integration checks passed.");
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
