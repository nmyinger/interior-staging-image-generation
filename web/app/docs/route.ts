import { ApiReference } from '@scalar/nextjs-api-reference';

export const GET = ApiReference({
  url: '/api/v1/openapi.json',
  theme: 'none',
  hideModels: false,
  defaultHttpClient: {
    targetKey: 'shell',
    clientKey: 'curl',
  },
  customCss: `
    :root {
      --scalar-color-1: #3d4a36;
      --scalar-background-1: #fafaf9;
    }
  `,
});
