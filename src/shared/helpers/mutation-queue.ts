export class MutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
