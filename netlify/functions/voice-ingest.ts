import handler from '../../api/webhook/voice-ingest';
import { wrapVercelHandler } from './wrapper';

export default wrapVercelHandler(handler);

export const config = {
  path: "/api/webhook/voice-ingest",
};
