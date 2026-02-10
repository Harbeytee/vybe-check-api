import { Router } from "express";
import healthRouter from "./health";
import feedbackRouter from "./feedback";
import authRouter from "./auth";
import emailRouter from "./email";

const router = Router();

router.use("/health", healthRouter);
router.use("/feedback", feedbackRouter);
router.use("/auth", authRouter);
router.use("/email", emailRouter);

export default router;
