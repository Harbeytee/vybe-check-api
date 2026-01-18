import { pubClient } from "../socket/redis/client";

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
}

const DEFAULT_LIMIT: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 10, // 10 rooms per minute per IP/socket
};

/**
 * Rate limiter using Redis to track requests per window
 * Essential for free tier to prevent abuse
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_LIMIT
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `rate_limit:${identifier}`;
  const now = Date.now();
  const windowStart = now - (now % config.windowMs);

  try {
    // Use Redis INCR with expiration
    const count = await pubClient.incr(key);

    if (count === 1) {
      // First request in window, set expiration
      await pubClient.expire(key, Math.ceil(config.windowMs / 1000));
    }

    const remaining = Math.max(0, config.maxRequests - count);
    const resetAt = windowStart + config.windowMs;

    return {
      allowed: count <= config.maxRequests,
      remaining,
      resetAt,
    };
  } catch (error) {
    console.error("Rate limit check failed:", error);

    // If Redis is down, we can't verify rate limits, so reject to prevent abuse
    return {
      allowed: false,
      remaining: 0,
      resetAt: now + config.windowMs,
    };
  }
}
