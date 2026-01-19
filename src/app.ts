import express, { Application, Request, Response } from "express";
import cors from "cors";
import { trafficMonitor } from "./services/trafficMonitor";

const app: Application = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check for deployment services
app.get("/health", (req: Request, res: Response) => {
  res
    .status(200)
    .json({ status: "active", timestamp: new Date().toISOString() });
});

// Traffic status endpoint for frontend monitoring
app.get("/status", async (req: Request, res: Response) => {
  try {
    const status = await trafficMonitor.getTrafficStatus();
    res.status(200).json(status);
  } catch (error) {
    res.status(500).json({
      level: "normal",
      activeRooms: 0,
      activeConnections: 0,
      roomCreationEnabled: true,
      timestamp: Date.now(),
    });
  }
});

export default app;
