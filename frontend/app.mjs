import {createApi} from './api.mjs';
import {mountPicker} from './view.mjs';

mountPicker(document.querySelector('#app'), createApi());
