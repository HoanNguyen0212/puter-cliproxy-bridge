import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
  resources: 'usable',
  runScripts: 'dangerously'
});

const define = (name, value) => {
  try {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true
    });
  } catch {}
};

define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('CustomEvent', dom.window.CustomEvent);
define('Event', dom.window.Event);
define('EventTarget', dom.window.EventTarget);
define('XMLHttpRequest', dom.window.XMLHttpRequest);
define('FormData', dom.window.FormData);
define('Headers', dom.window.Headers);
define('Request', dom.window.Request);
define('Response', dom.window.Response);
if (!globalThis.fetch && dom.window.fetch) define('fetch', dom.window.fetch);
