import { Router, Request, Response } from "express";
import { sendFeedbackEmail } from "../services/email";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  const { type, name, message } = req.body ?? {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      success: false,
      error: "Message is required",
    });
  }

  const result = await sendFeedbackEmail({
    type: type === "suggestion" ? "suggestion" : "bug",
    name: typeof name === "string" ? name.trim() : "",
    message: message.trim(),
  });

  if (!result.ok) {
    return res.status(500).json({
      success: false,
      error: result.error,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Feedback sent successfully",
  });
});

export default router;
