import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import organizersRouter from "./organizers";
import organizerManagementRouter from "./organizer-management";
import communityRouter from "./community";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(organizersRouter);
router.use(organizerManagementRouter);
router.use(communityRouter);
router.use(adminRouter);

export default router;
