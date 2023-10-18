import { mongoose } from '@typegoose/typegoose';
import { isValid } from './url';

class UrlType extends mongoose.SchemaType {
  constructor(key: string, options: any) {
    super(key, options, 'Url');
  }

  public cast(url: string) {
    if (!isValid(url)) {
      throw new Error(`${url} is not a valid URL!`);
    }
    return url;
  }
}

// @ts-ignore
mongoose.Schema.Types.UrlType = UrlType;

export { UrlType };
