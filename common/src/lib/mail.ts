import { config } from 'dotenv';
config({ path: '../.env' });
import Nodemailer, { type SendMailOptions } from 'nodemailer';
import { MailtrapTransport } from 'mailtrap';
import { createLogger } from './logger';
const log = createLogger('Mailtrap-API');

export const MAILTRAP_API_TOKEN = process.env.MAILTRAP_API_TOKEN || '';

const transport = Nodemailer.createTransport(
	MailtrapTransport({
		token: MAILTRAP_API_TOKEN
	})
);

export async function sendEmail(msg: SendMailOptions) {
	if (MAILTRAP_API_TOKEN) {
		const res = await transport.sendMail(msg);
		return res;
	} else {

		log.warn('Mailtrap API token is not set. Email not sent.');
		return null;
	}
}

export async function sendInitEmail(to: string, pid: string) {
	const msg = {
		to,
		from: 'derzis-cardea@andrefs.com',
		subject: 'Derzis - Process started',
		text: `Your process with pid ${pid} has started.`,
		html: `<p>Your process with pid ${pid} has started.</p>`
	};
	const res = await sendEmail(msg);
	return res;
}
