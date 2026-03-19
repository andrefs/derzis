import { urlValidator } from '@derzis/common';
import { prop, index, getModelForClass, type ReturnModelType } from '@typegoose/typegoose';
import { TimeStamps } from '@typegoose/typegoose/lib/defaultClasses';

import { DocumentType } from '@typegoose/typegoose';

@index({ pid: 1, url: 1 }, { unique: true })
@index({ createdAt: 1 })
@index({ status: 1 })
@index({ status: 1, createdAt: 1 }) // For pagination in labelsToFetch
@index({ pid: 1, status: 1, source: 1, extend: 1 }) // For checking pending cardea labels
class ResourceLabelClass extends TimeStamps {
  @prop({ required: true, type: String })
  public pid!: string;

  @prop({ required: true, validate: urlValidator, type: String })
  public url!: string;

  @prop({ required: true, type: String })
  public domain!: string;

  @prop({ required: true, enum: ['web', 'cardea'], type: String })
  public source!: 'web' | 'cardea';

  @prop({ required: true, enum: ['new', 'done', 'error'], default: 'new', type: String })
  public status!: 'new' | 'done' | 'error';

  @prop({ required: true, type: Boolean, default: false })
  public extend!: boolean;

  /**
   * Bulk upsert labels.
   * - Creates new labels if they don't exist
   * - Updates existing labels with status 'new' or 'error'
   * - Preserves labels with status 'done'
   * @param labels - Array of label data to upsert
   */
  public static async upsertMany(
    this: ReturnModelType<typeof ResourceLabelClass>,
    labels: Array<{ pid: string; url: string; source: 'web' | 'cardea'; extend: boolean }>
  ) {
    if (labels.length === 0) return;

    // Deduplicate by pid+url
    const uniqueLabels = Array.from(new Map(labels.map((l) => [`${l.pid}_${l.url}`, l])).values());

    // Single query to get existing labels
    const existing = await this.find({
      $or: uniqueLabels.map((l) => ({ pid: l.pid, url: l.url }))
    })
      .select('pid url status source extend')
      .lean();

    const existingMap = new Map(existing.map((e) => [`${e.pid}_${e.url}`, e]));

    // Extract domain once per unique URL
    const domainCache = new Map<string, string>();
    const getDomain = (url: string) => {
      if (domainCache.has(url)) return domainCache.get(url)!;
      let domain = '';
      try {
        domain = new URL(url).origin;
      } catch {
        domain = url;
      }
      domainCache.set(url, domain);
      return domain;
    };

    const bulkOps: ReturnModelType<typeof ResourceLabelClass>['bulkWrite'] extends (
      ops: infer T
    ) => Promise<any>
      ? T
      : never = [];

    for (const label of uniqueLabels) {
      const existingLabel = existingMap.get(`${label.pid}_${label.url}`);
      const domain = getDomain(label.url);

      if (!existingLabel) {
        // New label - insert
        bulkOps.push({
          insertOne: {
            document: {
              pid: label.pid,
              url: label.url,
              domain,
              source: label.source,
              extend: label.extend,
              status: 'new' as const
            }
          }
        });
      } else if (existingLabel.status === 'done') {
        // Skip - preserve done labels
        continue;
      } else {
        // Existing label with status 'new' or 'error' - update
        const update: Record<string, any> = {
          domain,
          status: 'new'
        };

        // Upgrade source: web -> cardea
        if (existingLabel.source === 'web' && label.source === 'cardea') {
          update.source = 'cardea';
        }

        // Upgrade extend: false -> true
        if (existingLabel.extend === false && label.extend === true) {
          update.extend = true;
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: existingLabel._id },
            update: { $set: update }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      await this.bulkWrite(bulkOps as any);
    }
  }
}

const ResourceLabel = getModelForClass(ResourceLabelClass, {
  schemaOptions: { collection: 'resourceLabels' }
});

export type ResourceLabelDocument = DocumentType<ResourceLabelClass>;

export { ResourceLabel, ResourceLabelClass };
