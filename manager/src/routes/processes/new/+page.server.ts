import { Process } from '@derzis/models';
import { redirect, type Action } from '@sveltejs/kit';

/** @type {import('./$types').Actions} */
export const actions: { [name: string]: Action } = {
  default: async ({ request }) => {
    //const data = await request.formData();
    //const resources = data.get('resources').split(/\s*,\s*/);
    //const email = data.get('email');

    //const proc = await Process.create({ resources, email });
    //throw redirect(303, `/processes/${proc.pid}`);
  }
};
