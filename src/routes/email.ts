import { Router, Request, Response } from "express";
import { verifyEmailSetup } from "../services/email";

const router = Router();

router.get("/verify", async (req: Request, res: Response) => {
  const result = await verifyEmailSetup();

  if (result.ok) {
    return res.status(200).json({
      success: true,
      message: "Email configuration is valid",
    });
  }

  return res.status(500).json({
    success: false,
    error: result.error,
  });
});

export default router;
