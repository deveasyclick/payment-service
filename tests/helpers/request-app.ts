import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';

import type { Express, Request, Response } from 'express';

// Exercise the real Express stack over in-memory streams; no listening port is needed.
export async function getTestResponse(app: Express, path: string) {
  const chunks: Buffer[] = [];
  const stream = new Duplex({
    read() {},
    write(chunk: Uint8Array | string, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  Object.assign(stream, { remoteAddress: '127.0.0.1' });
  const request = new IncomingMessage(stream as Socket);
  request.method = 'GET';
  request.url = path;
  request.headers = { host: 'localhost' };
  const response = new ServerResponse(request);
  response.assignSocket(stream as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
    app(request as Request, response as Response);
  });
  stream.destroy();
  const raw = Buffer.concat(chunks).toString('utf8');
  const bodyOffset = raw.indexOf('\r\n\r\n') + 4;
  return {
    status: response.statusCode,
    headers: response.getHeaders(),
    body: raw.slice(bodyOffset),
  };
}
