export interface CloseableHttpServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  closeIdleConnections?(): void;
}
