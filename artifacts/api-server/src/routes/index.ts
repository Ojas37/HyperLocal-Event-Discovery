import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventsRouter from "./events";
import organizersRouter from "./organizers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventsRouter);
router.use(organizersRouter);

export default router;
