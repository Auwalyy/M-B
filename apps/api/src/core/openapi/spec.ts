import { z } from 'zod';
import type { RegisteredRoute } from '../http/route';

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  try {
    const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema;
    delete out.$schema;
    return out;
  } catch {
    return {};
  }
}

function parametersFor(schema: z.ZodType | undefined, location: 'query' | 'path') {
  const json = toSchema(schema);
  if (!json || typeof json.properties !== 'object') return [];
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(json.properties as Record<string, JsonSchema>).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' ? true : required.has(name) && !('default' in s),
    schema: s,
    ...(typeof s.description === 'string' ? { description: s.description } : {}),
  }));
}

const errorSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {},
        requestId: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
};

/** OpenAPI 3.1 document generated from the registered routes and their Zod schemas. */
export function buildOpenApiSpec(routes: RegisteredRoute[], serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const authMode = r.def.auth ?? 'required';
    const status = r.def.status ?? (r.method === 'post' ? 201 : 200);
    const body = toSchema(r.def.body);
    const description = [
      r.def.description,
      r.def.permission ? `**Permission:** \`${r.def.permission}\`` : undefined,
      authMode === 'optional' ? 'Authentication optional; signed-in staff get extra detail.' : undefined,
      r.def.rateLimit ? `**Rate limited** (${r.def.rateLimit}).` : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');

    (paths[path] ??= {})[r.method] = {
      tags: [r.tag],
      summary: r.def.summary,
      ...(description ? { description } : {}),
      operationId: `${r.method}${path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string) => (c ? c.toUpperCase() : ''))}`,
      ...(authMode === 'required' ? { security: [{ bearerAuth: [] }] } : authMode === 'optional' ? { security: [{}, { bearerAuth: [] }] } : {}),
      parameters: [...parametersFor(r.def.params, 'path'), ...parametersFor(r.def.query, 'query')],
      ...(r.def.upload
        ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { [r.def.upload.field]: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: r.def.upload.maxCount } } } } } } }
        : body
          ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } }
          : {}),
      responses: {
        [status]: { description: status === 204 ? 'No content' : 'Success. The payload is in `data` (lists also include `meta`).' },
        default: { description: 'Error', content: { 'application/json': { schema: errorSchema } } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Mudassir & Brothers API',
      version: '1.0.0',
      description:
        'REST API for the Mudassir & Brothers multi-branch retail platform. Successful responses are `{ data }` or `{ data, meta }`; errors are `{ error: { code, message, details?, requestId } }`. Money is in kobo.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
    paths,
  };
}
