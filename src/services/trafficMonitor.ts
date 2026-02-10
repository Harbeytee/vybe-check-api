import { Sentry } from "../instrument";
import { pubClient } from "../socket/redis/client";

/**
 * Traffic Monitor
 * Prevents room creation during high traffic to avoid crashes
 */
export class TrafficMonitor {
  private readonly WINDOW_SECONDS = 60; // 1 minute window
  private readonly MAX_ROOMS_PER_WINDOW = 10; // Max 10 rooms per minute
  private readonly KEY_PREFIX = "traffic:room_creation:";

  /**
   * Check if room creation should be allowed based on current traffic
   * @returns {allowed: boolean, message?: string}
   */
  async checkRoomCreationAllowed(): Promise<{
    allowed: boolean;
    message?: string;
  }> {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / 1000 / this.WINDOW_SECONDS);
      const key = `${this.KEY_PREFIX}${windowStart}`;

      // Get current count for this window
      const currentCount = await pubClient.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      if (count >= this.MAX_ROOMS_PER_WINDOW) {
        return {
          allowed: false,
          message: "High traffic detected. Please try again in a moment.",
        };
      }

      // Increment counter and set expiration
      await pubClient.incr(key);
      await pubClient.expire(key, this.WINDOW_SECONDS + 10); // Add buffer for expiration

      return { allowed: true };
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "traffic_monitor", method: "checkRoomCreationAllowed" },
      });
      // If Redis fails, fail closed (deny requests) to prevent abuse
      console.error("Traffic monitor error:", error);
      return {
        allowed: false,
        message: "High traffic detected. Please try again in a moment.",
      };
    }
  }

  /**
   * Get current traffic stats (for monitoring/debugging)
   */
  async getTrafficStats(): Promise<{
    currentWindowCount: number;
    maxAllowed: number;
    windowSeconds: number;
  }> {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / 1000 / this.WINDOW_SECONDS);
      const key = `${this.KEY_PREFIX}${windowStart}`;

      const currentCount = await pubClient.get(key);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      return {
        currentWindowCount: count,
        maxAllowed: this.MAX_ROOMS_PER_WINDOW,
        windowSeconds: this.WINDOW_SECONDS,
      };
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: "traffic_monitor", method: "getTrafficStats" },
      });
      console.error("Error getting traffic stats:", error);
      return {
        currentWindowCount: 0,
        maxAllowed: this.MAX_ROOMS_PER_WINDOW,
        windowSeconds: this.WINDOW_SECONDS,
      };
    }
  }
}

export const trafficMonitor = new TrafficMonitor();
