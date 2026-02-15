// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitize(obj: any) {
  if (!obj) return obj;
  if ('_id' in obj) {
    delete obj._id;
  }
  for (const key in obj) {
    if (obj[key] instanceof Object) {
      sanitize(obj[key]);
    }
  }
  return obj;
}
