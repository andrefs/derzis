
import { Process } from '@derzis/models';
export type ProcessInfo = Awaited<ReturnType<typeof Process.prototype.getInfo>>;
