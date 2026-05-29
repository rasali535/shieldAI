import handler from '../../api/webhook/outreach';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler);

export const config = {
  path: "/api/webhook/outreach",
};
