export class RepositoryNotInitializedError extends Error {
  override readonly name = 'RepositoryNotInitializedError';

  constructor() {
    super('Payment repository has not been initialized');
  }
}

export class RepositoryInvariantError extends Error {
  override readonly name = 'RepositoryInvariantError';
}

export class InvalidPaymentVersionError extends Error {
  override readonly name = 'InvalidPaymentVersionError';

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Updated payment version must be ${expectedVersion + 1}; received ${actualVersion}`,
    );
  }
}
