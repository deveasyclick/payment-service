import { Router } from 'express';
import helmet from 'helmet';

import {
  DOCUMENTATION_HTML,
  DOCUMENTATION_INITIALIZER,
  OPENAPI_FILE_PATH,
} from './documentation.const.js';

export function createDocumentationRouter(): Router {
  const router = Router();

  // Only the documentation page needs the CDN; all other routes retain Helmet defaults.
  const documentationCsp = helmet.contentSecurityPolicy({
    directives: {
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'"],
      // Keep localhost HTTP assets on the same origin during development.
      upgradeInsecureRequests: null,
    },
  });

  router.get('/doc', documentationCsp, (_request, response) => {
    response.type('html').send(DOCUMENTATION_HTML);
  });
  router.get('/doc/initializer.js', (_request, response) => {
    response.type('application/javascript').send(DOCUMENTATION_INITIALIZER);
  });
  router.get('/openapi.json', (_request, response) => {
    response.sendFile(OPENAPI_FILE_PATH);
  });

  return router;
}
