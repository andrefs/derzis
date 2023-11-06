import { config } from 'dotenv';
config({ path: '../.env' });
import Nodemailer, { type SendMailOptions } from 'nodemailer';
import { MailtrapTransport } from 'mailtrap';

const MAILTRAP_API_TOKEN = process.env.MAILTRAP_API_TOKEN;

const transport = Nodemailer.createTransport(
	MailtrapTransport({
		token: MAILTRAP_API_TOKEN!
	})
);

export async function sendEmail(msg: SendMailOptions) {
	const res = await transport.sendMail(msg);
	return res;
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
