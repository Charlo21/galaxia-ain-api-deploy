/**
 * Swagger/OpenAPI documentation setup
 */

export const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Galaxia AI Network API',
    version: '1.0.0',
    description: 'Decentralized AI inference network API - Run AI models (Llama 3, Stable Diffusion, Whisper) across a global network of compute nodes',
    contact: {
      name: 'Galaxia Support',
      email: 'support@galaxia.ai',
    },
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://api.galaxia.ai',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for authentication',
      },
    },
    schemas: {
      Task: {
        type: 'object',
        properties: {
          task_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['queued', 'assigned', 'processing', 'completed', 'failed'] },
          model: { type: 'string' },
          priority: { type: 'string', enum: ['standard', 'fast'] },
          nodes_used: { type: 'integer' },
          latency_ms: { type: 'integer' },
          cost_tokens: { type: 'number' },
          result: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          completed_at: { type: 'string', format: 'date-time' },
        },
      },
      InferenceRequest: {
        type: 'object',
        required: ['model', 'input'],
        properties: {
          model: { type: 'string', enum: ['llama-3-8b', 'stable-diffusion', 'whisper'] },
          input: { type: 'string', description: 'Text, base64 image, or base64 audio' },
          priority: { type: 'string', enum: ['standard', 'fast'], default: 'standard' },
          region: { type: 'string', enum: ['auto', 'us-east', 'eu-west', 'asia'], default: 'auto' },
        },
      },
      InferenceResponse: {
        type: 'object',
        properties: {
          task_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          nodes_assigned: { type: 'integer' },
          estimated_cost: { type: 'number' },
          request_id: { type: 'string', format: 'uuid' },
        },
      },
      Node: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          device_id: { type: 'string' },
          wallet_address: { type: 'string' },
          capabilities: {
            type: 'object',
            properties: {
              cpu_cores: { type: 'integer' },
              gpu: { type: 'boolean' },
              ram_gb: { type: 'integer' },
              models: { type: 'array', items: { type: 'string' } },
            },
          },
          location: {
            type: 'object',
            properties: {
              country: { type: 'string' },
              region: { type: 'string' },
              city: { type: 'string' },
            },
          },
          reputation: { type: 'number' },
          status: { type: 'string' },
          tasks_completed: { type: 'integer' },
          total_earnings: { type: 'number' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
          details: { type: 'object' },
          request_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Check API server health and database connectivity',
        responses: {
          '200': {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    database: { type: 'object' },
                    queue: { type: 'object' },
                    timestamp: { type: 'string' },
                  },
                },
              },
            },
          },
          '503': {
            description: 'Server is unhealthy',
          },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Get metrics',
        description: 'Get network and performance metrics',
        responses: {
          '200': {
            description: 'Metrics data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nodes: { type: 'object' },
                    tasks: { type: 'object' },
                    performance: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/inference': {
      post: {
        tags: ['Inference'],
        summary: 'Run AI inference',
        description: 'Submit an inference task to the decentralized network',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InferenceRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Task created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InferenceResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '401': {
            description: 'Authentication required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '402': {
            description: 'Insufficient balance',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/v1/tasks/{taskId}': {
      get: {
        tags: ['Inference'],
        summary: 'Get task status',
        description: 'Get the status and results of an inference task',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Task ID',
          },
        ],
        responses: {
          '200': {
            description: 'Task status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Task' },
              },
            },
          },
          '404': {
            description: 'Task not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },
    '/v1/models': {
      get: {
        tags: ['Inference'],
        summary: 'List available models',
        description: 'Get list of available AI models and pricing',
        responses: {
          '200': {
            description: 'List of models',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    models: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          type: { type: 'string' },
                          pricing: { type: 'object' },
                          requires_gpu: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/nodes/register': {
      post: {
        tags: ['Nodes'],
        summary: 'Register a node',
        description: 'Register a new compute node with the network',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['device_id', 'wallet_address', 'capabilities'],
                properties: {
                  device_id: { type: 'string' },
                  wallet_address: { type: 'string' },
                  capabilities: {
                    type: 'object',
                    properties: {
                      cpu_cores: { type: 'integer' },
                      gpu: { type: 'boolean' },
                      ram_gb: { type: 'integer' },
                      models: { type: 'array', items: { type: 'string' } },
                    },
                  },
                  location: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Node registered',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    node: { $ref: '#/components/schemas/Node' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/v1/admin/stats': {
      get: {
        tags: ['Admin'],
        summary: 'Get network statistics',
        description: 'Get overall network statistics (admin only)',
        responses: {
          '200': {
            description: 'Network statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    nodes: { type: 'object' },
                    tasks: { type: 'object' },
                    earnings: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

