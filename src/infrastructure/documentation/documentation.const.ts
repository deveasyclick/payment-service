import { fileURLToPath } from 'node:url';

export const OPENAPI_FILE_PATH = fileURLToPath(
  new URL('../../../openapi.json', import.meta.url),
);

export const SWAGGER_ASSET_URL =
  'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';

export const DOCUMENTATION_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Payment Service API</title>
    <link rel="stylesheet" href="${SWAGGER_ASSET_URL}/swagger-ui.css">
    <script defer src="${SWAGGER_ASSET_URL}/swagger-ui-bundle.js"></script>
    <script defer src="/doc/initializer.js"></script>
  </head>
  <body>
    <p>Payment Service API · <a href="/openapi.json">Download OpenAPI JSON</a></p>
    <noscript>Enable JavaScript to use the interactive documentation.</noscript>
    <div id="swagger-ui"></div>
  </body>
</html>`;

export const DOCUMENTATION_INITIALIZER = `window.addEventListener('DOMContentLoaded', function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    validatorUrl: null,
    persistAuthorization: false,
    queryConfigEnabled: false
  });
});`;
