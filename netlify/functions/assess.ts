import handler from '../../api/webhook/assess';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler);

export const config = {
  path: "/api/webhook/assess",
};
