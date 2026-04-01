import { isValid } from './url';

export const isBlankNodeId = (id: string): boolean =>
  typeof id === 'string' && id.startsWith('_:') && id.length > 2;

const isUrlOrBlankNode = (value: string): boolean => {
  if (isValid(value)) return true;
  return isBlankNodeId(value);
};

const urlValidator = {
  validator: isValid,
  message: (props: any) => `${props.value} is not a valid URL!`
};

const urlOrBlankNodeValidator = {
  validator: isUrlOrBlankNode,
  message: (props: any) => `${props.value} is not a valid URL or blank node!`
};

const urlListValidator = {
  validator: (v: string[]) => v.every(isValid),
  message: (props: any) => `One of ${props} is not a valid URL!`
};

export { urlValidator, urlOrBlankNodeValidator, urlListValidator };
