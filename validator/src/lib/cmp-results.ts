import { ProcessInfo } from "./types";
import * as jsondiffpatch from "jsondiffpatch";

export function checkPreConditions(info1: ProcessInfo, info2: ProcessInfo) {
  if (info1?.steps?.length !== info2?.steps?.length) {
    console.warn('Different number of steps');
    return false;
  }

  for (let i = 0; i < info1.steps.length; i++) {
    if (info1.steps[i].maxPathLength !== info2.steps[i].maxPathLength) {
      console.warn(`Different maxPathLength at step ${i}`);
      return false;
    }
    if (info1.steps[i].maxPathProps !== info2.steps[i].maxPathProps) {
      console.warn(`Different maxPathProps at step ${i}`);
      return false;
    }
    // compare "seeds" arrays
    const seeds1 = info1.steps[i].seeds || [];
    const seeds2 = info2.steps[i].seeds || [];
    if (seeds1.length !== seeds2.length || !seeds1.every((val: any, index: number) => val === seeds2[index])) {
      console.warn(`Different seeds at step ${i}`);
      return false;
    }

    // compare "whiteList" arrays
    const whiteList1 = info1.steps[i].whiteList || [];
    const whiteList2 = info2.steps[i].whiteList || [];
    if (whiteList1.length !== whiteList2.length || !whiteList1.every((val: any, index: number) => val === whiteList2[index])) {
      console.warn(`Different whiteList at step ${i}`);
      return false;
    }

    // compare "blackList" arrays
    const blackList1 = info1.steps[i].blackList || [];
    const blackList2 = info2.steps[i].blackList || [];
    if (blackList1.length !== blackList2.length || !blackList1.every((val: any, index: number) => val === blackList2[index])) {
      console.warn(`Different blackList at step ${i}`);
      return false;
    }
  }
  return true;
}

export function cmpCounts(info1: ProcessInfo, info2: ProcessInfo) {
  const i1 = {
    resources: info1.resources.total || 0,
    triples: info1.triples.total || 0,
    domains: info1.domains.total || 0,
    paths: info1.paths.total || 0,
  };

  const i2 = {
    resources: info2.resources.total || 0,
    triples: info2.triples.total || 0,
    domains: info2.domains.total || 0,
    paths: info2.paths.total || 0,
  };

  const delta = jsondiffpatch.diff(i1, i2);
  return delta;
}

