import {isValid} from './url'

export const urlType = {
  type: String,
  validate: {
    validator: (url: string) => isValid(url),
    message: '{VALUE} is not a valid URL!'
  }
};
