import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import discoverRouter from "./discover";
import swipesRouter from "./swipes";
import matchesRouter from "./matches";
import uploadRouter from "./upload";
import notificationsRouter from "./notifications";
import reportsRouter from "./reports";
import adminRouter from "./admin";
import verificationRouter from "./verification";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(discoverRouter);
router.use(swipesRouter);
router.use(matchesRouter);
router.use(uploadRouter);
router.use(notificationsRouter);
router.use(reportsRouter);
router.use(adminRouter);
router.use(verificationRouter);

export default router;
