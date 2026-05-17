import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { APP_NAME } from '@/lib/constants';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ─── Security scheme ────────────────────────────────────────────────────────

registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API Key (isk_live_...)',
  description: 'Generate an API key from your dashboard at /admin/api-keys',
});

// ─── Schemas ─────────────────────────────────────────────────────────────────

const PropertySchema = registry.register(
  'Property',
  z.object({
    id: z.string().openapi({ example: 'prop_abc123' }),
    name: z.string().openapi({ example: 'The Smith Listing' }),
    address: z.string().nullable().openapi({ example: '123 Oak St, Austin TX 78701' }),
    mls: z.string().nullable().openapi({ example: 'ACTRIS' }),
    status: z.enum(['draft', 'queued', 'analyzing', 'generating', 'done', 'failed']),
    created_at: z.string().datetime(),
  }),
);

const BatchSchema = registry.register(
  'Batch',
  z.object({
    id: z.string(),
    property_id: z.string(),
    status: z.enum(['pending', 'analyzing', 'generating', 'done', 'failed']),
    items: z.array(
      z.object({
        id: z.string(),
        photo_filename: z.string(),
        status: z.enum(['pending', 'generating', 'done', 'failed']),
        staged_url: z.string().nullable(),
      }),
    ),
    created_at: z.string().datetime(),
  }),
);

const ApiKeySchema = registry.register(
  'ApiKey',
  z.object({
    id: z.string(),
    name: z.string(),
    key_prefix: z.string().openapi({ example: 'abc123456789' }),
    created_at: z.string().datetime(),
    last_used_at: z.string().datetime().nullable(),
  }),
);

const WebhookEndpointSchema = registry.register(
  'WebhookEndpoint',
  z.object({
    id: z.string(),
    url: z.string().url(),
    events: z
      .array(z.string())
      .openapi({ example: ['batch.completed', 'batch.failed'] }),
    created_at: z.string().datetime(),
  }),
);

const ErrorSchema = registry.register(
  'Error',
  z.object({
    error: z.string(),
  }),
);

// ─── Reusable response helpers ────────────────────────────────────────────────

const errorResponses = {
  401: {
    description: 'Unauthorized — missing or invalid API key',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  403: {
    description: 'Forbidden',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: ErrorSchema } },
  },
};

// ─── Properties ──────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/properties',
  summary: 'List properties',
  description: 'Returns all properties belonging to the authenticated account.',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'List of properties',
      content: {
        'application/json': {
          schema: z.object({ properties: z.array(PropertySchema) }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/properties',
  summary: 'Create a property',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().openapi({ example: 'The Smith Listing' }),
            address: z
              .string()
              .nullable()
              .optional()
              .openapi({ example: '123 Oak St, Austin TX 78701' }),
            mls: z.string().nullable().optional().openapi({ example: 'ACTRIS' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Property created',
      content: { 'application/json': { schema: PropertySchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/properties/{id}',
  summary: 'Get a property',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'Property object',
      content: { 'application/json': { schema: PropertySchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/properties/{id}',
  summary: 'Update a property',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().optional().openapi({ example: 'Updated Listing Name' }),
            address: z.string().nullable().optional(),
            mls: z.string().nullable().optional(),
            status: z
              .enum(['draft', 'queued', 'analyzing', 'generating', 'done', 'failed'])
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated property',
      content: { 'application/json': { schema: PropertySchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/properties/{id}/photos',
  summary: 'Upload a photo',
  description:
    'Upload a source photo to a property. Accepts `multipart/form-data` with a `file` field (JPEG/PNG, max 20 MB).',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().openapi({
              format: 'binary',
              description: 'JPEG or PNG image, max 20 MB',
            }),
            filename: z.string().optional().openapi({ example: 'living-room.jpg' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Photo uploaded',
      content: {
        'application/json': {
          schema: z.object({
            id: z.string(),
            filename: z.string(),
            url: z.string().url(),
          }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/properties/{id}/batches',
  summary: 'List batches for a property',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: 'List of staging batches',
      content: {
        'application/json': {
          schema: z.object({ batches: z.array(BatchSchema) }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/properties/{id}/batches',
  summary: 'Create a staging batch',
  description:
    'Submit a set of photos for AI staging. Returns immediately with `status: pending`; progress is delivered via webhooks (`batch.completed`, `batch.failed`, `batch.item.done`).',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            photo_ids: z
              .array(z.string())
              .openapi({ example: ['photo_abc', 'photo_def'] }),
            style_prompt: z
              .string()
              .optional()
              .openapi({ example: 'Modern Scandinavian, warm oak tones, natural light' }),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: 'Batch accepted',
      content: { 'application/json': { schema: BatchSchema } },
    },
    ...errorResponses,
  },
});

// ─── API Keys ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/keys',
  summary: 'List API keys',
  description:
    'Returns all API keys for the authenticated account. Requires an active next-auth session (dashboard use only).',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'List of API keys',
      content: {
        'application/json': {
          schema: z.object({ keys: z.array(ApiKeySchema) }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/keys',
  summary: 'Create an API key',
  description:
    'Creates a new API key. The full key value is returned **once** in the response and cannot be retrieved again. Requires an active next-auth session.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().openapi({ example: 'Production integration' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Key created — store the `key` value now; it will not be shown again',
      content: {
        'application/json': {
          schema: ApiKeySchema.extend({
            key: z.string().openapi({ example: 'isk_live_abc123...' }),
          }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/keys/{id}',
  summary: 'Revoke an API key',
  description: 'Permanently revokes the key. Requires an active next-auth session.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Key revoked' },
    ...errorResponses,
  },
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/api/v1/webhooks',
  summary: 'List webhook endpoints',
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'List of webhook endpoints',
      content: {
        'application/json': {
          schema: z.object({ webhooks: z.array(WebhookEndpointSchema) }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/webhooks',
  summary: 'Register a webhook endpoint',
  description:
    'Register a URL to receive event notifications. Payloads are signed with HMAC-SHA256; verify the `X-Staging-Signature` header.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            url: z.string().url().openapi({ example: 'https://example.com/hooks/staging' }),
            events: z
              .array(z.string())
              .openapi({ example: ['batch.completed', 'batch.failed', 'batch.item.done'] }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Webhook registered',
      content: { 'application/json': { schema: WebhookEndpointSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/webhooks/{id}',
  summary: 'Remove a webhook endpoint',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    204: { description: 'Endpoint removed' },
    ...errorResponses,
  },
});

// ─── Spec generator ───────────────────────────────────────────────────────────

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: `${APP_NAME} API`,
      version: '1.0.0',
      description:
        'AI virtual staging for real estate photographers and brokerages. Batch-submit an entire property shoot in one API call — get back staged images with AB 723 compliance metadata.\n\nBase URL: `https://staging.altitudedp.com`\n\n**Authentication:** All endpoints (except key management) require a Bearer token. Generate a key at `/admin/api-keys`.',
      contact: { email: 'nik@altitudedp.com' },
    },
    servers: [{ url: 'https://staging.altitudedp.com', description: 'Production' }],
    security: [{ BearerAuth: [] }],
  });
}
