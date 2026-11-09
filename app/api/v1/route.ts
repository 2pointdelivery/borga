import { NextResponse } from 'next/server';
import {
  BORGA_API_RELEASE_DATE,
  BORGA_API_VERSION,
  BORGA_OPENAPI_SEMVER,
  V1_ENDPOINT_CATALOG,
} from '@/lib/borga/openapi-spec';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      apiVersion: BORGA_API_VERSION,
      specVersion: BORGA_OPENAPI_SEMVER,
      releaseDate: BORGA_API_RELEASE_DATE,
      openApiUrl: '/api/v1/openapi',
      docsUrl: '/developers',
      endpoints: V1_ENDPOINT_CATALOG.map((ep) => ({
        id: ep.id,
        method: ep.method,
        path: ep.path,
        tag: ep.tag,
        summary: ep.summary,
        ...(ep.featureFlag ? { featureFlag: ep.featureFlag } : {}),
      })),
    },
    {
      headers: {
        'X-Borga-API-Version': `${BORGA_API_VERSION} (${BORGA_OPENAPI_SEMVER})`,
      },
    },
  );
}
