import timeouts from 'long-settimeout';

import AbstractClientStore from './AbstractClientStore.js';

class MemoryStore extends AbstractClientStore {
  constructor(...args) {
    super(...args);

    this.data = {};
    this.options = {
      ...defaults,
      ...this.options,
    };
  }

  set(key, value, lifetime, callback) {
    key = this.options.prefix + key;
    lifetime = lifetime || 0;
    value = JSON.stringify(value);

    if (!this.data[key]) {
      this.data[key] = {};
    } else if (this.data[key].timeout) {
      timeouts.clearLongTimeout(this.data[key].timeout);
    }
    this.data[key].value = value;

    if (lifetime) {
      this.data[key].timeout = timeouts.setLongTimeout((() => {
        delete this.data[key];
      }, this), 1000 * lifetime);
    }
    if (typeof callback == 'function') { callback(null); }
  }

  get(key, callback) {
    key = this.options.prefix + key;
    var data = this.data[key] && this.data[key].value;
    if (data) {
      data = JSON.parse(data);
      data.lastRequest = new Date(data.lastRequest);
      data.firstRequest = new Date(data.firstRequest);
    }
    if (typeof callback == 'function') { callback(null, data); }
  }

  reset(key, callback) {
    key = this.options.prefix + key;

    if (this.data[key] && this.data[key].timeout) {
      timeouts.clearLongTimeout(this.data[key].timeout);
    }
    delete this.data[key];
    if (typeof callback == 'function') { callback(null); }
  };
}

const defaults = {
  prefix: '',
};

export default MemoryStore;
