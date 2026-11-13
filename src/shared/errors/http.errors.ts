export class AuthenticationError extends Error {
  override readonly name = 'AuthenticationError';

  constructor() {
    super('A valid API key is required');
  }
}

export class RouteNotFoundError extends Error {
  override readonly name = 'RouteNotFoundError';

  constructor() {
    super('Route not found');
  }
}

export class RateLimitExceededError extends Error {
  override readonly name = 'RateLimitExceededError';

  constructor() {
    super('Too many requests');
  }
}

export class ServiceNotReadyError extends Error {
  override readonly name = 'ServiceNotReadyError';

  constructor() {
    super('Service is not ready');
  }
}
