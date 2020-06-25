import { createHash } from 'crypto';

import MemoryStoreClass from './lib/MemoryStore.js';
import { stat } from 'fs';

let instanceCount = 0;

class ExpressBrute {
  constructor(store, options) {
    instanceCount += 1;
    this.name = `brute${instanceCount}`;

    this.options = {
      ...ExpressBrute.defaults,
      ...options,
    };

    if (this.options.minWait < 1) {
      this.options.minWait = 1;
    }
    this.store = store;

    // build delays array
    this.delays = [this.options.minWait];
    while (this.delays[this.delays.length - 1] < this.options.maxWait) {
      var nextNum = this.delays[this.delays.length - 1] + (this.delays.length > 1 ? this.delays[this.delays.length - 2] : 0);
      this.delays.push(nextNum);
    }
    this.delays[this.delays.length - 1] = this.options.maxWait;

    // set default lifetime
    if (typeof this.options.lifetime == 'undefined') {
      this.options.lifetime = (this.options.maxWait / 1000) * (this.delays.length + this.options.freeRetries);
      this.options.lifetime = Math.ceil(this.options.lifetime);
    }

    // generate "prevent" middleware
    this.prevent = this.getMiddleware();
  }

  getMiddleware(options) {
    options = { ...options };

    var keyFunc = options.key;
    if (typeof keyFunc !== 'function') {
      keyFunc = (req, res, next) => { next(options.key); };
    }

    const getFailCallback = () => (
      typeof options.failCallback === 'undefined' ?
        this.options.failCallback :
        options.failCallback
    );

    // create middleware
    return (req, res, next) => {
      keyFunc(req, res, (key) => {
        if (!options.ignoreIP) {
          key = _getKey([req.ip, this.name, key]);
        } else {
          key = _getKey([this.name, key]);
        }

        // attach a simpler "reset" function to req.brute.reset
        if (this.options.attachResetToRequest) {
          let reset = (callback) => {
            this.store.reset(key, (err) => {
              if (typeof callback == 'function') {
                process.nextTick(() => {
                  callback(err);
                });
              }
            });
          };

          if (req.brute && req.brute.reset) {
            // wrap existing reset if one exists
            var oldReset = req.brute.reset;
            var newReset = reset;
            reset = (callback) => {
              oldReset(() => {
                newReset(callback);
              });
            };
          }
          req.brute = {
            reset,
          };
        }

        // filter request
        this.store.get(key, (err, value) => {
          if (err) {
            this.options.handleStoreError({
              req,
              res,
              next,
              message: 'Cannot get request count',
              parent: err,
            });
            return;
          }

          var count = 0,
            delay = 0,
            lastValidRequestTime = Date.now(),
            firstRequestTime = lastValidRequestTime;
          if (value) {
            count = value.count;
            lastValidRequestTime = value.lastRequest.getTime();
            firstRequestTime = value.firstRequest.getTime();

            var delayIndex = value.count - this.options.freeRetries - 1;
            if (delayIndex >= 0) {
              if (delayIndex < this.delays.length) {
                delay = this.delays[delayIndex];
              } else {
                delay = this.options.maxWait;
              }
            }
          }
          var nextValidRequestTime = lastValidRequestTime + delay;
          var remainingLifetime = this.options.lifetime || 0;

          if (!this.options.refreshTimeoutOnRequest && remainingLifetime > 0) {
            remainingLifetime = remainingLifetime - Math.floor((Date.now() - firstRequestTime) / 1000);
            if (remainingLifetime < 1) {
              // it should be expired alredy, treat this as a new request and reset everything
              count = 0;
              delay = 0;
              nextValidRequestTime = firstRequestTime = lastValidRequestTime = Date.now();
              remainingLifetime = this.options.lifetime || 0;
            }
          }

          if (nextValidRequestTime <= Date.now() || count <= this.options.freeRetries) {
            this.store.set(key, {
              count: count + 1,
              lastRequest: new Date(),
              firstRequest: new Date(firstRequestTime),
            }, remainingLifetime, (err) => {
              if (err) {
                this.options.handleStoreError({
                  req,
                  res,
                  next,
                  message: 'Cannot increment request count',
                  parent: err,
                });
                return;
              }
              typeof next == 'function' && next();
            });
          } else {
            var failCallback = getFailCallback();
            if (typeof failCallback === 'function') {
              failCallback(req, res, next, new Date(nextValidRequestTime));
            }
          }
        });
      });
    };
  };

  reset(ip, key, callback) {
    key = _getKey([ip, this.name, key]);
    this.store.reset(key, (err) => {
      if (err) {
        this.options.handleStoreError({
          message: 'Cannot reset request count',
          parent: err,
          key,
          ip,
        });
      } else {
        if (typeof callback == 'function') {
          process.nextTick(() => { callback(...arguments); });
        }
      }
    });
  }

  static FailTooManyRequests(req, res, next, nextValidRequestDate) {
    setRetryAfter(res, nextValidRequestDate);
    res.status(429);
    res.send({ error: { text: 'Too many requests in this time frame.', nextValidRequestDate: nextValidRequestDate } });
  }

  static FailForbidden(req, res, next, nextValidRequestDate) {
    setRetryAfter(res, nextValidRequestDate);
    res.status(403);
    res.send({ error: { text: 'Too many requests in this time frame.', nextValidRequestDate: nextValidRequestDate } });
  }


  static FailMark(req, res, next, nextValidRequestDate) {
    res.status(429);
    setRetryAfter(res, nextValidRequestDate);
    res.nextValidRequestDate = nextValidRequestDate;
    next();
  };

  static _getKey(arr) {
    var key = '';
    arr.forEach((part) => {
      if (part) {
        key += createHash('sha256').update(part).digest('base64');
      }
    });
    return createHash('sha256').update(key).digest('base64');
  }

  static defaults = {
    freeRetries: 2,
    proxyDepth: 0,
    attachResetToRequest: true,
    refreshTimeoutOnRequest: true,
    minWait: 500,
    maxWait: 1000 * 60 * 15, // 15 minutes
    failCallback: ExpressBrute.FailTooManyRequests,
    handleStoreError: (err) => {
      throw new Error(err.message);
    },
  };
}

const setRetryAfter = (res, nextValidRequestDate) => {
  var secondUntilNextRequest = Math.ceil((nextValidRequestDate.getTime() - Date.now()) / 1000);
  res.header('Retry-After', secondUntilNextRequest);
};

export default ExpressBrute;
export const FailTooManyRequests = ExpressBrute.FailTooManyRequests;
export const FailForbidden = ExpressBrute.FailForbidden;
export const FailMark = ExpressBrute.FailMark;
export const _getKey = ExpressBrute._getKey;
export const MemoryStore = MemoryStoreClass;
