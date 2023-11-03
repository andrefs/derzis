import sgMail, { type MailDataRequired } from '@sendgrid/mail';
import { SENDGRID_API_KEY } from '$env/static/private';
sgMail.setApiKey(SENDGRID_API_KEY!);

export async function sendEmail(msg: MailDataRequired) {
	const res = await sgMail.send(msg);
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
