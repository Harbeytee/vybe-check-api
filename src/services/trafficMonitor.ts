import { pubClient } from "../socket/redis/client";

export interface TrafficStatus {
  level: "normal" | "high" | "critical";
  activeRooms: number;
  activeConnections: number;
  roomCreationEnabled: boolean;
  message?: string;
  timestamp: number;
}

export interface TrafficMetrics {
  roomCreationRate: number; // rooms per minute
  activeRooms: number;
  activeConnections: number;
}

class TrafficMonitor {
  private roomCreationTimestamps: number[] = [];
  private readonly MAX_ROOM_CREATIONS_PER_MIN = 1000; // Adjust based on your free tier limits
  private readonly HIGH_TRAFFIC_THRESHOLD = 500; // rooms/min
  private readonly CRITICAL_TRAFFIC_THRESHOLD = 800; // rooms/min
  private lastCleanup = Date.now();

  /**
   * Record a room creation event
   */
  recordRoomCreation(): void {
    const now = Date.now();
    this.roomCreationTimestamps.push(now);

    // Clean up old timestamps (older than 1 minute)
    this.roomCreationTimestamps = this.roomCreationTimestamps.filter(
      (timestamp) => now - timestamp < 60000
    );
  }

  /**
   * Get current traffic metrics
   */
  getMetrics(): TrafficMetrics {
    const now = Date.now();
    const roomCreationRate = this.roomCreationTimestamps.filter(
      (timestamp) => now - timestamp < 60000
    ).length;

    return {
      roomCreationRate,
      activeRooms: 0, // Will be updated by getTrafficStatus
      activeConnections: 0, // Will be updated by getTrafficStatus
    };
  }

  /**
   * Get current traffic status with Redis metrics
   */
  async getTrafficStatus(io?: any): Promise<TrafficStatus> {
    const metrics = this.getMetrics();

    try {
      // Get active room count from Redis (non-blocking SCAN)
      let activeRooms = 0;
      let cursor: string = "0";
      const batchSize = 100;

      do {
        const result = await pubClient.scan(cursor, {
          MATCH: "room:*:meta",
          COUNT: batchSize,
        });
        cursor = result.cursor.toString();
        activeRooms += result.keys.length;

        // Limit scan to avoid blocking for too long
        if (activeRooms > 10000) break; // Estimate if too many
      } while (cursor !== "0" && activeRooms < 10000);

      // Get active connection count from Socket.IO
      const activeConnections = io ? io.engine.clientsCount : 0;

      // Determine traffic level
      let level: "normal" | "high" | "critical" = "normal";
      let roomCreationEnabled = true;
      let message: string | undefined;

      if (metrics.roomCreationRate >= this.CRITICAL_TRAFFIC_THRESHOLD) {
        level = "critical";
        roomCreationEnabled = false;
        message = "High traffic detected. Room creation temporarily paused.";
      } else if (metrics.roomCreationRate >= this.HIGH_TRAFFIC_THRESHOLD) {
        level = "high";
        message = "High traffic detected. Some delays may occur.";
      }

      // Also check Redis memory pressure (if available)
      if (activeRooms > 5000) {
        level = level === "critical" ? "critical" : "high";
        if (!message) {
          message = "High number of active rooms. Some delays may occur.";
        }
      }

      return {
        level,
        activeRooms,
        activeConnections,
        roomCreationEnabled,
        message,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error("Error getting traffic status:", error);
      // Default to normal if Redis fails
      return {
        level: "normal",
        activeRooms: metrics.roomCreationRate * 10, // Rough estimate
        activeConnections: io ? io.engine.clientsCount : 0,
        roomCreationEnabled: true,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check if room creation should be allowed
   */
  shouldAllowRoomCreation(): boolean {
    const metrics = this.getMetrics();
    return metrics.roomCreationRate < this.MAX_ROOM_CREATIONS_PER_MIN;
  }

  /**
   * Cleanup old timestamps periodically
   */
  cleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup > 60000) {
      this.roomCreationTimestamps = this.roomCreationTimestamps.filter(
        (timestamp) => now - timestamp < 60000
      );
      this.lastCleanup = now;
    }
  }
}

// Singleton instance
export const trafficMonitor = new TrafficMonitor();
