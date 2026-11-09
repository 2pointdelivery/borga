import { NextResponse, type NextRequest } from 'next/server';
import {
  BORGA_API_VERSION,
  BORGA_OPENAPI_SEMVER,
  buildOpenApiSpec,
} from '@/lib/borga/openapi-spec';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin || 'https://app.borga.ai';
  const spec = buildOpenApiSpec(origin);
  return NextResponse.json(spec, {
    headers: {
      'X-Borga-API-Version': `${BORGA_API_VERSION} (${BORGA_OPENAPI_SEMVER})`,
      'Cache-Control': 'public, max-age=60',
    },
  });
}
