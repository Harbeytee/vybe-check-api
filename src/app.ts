import express, { Application, Request, Response } from "express";
import cors from "cors";

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

export default app;
