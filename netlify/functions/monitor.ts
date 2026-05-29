import handler from '../../api/cron/monitor';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler);

export const config = {
  path: "/api/cron/monitor",
};
