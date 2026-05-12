export type UserId = string;
export type PostId = string;

export interface User {
  id: UserId;
  login: string;
  email: string;
  avatarUrl: string;
  createdAt: Date;
}

export interface Post {
  id: PostId;
  title: string;
  body: string;
  authorId: UserId;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface CreatePostPayload {
  title: string;
  body: string;
}

export interface UpdatePostPayload {
  title?: string;
  body?: string;
}
