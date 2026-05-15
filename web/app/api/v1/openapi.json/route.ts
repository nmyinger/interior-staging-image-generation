import { generateOpenApiSpec } from '@/lib/openapi';

export const dynamic = 'force-static';

export async function GET() {
  const spec = generateOpenApiSpec();
  return Response.json(spec);
}
