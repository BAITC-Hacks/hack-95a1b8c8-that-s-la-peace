import {createApi} from './api.mjs';
import {mountPicker} from './view.mjs';

mountPicker(document.querySelector('#app'), {
  ...createApi(),
  loadGuide: async () => {
    const response = await fetch('./catalog-guide.json', {
      credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    return response.json();
  },
});
