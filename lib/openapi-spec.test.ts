import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BORGA_API_VERSION,
  BORGA_OPENAPI_SEMVER,
  V1_ENDPOINT_CATALOG,
  buildOpenApiSpec,
} from './borga/openapi-spec';

test('V1_ENDPOINT_CATALOG covers all versioned /api/v1 routes with unique ids', () => {
  assert.equal(BORGA_API_VERSION, 'v1');
  assert.equal(BORGA_OPENAPI_SEMVER, '1.4.0');
  assert.ok(V1_ENDPOINT_CATALOG.length >= 25);

  const ids = new Set<string>();
  for (const ep of V1_ENDPOINT_CATALOG) {
    assert.ok(!ids.has(ep.id), `duplicate endpoint id: ${ep.id}`);
    ids.add(ep.id);
    assert.equal(ep.version, 'v1');
    assert.ok(ep.path.startsWith('/api/v1'), `path must be versioned under /api/v1: ${ep.path}`);
  }
});

test('buildOpenApiSpec produces a valid OpenAPI 3.1.0 specification with BearerAuth and all v1 paths', () => {
  const spec = buildOpenApiSpec('https://api.example.com') as {
    openapi: string;
    info: { title: string; version: string; 'x-api-version': string };
    servers: Array<{ url: string }>;
    components: { securitySchemes: Record<string, unknown> };
    paths: Record<string, Record<string, unknown>>;
  };

  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.version, BORGA_OPENAPI_SEMVER);
  assert.equal(spec.info['x-api-version'], 'v1');
  assert.equal(spec.servers[0].url, 'https://api.example.com');
  assert.ok(spec.components.securitySchemes.BearerAuth);
  assert.ok(spec.paths['/api/v1/leads']?.get);
  assert.ok(spec.paths['/api/v1/leads']?.post);
  assert.ok(spec.paths['/api/v1/customers']?.post);
  assert.ok(spec.paths['/api/v1/invoices']?.post);
  assert.ok(spec.paths['/api/v1/purchase-orders']?.post);
  assert.ok(spec.paths['/api/v1/projects']?.get);
  assert.ok(spec.paths['/api/v1/inventory']?.get);
  assert.ok(spec.paths['/api/v1/knowledge']?.get);
  assert.ok(spec.paths['/api/v1/shared-services']?.get);
  assert.ok(spec.paths['/api/v1/communications/send']?.post);
});
