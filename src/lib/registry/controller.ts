import { getMongoDb } from "../mongodb";
import { RegistryError } from "./errors";
import { validateCreateInput, validateId, validateUploadInput } from "./input";
import { RegistryRepository, type Kind } from "./repository";

function repository() { return new RegistryRepository(getMongoDb()); }

async function respond(action: () => Promise<unknown>, status = 200) {
  try { return Response.json({ data: await action() }, { status }); }
  catch (error) {
    if (error instanceof RegistryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Registry request failed:", error);
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}

export const controller = {
  list: (kind: Kind) => respond(() => repository().list(kind)),
  create: (request: Request, kind: Kind) => respond(async () => {
    const { name, owner } = await validateCreateInput(request);
    return repository().create(kind, name, owner);
  }, 201),
  get: (kind: Kind, id: string) => respond(() => { validateId(id); return repository().get(kind, id); }),
  listDefinitions: (kind: Kind, id: string) => respond(() => { validateId(id); return repository().listDefinitions(kind, id); }),
  getDefinition: (kind: Kind, id: string, definitionId: string) => respond(() => {
    validateId(id); validateId(definitionId);
    return repository().getDefinition(kind, id, definitionId);
  }),
  upload: (request: Request, kind: Kind, id: string) => respond(async () => {
    validateId(id);
    const { file, version } = await validateUploadInput(request, kind);
    return repository().upload(kind, id, file, version);
  }, 201),
};
