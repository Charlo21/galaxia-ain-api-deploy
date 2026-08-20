import { Router } from 'express';
import { swaggerDefinition } from '../swagger';

const router = Router();

/**
 * GET /swagger.json
 * OpenAPI specification
 */
router.get('/swagger.json', (req, res) => {
  res.json(swaggerDefinition);
});

/**
 * GET /docs
 * Swagger UI (if swagger-ui-express is installed)
 */
router.get('/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Galaxia API Documentation</title>
      <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui.css" />
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@4.15.5/swagger-ui-bundle.js"></script>
      <script>
        SwaggerUIBundle({
          url: '/swagger.json',
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIBundle.presets.standalone
          ]
        });
      </script>
    </body>
    </html>
  `);
});

export default router;

