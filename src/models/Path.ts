import { Types } from 'mongoose';
import { UrlType } from '@derzis/common';
import { prop, index, pre, getModelForClass } from '@typegoose/typegoose';
import {
  TripleClass,
  ProcessClass,
  Triple,
  Process,
  ProcessTriple,
} from '@derzis/models';

@pre<PathClass>('save', function () {
  this.nodes.count = this.nodes.elems.length;
  this.predicates.count = this.predicates.elems.length;
  if (this.predicates.count) {
    this.lastPredicate = this.predicates.elems[this.predicates.count - 1];
  }
  const origin = new URL(this.head.url).origin;
  this.head.domain = origin;
})
@index({ processId: 1 })
@index({
  'seed.url': 1,
  'head.url': 1,
  'predicates.count': 1,
})
@index({
  'head.url': 1,
  'nodes.count': 1,
})
class ResourceCount {
  @prop({ default: 0 })
  public count!: number;

  @prop({ default: [] })
  public elems!: UrlType[];
}
class HeadClass {
  @prop({ required: true })
  public url!: UrlType;

  @prop({ required: true })
  public domain!: string;
}

type RecursivePartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? RecursivePartial<U>[]
    : T[P] extends object | undefined
    ? RecursivePartial<T[P]>
    : T[P];
};

class PathClass {
  @prop({ required: true })
  public processId!: string;

  @prop({ required: true })
  public seed!: UrlType;

  @prop({ required: true })
  public head!: HeadClass;

  @prop({ default: [] })
  public predicates!: ResourceCount;

  @prop()
  public lastPredicate?: UrlType;

  @prop({ default: [] })
  public nodes!: ResourceCount;

  @prop({ ref: 'Triple' })
  public outOfBounds?: Types.ObjectId;

  public shouldCreateNewPath(this: PathClass, t: TripleClass): boolean {
    //console.log('XXXXXXXXXXXXXX shouldCreateNewPath', { t, _this: this });
    // triple is reflexive
    if (t.subject === t.object) {
      return false;
    }

    // head appears in triple predicate
    if (t.predicate === this.head.url) {
      return false;
    }

    const newHeadUrl: string =
      t.subject === this.head.url ? t.object : t.subject;

    // path already has outOfBounds triple
    if (!!this.outOfBounds) {
      return false;
    }

    // new head already contained in path
    if (this.nodes.elems.includes(newHeadUrl)) {
      return false;
    }
    //console.log('XXXXXXXXXXXXXX shouldCreateNewPath TRUE');

    return true;
  }

  public tripleIsOutOfBounds(
    t: TripleClass,
    process: ProcessDocumentClass
  ): boolean {
    const pathPreds: Set<UrlType> = new Set(this.predicates.elems);
    return (
      this.nodes.count >= process.params.maxPathLength ||
      (!pathPreds.has(t.predicate) &&
        this.predicates.count >= process.params.maxPathProps)
    );
  }

  public extendWithExistingTriples(): Promise<{
    newPaths: PathClass[];
    procTriples: string[];
  }> {
    // if path has outOfBounds triple, try to extend with that
    if (!!this.outOfBounds) {
      const t: TripleClass | null = await Triple.findById(this.outOfBounds);
      const process = await Process.findOne({ pid: this.processId });
      if (
        t &&
        !this.tripleIsOutOfBounds(t, process) &&
        process?.whiteBlackListsAllow(t!)
      ) {
        const newHeadUrl: string =
          t!.subject === this.head.url ? t!.object : t!.subject;
        const prop = t!.predicate;

        const np = this.copy();
        np.head.url = newHeadUrl;
        np.predicates.elems = Array.from(
          new Set([...this.predicates.elems, prop])
        );
        np.nodes.elems.push(newHeadUrl);

        await ProcessTriple.findOneAndUpdate(
          { processId: this.processId, triple: t },
          {},
          { upsert: true }
        );
        const path = await Path.create(np);
        await Path.deleteOne({ _id: this._id });

        return path.extendWithExistingTriples();
      }
    }
    // find triples which include the head but dont belong to the path yet
    let triples: TripleClass[] = await Triple.find({
      nodes: { $eq: this.head.url, $nin: this.nodes.elems },
    });
    return this.extend(triples);
  }

  public copy(): RecursivePartial<PathClass> {
    const copy = {
      processId: this.processId,
      seed: this.seed,
      head: this.head,
      predicates: { elems: [...this.predicates.elems] },
      nodes: { elems: [...this.nodes.elems] },
    };
    return copy;
  }

  public extend(
    triples: TripleClass[]
  ): Promise<{ newPaths: PathClass[]; procTriples: string[] }> {
    let newPaths: { [prop: string]: { [newHead: string]: PathClass } } = {};
    let procTriples: Types.ObjectId[] = [];
    const process = await Process.findOne({ pid: this.processId });

    for (const t of triples.filter(
      (t) => this.shouldCreateNewPath(t) && process?.whiteBlackListsAllow(t)
    )) {
      const newHeadUrl: string =
        t.subject === this.head.url ? t.object : t.subject;
      const prop = t.predicate;

      newPaths[prop] = newPaths[prop] || {};
      // avoid extending the same path twice with the same triple
      if (!newPaths[prop][newHeadUrl]) {
        const np = this.copy();
        np.head.url = newHeadUrl;

        if (this.tripleIsOutOfBounds(t, process)) {
          np.outOfBounds = t._id;
        } else {
          procTriples.push(t._id);
          np.predicates.elems = Array.from(
            new Set([...this.predicates.elems, prop])
          );
          np.nodes.elems.push(newHeadUrl);
        }
        newPaths[prop][newHeadUrl] = np;
      }
    }
    const nps: RecursivePartial<PathClass>[] = [];
    Object.values(newPaths).forEach((x) =>
      Object.values(x).forEach((y) => nps.push(y))
    );

    return { newPaths: nps, procTriples };
  }
}

const Path = getModelForClass(PathClass, {
  schemaOptions: { timestamps: true },
});

export { Path, PathClass };
