import handler from '../../api/cron/monitor';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler, { isScheduled: true });

export const config = {
  schedule: "0 */4 * * *",
};
