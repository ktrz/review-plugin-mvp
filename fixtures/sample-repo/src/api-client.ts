import type { User, Post, PaginatedResult, ApiResult, CreatePostPayload, UpdatePostPayload } from './types';

const BASE_URL = process.env.API_BASE_URL ?? 'https://api.example.com';

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ code: 'UNKNOWN', message: res.statusText }));
    return { ok: false, error };
  }
  const data = await res.json() as T;
  return { ok: true, data };
}

export async function getUser(id: string): Promise<ApiResult<User>> {
  return request<User>(`/users/${id}`);
}

export async function listPosts(page = 1, pageSize = 20): Promise<ApiResult<PaginatedResult<Post>>> {
  return request<PaginatedResult<Post>>(`/posts?page=${page}&pageSize=${pageSize}`);
}

export async function createPost(token: string, payload: CreatePostPayload): Promise<ApiResult<Post>> {
  return request<Post>('/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function updatePost(token: string, id: string, payload: UpdatePostPayload): Promise<ApiResult<Post>> {
  return request<Post>(`/posts/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function deletePost(token: string, id: string): Promise<ApiResult<void>> {
  return request<void>(`/posts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}
