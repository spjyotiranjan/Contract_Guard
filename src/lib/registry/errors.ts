export class RegistryError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
