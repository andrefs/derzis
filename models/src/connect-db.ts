import config from '@derzis/config';
import mongoose from 'mongoose';
if (config.worker.db.debug) {
	console.log('Enabling mongo debug');
	mongoose.set('debug', true);
}

let auth = '';
if (config.worker.db.user) {
	auth += config.worker.db.user + ':';
}
if (config.worker.db.pass) {
	auth += config.worker.db.pass + '@';
}

export const uri = `mongodb://${auth}${config.worker.db.host}:${config.worker.db.port}/${config.worker.db.name}`;

export const connect = () => {
	console.log('XXXXXXXXXXx 3', { uri });
	const conn = mongoose.connect(uri || 'mongodb://localhost/derzis-wrk');
	return conn;
};
