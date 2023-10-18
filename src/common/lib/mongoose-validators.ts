import { isValid } from './url';

const urlValidator = {
  validator: isValid,
  message: (props: any) => `${props.value} is not a valid URL!`,
};

const urlListValidator = {
  validator: (v: string[]) => v.every(isValid),
  message: (props: any) => `One of ${props} is not a valid URL!`,
};

export { urlValidator, urlListValidator };
