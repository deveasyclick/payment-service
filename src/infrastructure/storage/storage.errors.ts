export class InvalidStorageDataError extends Error {
  override readonly name = 'InvalidStorageDataError';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class UnsupportedStorageVersionError extends Error {
  override readonly name = 'UnsupportedStorageVersionError';

  constructor(readonly actualVersion: unknown) {
    super(`Unsupported storage schema version: ${String(actualVersion)}`);
  }
}
