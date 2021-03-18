import express, { Router } from 'express';
import asyncHandler from '../utils/async-handler';
import { RouteNotFoundException } from '../exceptions';
import { listExtensions } from '../extensions';
import env from '../env';
import { respond } from '../middleware/respond';

const router = Router();

const extensionsPath = env.EXTENSIONS_PATH as string;
router.use(express.static(extensionsPath));

router.get(
	'/:type',
	asyncHandler(async (req, res, next) => {
		const typeAllowList = ['interfaces', 'layouts', 'displays', 'modules'];

		if (typeAllowList.includes(req.params.type) === false) {
			throw new RouteNotFoundException(req.path);
		}

		const extensions = await listExtensions(req.params.type);

		res.locals.payload = {
			data: extensions,
		};

		return next();
	}),
	respond
);

export default router;
