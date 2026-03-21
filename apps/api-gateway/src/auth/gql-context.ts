export interface GqlContext {
  req: {
    correlationId: string;
    ip: string;
    headers: Record<string, string | string[] | undefined>;
  };
}

export function extractMeta(ctx: GqlContext) {
  return {
    ip: ctx.req.ip,
    userAgent: ctx.req.headers['user-agent'] as string | undefined,
  };
}
