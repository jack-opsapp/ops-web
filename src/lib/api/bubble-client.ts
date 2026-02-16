/**
 * OPS Web - Bubble.io API Client
 *
 * Production Axios-based client with:
 * - Bearer token authentication
 * - Rate limiting (0.5s minimum between requests)
 * - Retry with exponential backoff (3 attempts)
 * - Response unwrapping
 * - Request/response interceptors for logging
 * - Type-safe request methods
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios";

// ─── Error Types ──────────────────────────────────────────────────────────────

export class BubbleApiError extends Error {
  constructor(
    message: string,
    public statusCode: number | null,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "BubbleApiError";
  }
}

export class BubbleRateLimitError extends BubbleApiError {
  constructor() {
    super("Rate limited by Bubble API. Please wait and try again.", 429);
    this.name = "BubbleRateLimitError";
  }
}

export class BubbleUnauthorizedError extends BubbleApiError {
  constructor() {
    super("Unauthorized. Please check your API credentials.", 401);
    this.name = "BubbleUnauthorizedError";
  }
}

export class BubbleNotFoundError extends BubbleApiError {
  constructor(resource: string) {
    super(`Resource not found: ${resource}`, 404);
    this.name = "BubbleNotFoundError";
  }
}

export class BubbleNetworkError extends BubbleApiError {
  constructor(originalError: unknown) {
    super("Network error. Please check your connection.", null, originalError);
    this.name = "BubbleNetworkError";
  }
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private lastRequestTime: number = 0;
  private readonly minInterval: number;

  constructor(minIntervalMs: number = 500) {
    this.minInterval = minIntervalMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.minInterval) {
      const waitTime = this.minInterval - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

// ─── Retry Logic ──────────────────────────────────────────────────────────────

interface RetryConfig {
  maxAttempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 2000,
  maxDelay: 8000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on non-retryable errors
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status && !config.retryableStatuses.includes(status)) {
          throw error;
        }
      }

      // Don't retry on last attempt
      if (attempt === config.maxAttempts) {
        break;
      }

      // Exponential backoff: 2s, 4s (capped at maxDelay)
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt - 1),
        config.maxDelay
      );

      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[BubbleClient] Retry attempt ${attempt}/${config.maxAttempts} after ${delay}ms`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ─── Bubble API Client ───────────────────────────────────────────────────────

export interface BubbleClientConfig {
  baseUrl?: string;
  apiToken?: string;
  enableLogging?: boolean;
  rateLimitMs?: number;
}

class BubbleClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private enableLogging: boolean;

  constructor(config: BubbleClientConfig = {}) {
    const baseUrl =
      config.baseUrl ||
      process.env.NEXT_PUBLIC_BUBBLE_API_URL ||
      "https://opsapp.co/version-test/api/1.1";
    const apiToken =
      config.apiToken ||
      process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN ||
      "";

    this.enableLogging = config.enableLogging ?? process.env.NODE_ENV === "development";
    this.rateLimiter = new RateLimiter(config.rateLimitMs ?? 500);

    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.enableLogging) {
          console.log(
            `[BubbleClient] ${config.method?.toUpperCase()} ${config.url}`,
            config.params ? `params: ${JSON.stringify(config.params)}` : ""
          );
        }
        return config;
      },
      (error: AxiosError) => {
        if (this.enableLogging) {
          console.error("[BubbleClient] Request error:", error.message);
        }
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        if (this.enableLogging) {
          const resultCount =
            response.data?.response?.results?.length ??
            (response.data?.response ? 1 : 0);
          console.log(
            `[BubbleClient] Response ${response.status}`,
            resultCount > 0 ? `(${resultCount} results)` : ""
          );
        }
        return response;
      },
      (error: AxiosError) => {
        if (this.enableLogging) {
          console.error(
            `[BubbleClient] Response error:`,
            error.response?.status,
            error.message
          );
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Set or update the auth token (e.g., after user login).
   */
  setAuthToken(token: string): void {
    this.client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  }

  /**
   * Clear the auth token (e.g., on logout).
   */
  clearAuthToken(): void {
    delete this.client.defaults.headers.common["Authorization"];
  }

  /**
   * Transform Axios errors into typed BubbleApiError instances.
   */
  private handleError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      switch (status) {
        case 401:
          throw new BubbleUnauthorizedError();
        case 404:
          throw new BubbleNotFoundError(error.config?.url ?? "unknown");
        case 429:
          throw new BubbleRateLimitError();
        default:
          if (status) {
            const message =
              typeof data === "object" && data !== null && "message" in data
                ? String((data as Record<string, unknown>).message)
                : `HTTP ${status} error`;
            throw new BubbleApiError(message, status, error);
          }
          throw new BubbleNetworkError(error);
      }
    }

    if (error instanceof BubbleApiError) {
      throw error;
    }

    throw new BubbleApiError(
      error instanceof Error ? error.message : "Unknown error",
      null,
      error
    );
  }

  /**
   * GET request with rate limiting and retry.
   */
  async get<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    try {
      const response = await withRetry(() =>
        this.client.get<T>(url, config)
      );
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * POST request with rate limiting and retry.
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    try {
      const response = await withRetry(() =>
        this.client.post<T>(url, data, config)
      );
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * PATCH request with rate limiting and retry.
   */
  async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    try {
      const response = await withRetry(() =>
        this.client.patch<T>(url, data, config)
      );
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * DELETE request with rate limiting and retry.
   */
  async delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    await this.rateLimiter.waitForSlot();

    try {
      const response = await withRetry(() =>
        this.client.delete<T>(url, config)
      );
      return response.data;
    } catch (error) {
      this.handleError(error);
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

let clientInstance: BubbleClient | null = null;

export function getBubbleClient(config?: BubbleClientConfig): BubbleClient {
  if (!clientInstance) {
    clientInstance = new BubbleClient(config);
  }
  return clientInstance;
}

export function resetBubbleClient(): void {
  clientInstance = null;
}

export { BubbleClient };
export default getBubbleClient;
