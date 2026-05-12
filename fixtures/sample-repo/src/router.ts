import { createPost, deletePost, getUser, listPosts, updatePost } from './api-client';
import type { ApiResult } from './types';

type Handler = (req: Request, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const routes: Route[] = [];

function json<T>(result: ApiResult<T>, status = 200): Response {
  if (!result.ok) {
    return new Response(JSON.stringify(result.error), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(result.data), { status, headers: { 'Content-Type': 'application/json' } });
}

function route(method: string, path: string, handler: Handler): void {
  const paramNames: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:([^/]+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; }) + '$');
  routes.push({ method, pattern, paramNames, handler });
}

route('GET', '/users/:id', async (req, { id }) => json(await getUser(id)));

route('GET', '/posts', async (req) => {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
  return json(await listPosts(page, pageSize));
});

route('POST', '/posts', async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const body = await req.json() as { title: string; body: string };
  return json(await createPost(token, body), 201);
});

route('PATCH', '/posts/:id', async (req, { id }) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const body = await req.json() as { title?: string; body?: string };
  return json(await updatePost(token, id, body));
});

route('DELETE', '/posts/:id', async (req, { id }) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  return json(await deletePost(token, id), 204);
});

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  for (const { method, pattern, paramNames, handler } of routes) {
    if (req.method !== method) { continue; }
    const match = pattern.exec(url.pathname);
    if (!match) { continue; }
    const params = Object.fromEntries(paramNames.map((n, i) => [n, match[i + 1]]));
    return handler(req, params);
  }
  return new Response('Not Found', { status: 404 });
}
