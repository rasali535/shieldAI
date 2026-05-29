import handler from '../../api/pipeline';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler);

export const config = {
  path: "/api/pipeline",
};
