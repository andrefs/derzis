import { isValid } from './url';

const urlValidator = {
  validator: isValid,
  message: (props: any) => `${props.value} is not a valid URL!`,
};

export { urlValidator };
